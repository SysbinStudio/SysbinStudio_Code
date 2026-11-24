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
const agentTools = require('./agent-tools');

const controllers = new Map();   // requestId -> AbortController
const decisions = new Map();     // confirmId -> { resolve, timer }  等待用户确认工具调用
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
    /* ── 用户在工具确认卡片上做出决定（允许 / 拒绝 / 改命令后允许） ──
       payload: { confirmId, approve:boolean, edited?:string }
       主进程 ai-agent 循环正 await 这个 Promise。 */
    ipcMain.on('ai-tool-decision', (e, d) => {
        const item = decisions.get(d && d.confirmId);
        if (!item) return;
        clearTimeout(item.timer);
        decisions.delete(d.confirmId);
        item.resolve({
            approve: !!d.approve,
            edited: typeof d.edited === 'string' ? d.edited : ''
        });
    });

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

    /* ── AI Agent：function calling 循环 ──
       payload: { baseURL, apiKey, model, temperature, messages, requestId, root, maxRounds }
       模型每轮可请求调用工具（read_file / list_dir / write_file / run_command），
       主进程执行后把结果以 role:'tool' 回灌，直到模型给出纯文本答案或到达轮次上限。
       过程中用 'ai-tool' 事件把每一步推给渲染层展示；最终答案复用 ai-token/ai-done，
       这样渲染层既有的流式气泡逻辑无需改动。 */
    ipcMain.handle('ai-agent', async (event, payload) => {
        const p = payload || {};
        const requestId = p.requestId || nextRequestId();
        const url = chatUrl(p.baseURL);
        const apiKey = p.apiKey || '';
        const model = p.model || 'gpt-4o-mini';
        const temperature = (typeof p.temperature === 'number' && isFinite(p.temperature))
            ? Math.max(0, Math.min(2, p.temperature)) : 0.7;
        const root = p.root || '';
        const allowFullAccess = p.allowFullAccess === true;   // 前端「允许完全访问」开关
        const maxRounds = Math.max(1, Math.min(20, Number(p.maxRounds) || 8));
        const messages = Array.isArray(p.messages) ? p.messages.map(m => Object.assign({}, m)) : [];
        const sender = event.sender;
        const controller = new AbortController();
        controllers.set(requestId, controller);

        if (!messages.length) { controllers.delete(requestId); return { ok: false, error: '没有可发送的消息' }; }

        const emitTool = (step) => { try { sender.send('ai-tool', Object.assign({ requestId }, step)); } catch (e) {} };

        /* 等待用户在确认卡片上决定；超时（5 分钟）按拒绝处理，避免无限挂起 */
        const waitDecision = (confirmId) => new Promise(resolve => {
            const timer = setTimeout(() => {
                if (decisions.has(confirmId)) decisions.delete(confirmId);
                resolve({ approve: false, edited: '', timeout: true });
            }, 5 * 60 * 1000);
            decisions.set(confirmId, { resolve, timer });
        });

        try {
            let finalText = '';
            let rounds = 0;
            const peerModel = { tools: agentTools.TOOLS, tool_choice: 'auto' };

            for (let i = 0; i < maxRounds; i++) {
                if (controller.signal.aborted) return { ok: false, aborted: true, error: '已取消', requestId };
                rounds = i + 1;

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': 'Bearer ' + apiKey
                    },
                    body: JSON.stringify(Object.assign({
                        model, messages, temperature, stream: false
                    }, peerModel)),
                    signal: controller.signal
                });

                if (!res.ok) {
                    let detail = '';
                    try { detail = await res.text(); } catch (e) {}
                    controllers.delete(requestId);
                    return { ok: false, status: res.status, error: `请求失败（${res.status}）：${detail.slice(0, 400)}` };
                }

                const j = await res.json();
                const choice = j.choices && j.choices[0];
                const msg = choice && choice.message;
                if (!msg) {
                    controllers.delete(requestId);
                    return { ok: false, error: '模型响应中没有消息内容', requestId };
                }

                const calls = msg.tool_calls || (msg.function_call
                    ? [{ id: 'call_' + Date.now(), type: 'function', function: msg.function_call }]
                    : []);

                /* 没有工具调用：本轮内容即最终答案 */
                if (!calls.length) {
                    finalText = typeof msg.content === 'string' ? msg.content : '';
                    emitTool({ phase: 'done', rounds, content: finalText });
                    /* 复用流式事件把答案交给现有渲染逻辑（分片模拟打字，避免一次性长文本卡顿） */
                    const chunk = 240;
                    for (let off = 0; off < finalText.length; off += chunk) {
                        if (controller.signal.aborted) break;
                        try { sender.send('ai-token', { requestId, delta: finalText.slice(off, off + chunk) }); } catch (e) {}
                    }
                    try { sender.send('ai-done', { requestId, content: finalText }); } catch (e) {}
                    controllers.delete(requestId);
                    return { ok: true, content: finalText, streamed: true, agent: true, rounds, requestId };
                }

                /* 有工具调用：把 assistant 的 tool_calls 原样加入历史 */
                messages.push({
                    role: 'assistant',
                    content: (typeof msg.content === 'string' ? msg.content : ''),
                    tool_calls: calls
                });

                for (const call of calls) {
                    if (controller.signal.aborted) break;
                    const fn = call.function || {};
                    const name = String(fn.name || '');
                    let args = {};
                    try { args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : (fn.arguments || {}); }
                    catch (e) { args = {}; }

                    const callId = 'tc_' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
                    emitTool({ phase: 'call', rounds, name, args, callId });

                    let result;
                    const needsConfirm = (name === 'write_file' || name === 'run_command');
                    const pv = needsConfirm ? agentTools.preview(name, args, { root }) : null;

                    /* ── 执行门槛（硬）：绝对黑名单 / 路径穿越 / 白名单根命令。
                       任何模式（含完全访问）都必须通过；拒绝时控制台报错 + 前端告警。 ── */
                    if (name === 'run_command') {
                        const checkCmd = (pv && pv.ok && pv.command) ? pv.command : String((args && args.command) || '');
                        const verdict = agentTools.vetCommand(checkCmd);
                        if (!verdict.ok) {
                            result = {
                                ok: false,
                                error: '命令被安全策略拒绝（' + verdict.reason + '）：' + checkCmd,
                                blocked: true,
                                kind: verdict.kind,
                                catastrophic: verdict.kind === 'catastrophic'
                            };
                            emitTool({ phase: 'result', rounds, name, callId, ok: false, result });
                            console.error('[ai-agent] ⛔ 命令被拒绝 [' + verdict.kind + ']：' + checkCmd + ' —— ' + verdict.reason);
                            try {
                                sender.send('ai-blocked', {
                                    requestId, name, command: checkCmd,
                                    why: verdict.reason, kind: verdict.kind
                                });
                            } catch (e) {}
                            messages.push({ role: 'tool', tool_call_id: call.id || ('call_' + Date.now()), content: JSON.stringify(result) });
                            continue;
                        }
                    }

                    /* 需要确认的两种情况：写文件一律确认；命令不在白名单时确认。
                       白名单命令（pv.auto）或「完全访问」开启时直接执行，不打扰用户。 */
                    const autoRunCmd = (name === 'run_command' && pv && pv.ok && pv.auto);
                    const skipConfirm = allowFullAccess || autoRunCmd;
                    if (needsConfirm && pv && pv.ok && !skipConfirm) {
                        const confirmId = 'cf_' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
                        emitTool({ phase: 'confirm', rounds, name, args, callId, confirmId, preview: pv });
                        const decision = await waitDecision(confirmId);
                        if (controller.signal.aborted) break;
                        if (!decision.approve) {
                            result = { ok: false, denied: true, error: decision.timeout ? '用户未在时限内确认，已取消' : '用户拒绝执行该操作' };
                            emitTool({ phase: 'denied', rounds, name, callId, confirmId });
                        } else {
                            const execArgs = Object.assign({}, args);
                            if (name === 'run_command' && decision.edited) execArgs.edited = decision.edited;
                            execArgs.approved = true;
                            result = await agentTools.execute(name, execArgs, { root });
                            emitTool({ phase: 'result', rounds, name, callId, ok: result.ok, result, confirmId });
                        }
                    } else if (needsConfirm && pv && !pv.ok) {
                        /* 预览阶段就判定非法（如系统目录），直接把错误回灌，不弹确认 */
                        result = { ok: false, error: pv.error, blocked: !!pv.blocked };
                        emitTool({ phase: 'result', rounds, name, callId, ok: false, result });
                    } else {
                        /* 只读工具 / 白名单命令 / 完全访问：直接执行。
                           完全访问下把 approved=true 传给 run_command，跳过确认门槛。 */
                        const execArgs = (allowFullAccess && name === 'run_command')
                            ? Object.assign({}, args, { approved: true }) : args;
                        result = await agentTools.execute(name, execArgs, { root });
                        emitTool({ phase: 'result', rounds, name, callId, ok: result.ok, result, auto: autoRunCmd || allowFullAccess });
                    }

                    /* 写文件成功后通知渲染层刷新已打开的标签模型 */
                    if (name === 'write_file' && result && result.ok && result.path) {
                        try { sender.send('ai-file-written', { requestId, path: result.path }); } catch (e) {}
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: call.id || ('call_' + Date.now()),
                        content: JSON.stringify(result)
                    });
                }
            }

            /* 到达轮次上限还没结束：让模型再总结一次（不带 tools） */
            messages.push({ role: 'user', content: '已达到工具调用轮次上限，请根据已有结果直接给出最终答案。' });
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({ model, messages, temperature, stream: false }),
                signal: controller.signal
            });
            if (res.ok) {
                const j = await res.json();
                const ch = j.choices && j.choices[0];
                finalText = (ch && ch.message && typeof ch.message.content === 'string') ? ch.message.content : '';
            } else {
                finalText = '（已到达工具调用轮次上限，且总结请求失败。）';
            }
            emitTool({ phase: 'done', rounds, content: finalText, reachedLimit: true });
            const chunk = 240;
            for (let off = 0; off < finalText.length; off += chunk) {
                try { sender.send('ai-token', { requestId, delta: finalText.slice(off, off + chunk) }); } catch (e) {}
            }
            try { sender.send('ai-done', { requestId, content: finalText }); } catch (e) {}
            controllers.delete(requestId);
            return { ok: true, content: finalText, streamed: true, agent: true, rounds, reachedLimit: true, requestId };
        } catch (err) {
            controllers.delete(requestId);
            if (err && err.name === 'AbortError') return { ok: false, aborted: true, error: '已取消', requestId };
            return { ok: false, error: String((err && err.message) || err), requestId };
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
