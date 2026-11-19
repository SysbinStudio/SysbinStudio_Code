'use strict';

/* ═══════════════════════════════════════════
   插件市场（远程目录抓取）

   市场就是一个静态目录列表页（默认 https://123pen.cn/ssc/codl/）。
   主进程负责抓取与解析 —— 渲染层的 CSP 不允许跨域 fetch，
   而且只有主进程能顺手把文件装进插件目录。

   解析顺序：
     1. 目录根下的 index.json / manifest.json / plugins.json（结构化清单，最省事）
     2. 目录列表页 HTML（nginx / Apache / IIS 三种常见排版都能认）
     3. 都没有就返回空清单并把错误信息带回界面
   ═══════════════════════════════════════════ */

const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const { PLUGIN_MAX_BYTES, PLUGIN_EXTENSIONS } = require('../core/constants');

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;   // 列表页本身的上限

/* 市场清单的候选地址，按顺序试：
   前两个是官方市场的 PHP 接口（?format=json 直接返回结构化清单，
   index.php 不带参数时返回 HTML 目录页，会被下面的 HTML 解析接住）；
   后面几个是常见的静态清单命名，方便别人自建市场。 */
/* 只试最有代表性的四个，且 403 立刻停手：
   403 说明整个目录被服务器拒绝，再换文件名也是一样的结果，
   继续挨个试只会让用户多等半分钟。 */
const JSON_CANDIDATES = [
    'index.php?format=json',
    'index.php',
    'index.json',
    'plugins.json'
];

/* 不少虚拟主机会拦掉「看起来像脚本」的请求（自定义 UA 直接 403），
   所以这里带一套正常浏览器的请求头，只在末尾留一个标识。 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SysbinStudioCode/2.0';

/* ── 基础请求：跟随重定向、可超时、可限体积 ── */
function request(urlString, options) {
    const opts = options || {};
    const timeout = opts.timeout || DEFAULT_TIMEOUT;
    const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
    const maxRedirects = opts.maxRedirects == null ? 5 : opts.maxRedirects;

    return new Promise(resolve => {
        let current = String(urlString || '').trim();
        let redirects = 0;
        let settled = false;

        const done = r => { if (settled) return; settled = true; resolve(r); };

        const step = () => {
            let u;
            try { u = new URL(current); } catch (e) { return done({ ok: false, status: 0, error: '无效的 URL：' + current }); }

            const lib = u.protocol === 'http:' ? http : https;
            const req = lib.request({
                protocol: u.protocol,
                hostname: u.hostname,
                port: u.port || (u.protocol === 'http:' ? 80 : 443),
                path: (u.pathname || '/') + (u.search || ''),
                method: 'GET',
                timeout,
                headers: {
                    'User-Agent': BROWSER_UA,
                    'Accept': 'application/json,text/html,*/*',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Accept-Encoding': 'identity'   // 自己不解压缩，直接要明文
                }
            }, res => {
                const status = res.statusCode || 0;

                if (status >= 300 && status < 400 && res.headers.location && redirects < maxRedirects) {
                    redirects++;
                    res.resume();
                    try { current = new URL(res.headers.location, u).toString(); }
                    catch (e) { return done({ ok: false, status, error: '重定向地址无效' }); }
                    step();
                    return;
                }

                const chunks = [];
                let size = 0;
                let overflow = false;
                res.on('data', d => {
                    size += d.length;
                    if (size > maxBytes) {
                        overflow = true;
                        try { req.destroy(); } catch (e) {}
                        return done({ ok: false, status, error: `响应超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限` });
                    }
                    chunks.push(d);
                });
                res.on('end', () => {
                    if (overflow) return;
                    const body = Buffer.concat(chunks);
                    done({
                        ok: status >= 200 && status < 300,
                        status,
                        url: current,
                        headers: res.headers || {},
                        contentType: String((res.headers && res.headers['content-type']) || ''),
                        body
                    });
                });
                res.on('error', e => done({ ok: false, status, error: String((e && e.message) || e) }));
            });

            req.on('timeout', () => {
                try { req.destroy(); } catch (e) {}
                done({ ok: false, status: 0, error: '请求超时' });
            });
            req.on('error', e => done({ ok: false, status: 0, error: String((e && e.message) || e) }));
            req.end();
        };

        step();
    });
}

async function fetchText(url, options) {
    const r = await request(url, options);
    if (!r.ok) return { ok: false, status: r.status, url: r.url, error: r.error || ('HTTP ' + r.status), text: '' };
    return { ok: true, status: r.status, url: r.url, text: r.body.toString('utf8') };
}

/* 下载插件源码（体积受 PLUGIN_MAX_BYTES 限制） */
async function download(url, options) {
    const r = await request(url, Object.assign({ maxBytes: PLUGIN_MAX_BYTES }, options || {}));
    if (!r.ok) return { ok: false, status: r.status, url: r.url, error: r.error || ('HTTP ' + r.status) };
    let name = '';
    try { name = decodeURIComponent(path.basename(new URL(r.url).pathname)); } catch (e) { name = ''; }
    return { ok: true, status: r.status, url: r.url, name, text: r.body.toString('utf8'), size: r.body.length };
}

/* ── 目录列表解析 ── */

function ensureSlash(u) {
    const s = String(u || '').trim();
    if (!s) return s;
    return s.endsWith('/') ? s : s + '/';
}

function stripTags(s) {
    return String(s || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseSize(text) {
    if (!text) return null;
    // IIS 会写成 2,048 这种千分位形式，先把数字里的逗号去掉再匹配
    const norm = String(text).replace(/(\d),(\d)/g, '$1$2');

    // 1. 人类可读：1.2K / 3.4 MB / 512M
    let m = /(^|\s)(\d+(?:\.\d+)?)\s*([KMGT])B?(?=\s|$)/i.exec(norm);
    if (m) {
        const n = parseFloat(m[2]);
        const unit = m[3].toUpperCase();
        const mul = { K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 }[unit] || 1;
        return Math.round(n * mul);
    }
    // 2. 纯字节：1791 B
    m = /(^|\s)(\d+)\s*B(?=\s|$)/i.exec(norm);
    if (m) return Number(m[2]);

    // 3. 行尾裸数字（有些列表只给数字）
    const tail = /(\d+)\s*$/.exec(norm);
    if (tail) return Number(tail[1]);
    return null;
}

function parseDate(text) {
    if (!text) return null;
    let m = /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(text);
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    // nginx/Apache 风格：08-Oct-2026 10:12
    m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(text);
    if (m) {
        const d = new Date(`${m[3]} ${m[2]} ${m[1]} ${m[4] || '00'}:${m[5] || '00'}`);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
}

function buildItem(name, url, isDir, size, modified, meta) {
    const m = meta || {};
    let ext = extOfUrl(url);
    /* 地址是脚本路由（?r=download&file=x.js）时，扩展名要从 file 参数里取，
       否则会被 index.php 的 .php 带偏，导致插件识别成不可安装 */
    if (!ext || ['.php', '.asp', '.aspx', '.jsp', '.cgi', ''].includes(ext)) {
        ext = path.extname(m.file || '');
    }
    if (!ext) ext = path.extname(String(name || ''));
    return {
        name,
        url,
        isDir: !!isDir,
        size: size || null,
        sizeText: size ? humanSize(size) : '',
        modified: modified || null,
        installable: !isDir && PLUGIN_EXTENSIONS.includes(ext),
        /* 备用下载地址：主地址（静态路径）404 时再试 PHP 的 download 路由 */
        altUrl: m.altUrl || '',
        /* 市场可选提供的元信息（同名 .json 或清单里写的） */
        version: m.version || '',
        description: m.description || m.desc || '',
        author: m.author || '',
        downloads: Number(m.downloads) || 0
    };
}

/* 从下载地址里取扩展名，用于判断该文件是不是可安装的插件 */
function extOfUrl(url) {
    try {
        const p = decodeURIComponent(new URL(url).pathname || '');
        return path.extname(p).toLowerCase();
    } catch (e) {
        return '';
    }
}

function humanSize(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1048576).toFixed(1) + ' MB';
}

/* 解析目录列表 HTML：逐个 <a href> 抓，再从锚点后面的文本里找日期与大小 */
function parseListing(html, baseUrl) {
    const items = [];
    const seen = new Set();
    const re = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;

    while ((m = re.exec(html))) {
        const href = m[1];
        let label = stripTags(m[2]);
        if (!href) continue;

        /* 形如 ?r=download&file=xxx.js 的下载链接要认（PHP 市场常这么写），
           只有排序类查询（?C=N;O=D）和纯锚点才跳过 */
        let queryFile = '';
        if (/^[?&#]/.test(href)) {
            const qm = /[?&](?:file|name|f)=([^&#]+)/i.exec(href);
            if (!qm) continue;
            try { queryFile = decodeURIComponent(qm[1]); } catch (e) { queryFile = qm[1]; }
        }

        let abs;
        try { abs = new URL(href, baseUrl).toString(); } catch (e) { continue; }
        if (abs === baseUrl) continue;

        const isDir = href.endsWith('/');
        let name = queryFile || decodeSafe(label || href);
        if (!name || name === 'Parent Directory' || name === '..') continue;

        // 锚点之后的上下文：取到下一个链接为止（有些页面把时间和大小换行排了，
        // 所以这里不能只取同一行，否则会漏掉大小）
        const tailRaw = html.slice(m.index + m[0].length, m.index + m[0].length + 400);
        const rowTail = tailRaw.split(/<\/tr>/i)[0].split(/<a\b/i)[0];
        const ctxText = stripTags(rowTail).replace(name, '');

        const size = parseSize(ctxText);
        const modified = parseDate(ctxText);

        if (seen.has(abs)) continue;
        seen.add(abs);
        items.push(buildItem(name, abs, isDir, size, modified, { file: queryFile || name }));
    }

    // 可安装的 JS 排前面，其余按名称
    items.sort((a, b) => (Number(b.installable) - Number(a.installable)) || a.name.localeCompare(b.name, 'zh'));
    return items;
}

function decodeSafe(s) {
    let out = String(s || '').trim();
    try { out = decodeURIComponent(out); } catch (e) {}
    return out.replace(/\/$/, '');
}

/* 结构化清单：字符串数组 或 { files / plugins / items : [...] } */
function itemsFromManifest(json, baseUrl) {
    let raw = null;
    if (Array.isArray(json)) raw = json;
    else if (json && Array.isArray(json.files)) raw = json.files;
    else if (json && Array.isArray(json.plugins)) raw = json.plugins;
    else if (json && Array.isArray(json.items)) raw = json.items;
    if (!raw) return null;

    return raw.map(it => {
        if (typeof it === 'string') {
            let abs;
            try { abs = new URL(it, baseUrl).toString(); } catch (e) { return null; }
            return buildItem(path.basename(new URL(abs).pathname) || it, abs, abs.endsWith('/'), null, null);
        }
        if (!it || typeof it !== 'object') return null;

        /* 下载地址优先用清单给的字段；很多市场（含官方 PHP）只给 file，
           这时按「download 路由 + 静态路径」两个候选都准备好，安装时依次尝试 */
        const nm = it.name || it.file || it.title || '';
        if (!nm) return null;
        const file = it.file || it.name || '';

        let url = '';
        try { url = new URL(it.url || it.download || it.path || '', baseUrl).toString(); } catch (e) { url = ''; }
        let fallback = '';
        try { fallback = new URL(it.staticUrl || file || nm, baseUrl).toString(); } catch (e) { fallback = ''; }
        if (!url) {
            /* 没有 url：先走 PHP 的 download 路由（中文文件名也不会 404），再退静态路径 */
            url = file ? baseUrl + '?r=download&file=' + encodeURIComponent(file) : fallback;
            if (url === fallback) fallback = '';
        }

        return buildItem(nm, url, !!it.isDir || String(url).endsWith('/'),
            Number(it.size) || null, it.modified || it.mtime || it.updated || null,
            Object.assign({}, it, {
                description: it.description || it.desc || it.summary || '',
                altUrl: fallback,
                file
            }));
    }).filter(Boolean);
}

/* 抓取目录清单。baseUrl 为空时用默认市场地址。 */
async function fetchListing(rawUrl) {
    const baseUrl = ensureSlash(rawUrl);
    if (!baseUrl) return { ok: false, url: baseUrl, items: [], error: '市场地址为空' };

    let lastError = '';
    let blocked = false;

    // 1. 结构化清单
    for (const name of JSON_CANDIDATES) {
        let url;
        try { url = new URL(name, baseUrl).toString(); } catch (e) { continue; }
        const r = await fetchText(url, { timeout: 5000, maxBytes: DEFAULT_MAX_BYTES });

        if (!r.ok) {
            lastError = r.status === 403
                ? '服务器拒绝了访问（HTTP 403）'
                : (r.status === 404 ? '' : (r.error || ('HTTP ' + r.status)));
            if (r.status === 403) { blocked = true; break; }   // 整个目录不给访问，别再试了
            continue;
        }
        let json = null;
        try { json = JSON.parse(r.text); } catch (e) { continue; }
        const items = itemsFromManifest(json, baseUrl);
        if (!items) continue;
        /* 市场自己报错（比如目录不可读）时把原因带回去，界面才能说清楚 */
        if (json && json.status && json.status !== 'ok') {
            return {
                ok: false, url: baseUrl, source: name, items,
                error: String(json.message || ('市场返回状态：' + json.status))
            };
        }
        return { ok: true, url: baseUrl, source: name, items };
    }

    // 2. 目录列表页
    const page = await fetchText(baseUrl, { timeout: 8000 });
    if (!page.ok) {
        return {
            ok: false,
            url: baseUrl,
            items: [],
            error: blocked ? lastError
                : (page.status === 403 ? '服务器拒绝了访问（HTTP 403）'
                    : page.status === 404 ? '市场目录不存在（HTTP 404）'
                        : (page.error || ('HTTP ' + page.status))),
            status: page.status
        };
    }
    const items = parseListing(page.text, baseUrl);
    if (!items.length) {
        return {
            ok: true, url: baseUrl, source: 'html', items: [],
            error: '目录为空或无法识别列表格式' + (lastError ? '（' + lastError + '）' : '')
        };
    }
    return { ok: true, url: baseUrl, source: 'html', items };
}

module.exports = { request, fetchText, download, fetchListing, parseListing, humanSize, ensureSlash };
