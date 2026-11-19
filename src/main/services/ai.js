'use strict';

/* ═══════════════════════════════════════════
   AI 助手代理服务

   渲染层只负责拼消息、显示结果；真正的 HTTP 请求在这里（主进程）发出，
   原因有两个：
     1. 渲染层受 CSP 限制（default-src 'self'），无法直接 fetch 用户自填的
        任意接口地址；主进程不受这条限制。
     2. API Key 只在主进程与用户接口之间流动，不进渲染层 DOM、不写进任何
        可被人右键查看的页面（仍会随请求发出，但本地不留痕到控制台以外）。

   接口协议：OpenAI 兼容的 /chat/completions（含 LM Studio、Ollama /v1、
   vLLM、OpenAI、DeepSeek、通义千问 DashScope 等）。

   流式：开启 stream 时按 SSE 逐块把增量内容通过 webContents.send 回传，
   渲染层实时追加；结束时再发一条 ai-done。非 event-stream 的响应自动回退
   成普通 JSON。ai-chat-abort 可按 requestId 取消在途请求。
   ═══════════════════════════════════════════ */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const controllers = new Map();   // requestId -> AbortController
let seq = 0;

function nextRequestId() { return 'ai-' + Date.now() + '-' + (++seq); }

/* 把用户填的接口地址规范成「https://host/v1」形式，并拼出 chat 端点 */
function normalizeBaseURL(u) {
    let s = String(u || '').trim().replace(/\/+$/, '');
    if (!s) s = 'https://api.openai.com/v1';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
}

function chatUrl(baseURL) { return normalizeBaseURL(baseURL) + '/chat/completions'; }

function register(ctx) {
    /* ── 发起一次对话 ──
       payload: { baseURL, apiKey, model, messages, temperature, stream, requestId }
       messages: OpenAI 标准格式 [{ role, content }, ...]
       返回（非流式）: { ok, content, model } | { ok:false, error, status? }
       流式: 过程中 webContents.send('ai-token', { requestId, delta })
             结束 webContents.send('ai-done', { requestId, content }) */
    ipcMain.handle('ai-chat', async (event, payload) => {
        const p = payload || {};
        const requestId = p.requestId || nextRequestId();
        const url = chatUrl(p.baseURL);
        const apiKey = p.apiKey || '';
        const model = p.model || 'gpt-4o-mini';
        const stream = p.stream !== false;       // 默认开流式
        const temperature = (typeof p.temperature === 'number' && isFinite(p.temperature))
            ? Math.max(0, Math.min(2, p.temperature)) : 0.7;
        const messages = Array.isArray(p.messages) ? p.messages : [];

        if (!messages.length) return { ok: false, error: '没有可发送的消息' };

        const controller = new AbortController();
        controllers.set(requestId, controller);
        const sender = event.sender;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({ model, messages, temperature, stream }),
                signal: controller.signal
            });

            if (!res.ok) {
                let detail = '';
                try { detail = await res.text(); } catch (e) {}
                controllers.delete(requestId);
                return { ok: false, status: res.status, error: `请求失败（${res.status}）：${detail.slice(0, 400)}` };
            }

            const ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';

            /* 服务端不支持 SSE：按普通 JSON 处理 */
            if (!stream || !/text\/event-stream/i.test(ctype)) {
                const j = await res.json();
                const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
                controllers.delete(requestId);
                return { ok: true, content, model: j.model || model, requestId };
            }

            /* ── 流式 ── 逐块把增量内容发回渲染层 */
            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buf = '';
            let full = '';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    let nl;
                    while ((nl = buf.indexOf('\n')) >= 0) {
                        const line = buf.slice(0, nl).trim();
                        buf = buf.slice(nl + 1);
                        if (!line || !line.startsWith('data:')) continue;
                        const data = line.slice(5).trim();
                        if (data === '[DONE]') continue;
                        try {
                            const j = JSON.parse(data);
                            const delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '';
                            if (delta) {
                                full += delta;
                                try { sender.send('ai-token', { requestId, delta }); } catch (e) {}
                            }
                        } catch (e) { /* 心跳或分段不完整的行，忽略 */ }
                    }
                }
            } catch (e) {
                /* 流被中断（含用户取消）也把已收到的内容交出去 */
            }
            try { sender.send('ai-done', { requestId, content: full }); } catch (e) {}
            controllers.delete(requestId);
            return { ok: true, content: full, streamed: true, requestId };
        } catch (err) {
            controllers.delete(requestId);
            if (err && err.name === 'AbortError') return { ok: false, aborted: true, error: '已取消' };
            return { ok: false, error: String((err && err.message) || err) };
        }
    });

    /* ── 取消在途请求 ── */
    ipcMain.on('ai-chat-abort', (e, requestId) => {
        const c = controllers.get(requestId);
        if (c) {
            try { c.abort(); } catch (e) {}
            controllers.delete(requestId);
        }
    });

    /* ── AI 写文件（自动建父目录，支持新建文件） ──
       payload: { path, content }
       返回: { ok, path } | { ok:false, error } */
    ipcMain.handle('ai-write-file', async (e, payload) => {
        try {
            const p = payload && payload.path;
            if (!p) return { ok: false, error: '未指定写入路径' };
            const dir = path.dirname(p);
            if (dir && dir !== p) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p, payload.content || '', 'utf8');
            return { ok: true, path: p };
        } catch (err) {
            return { ok: false, error: String((err && err.message) || err) };
        }
    });
}

module.exports = { register, normalizeBaseURL, chatUrl };
