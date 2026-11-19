'use strict';

/* ═══════════════════════════════════════════
   插件注册表

   管三件事：
   1. 持久化 —— <userData>/plugins.json 记录装了什么、是否启用、私有配置
   2. 生命周期 —— 扫描 <userData>/plugins 目录，启用 / 停用 / 重载 / 卸载
   3. 贡献点收集 —— 各插件注册的命令与事件订阅，卸载时一并摘掉

   插件跑在主进程，与本编辑器同本机信任级别；
   所以只从用户数据目录下的 plugins 目录加载，不扫别处。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const paths = require('../core/paths');
const config = require('../core/config');
const loader = require('./loader');
const { createApi } = require('./api');

let ctx = null;

const plugins = new Map();     // id -> record
const commands = new Map();    // commandId -> { id, pluginId, title, handler }
const listeners = new Map();   // event -> [{ pluginId, handler }]
let lastActiveFile = null;


function pluginsDir() { return paths.pluginsDir(); }

/* 已安装插件与插件私有配置都放在 config.json 的 plugins 段 */
function persist() {
    const out = config.section('plugins');
    for (const k of Object.keys(out)) delete out[k];
    for (const [id, r] of plugins) {
        out[id] = {
            id,
            name: r.name,
            version: r.version,
            description: r.description,
            author: r.author,
            entry: r.entry,
            source: r.source || 'local',
            url: r.url || '',
            enabled: r.enabled !== false,
            installedAt: r.installedAt || null,
            config: r.config || {}
        };
    }
    return config.save();
}

function loadIndex() {
    try {
        const map = config.section('plugins') || {};
        for (const id of Object.keys(map)) {
            const it = map[id];
            if (!it || typeof it !== 'object') continue;
            plugins.set(id, {
                id,
                name: it.name || id,
                version: it.version || '0.0.0',
                description: it.description || '',
                author: it.author || '',
                entry: it.entry || '',
                dir: it.entry ? path.dirname(it.entry) : path.join(pluginsDir(), id),
                source: it.source || 'local',
                url: it.url || '',
                enabled: it.enabled !== false,
                installedAt: it.installedAt || null,
                config: it.config || {},
                state: 'idle',
                error: null,
                activate: null,
                deactivate: null,
                manifest: {},
                instance: null,
                commands: [],
                disposers: [],
                ipcChannels: [],
                pages: [],
                pageHandler: null
            });
        }
    } catch (e) {
        console.error('[plugins] 索引读取失败：', e && e.message);
    }
}

/* ══════ 生命周期 ══════ */

function hooksFor(record) {
    return {
        persist,
        addCommand(def) {
            commands.set(def.id, def);
            if (record.commands.indexOf(def.id) < 0) record.commands.push(def.id);
        },
        addListener(event, handler, pluginId) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push({ pluginId, handler });
        },
        removeListener(event, handler) {
            const arr = listeners.get(event);
            if (!arr) return;
            const i = arr.findIndex(x => x.handler === handler);
            if (i >= 0) arr.splice(i, 1);
        },
        addDisposer(fn) { record.disposers.push(fn); },
        addIpcChannel(full) { record.ipcChannels.push(full); },
        /* 插件页面：登记后通知渲染层注册（含侧边栏图标）；打开时通知渲染层开标签页 */
        addPage(def) {
            if (!Array.isArray(record.pages)) record.pages = [];
            record.pages.push(def);
            ctx.send('plugin-message', { pluginId: record.id, channel: 'page:register', payload: def });
        },
        openPage(ref) {
            ctx.send('plugin-message', { pluginId: record.id, channel: 'page:open', payload: ref });
        },
        setPageHandler(fn) { record.pageHandler = (typeof fn === 'function') ? fn : null; },
        runCommand: (commandId, args) => runCommand(commandId, args),
        activeFile: () => lastActiveFile
    };
}

function activate(record) {
    if (!record.activate) { record.state = 'loaded'; return true; }
    const api = createApi({ record, ctx, hooks: hooksFor(record) });
    let result = null;
    try {
        result = record.activate(api);
    } catch (e) {
        record.state = 'error';
        record.error = String((e && e.message) || e);
        console.error(`[plugins] ${record.id} 激活失败：`, record.error);
        return false;
    }
    /* activate 可以直接返回一个函数（= deactivate）或带 deactivate 的对象 */
    if (typeof result === 'function') record.deactivate = result;
    else if (result && typeof result.deactivate === 'function') record.deactivate = result.deactivate;

    record.instance = result || null;
    record.state = 'active';
    record.error = null;
    return true;
}

function deactivate(record) {
    /* 先撤销贡献点，再跑插件自己的清理 */
    for (const cid of (record.commands || []).slice()) commands.delete(cid);
    record.commands = [];
    for (const [event, arr] of listeners) {
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i].pluginId === record.id) arr.splice(i, 1);
    }
    for (const ch of record.ipcChannels.slice()) { try { ipcMain.removeHandler(ch); } catch (e) {} }
    record.ipcChannels = [];

    /* 撤销插件页面与侧边栏图标 */
    if (record.pages && record.pages.length) {
        ctx.send('plugin-message', { pluginId: record.id, channel: 'page:unregister', payload: {} });
    }
    record.pages = [];
    record.pageHandler = null;

    for (const fn of record.disposers.slice().reverse()) {
        try { fn(); } catch (e) { console.error(`[plugins] ${record.id} 清理异常：`, e && e.message); }
    }
    record.disposers = [];

    if (typeof record.deactivate === 'function') {
        try { record.deactivate(); }
        catch (e) { console.error(`[plugins] ${record.id} 停用异常：`, e && e.message); }
    }
    record.deactivate = null;
    record.instance = null;
    record.state = 'disabled';
}

/* 把 loader 拿到的元信息合并进记录 */
function mergeInfo(record, info) {
    record.name = info.name || record.name;
    record.version = info.version || record.version;
    record.description = info.description || record.description;
    record.author = info.author || record.author;
    record.entry = info.entry;
    record.dir = info.dir;
    record.activate = info.activate;
    record.deactivate = info.deactivate || null;
    record.manifest = info.manifest || {};
    return record;
}

/* ══════ 安装 ══════ */

function copyRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    if (typeof fs.cpSync === 'function') {
        fs.cpSync(src, dest, { recursive: true });
        return;
    }
    for (const en of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, en.name);
        const d = path.join(dest, en.name);
        if (en.isDirectory()) copyRecursive(s, d);
        else fs.copyFileSync(s, d);
    }
}

function destFor(id, isDir) {
    return isDir ? path.join(pluginsDir(), id) : path.join(pluginsDir(), id + '.js');
}

/* 目标在插件目录下的「顶层」路径，用于整体删除 */
function topLevelOf(entry) {
    const rel = path.relative(pluginsDir(), entry);
    if (!rel || rel.startsWith('..')) return null;
    const first = rel.split(path.sep)[0];
    return first ? path.join(pluginsDir(), first) : null;
}

function removeFiles(record) {
    const target = topLevelOf(record.entry);
    if (!target) return;
    try {
        const st = fs.statSync(target);
        fs.rmSync(target, { recursive: !!st.isDirectory(), force: true });
    } catch (e) {
        console.error('[plugins] 删除文件失败：', e && e.message);
    }
}

function freshRecord(info, source, url) {
    return {
        id: info.id,
        name: info.name,
        version: info.version,
        description: info.description,
        author: info.author,
        homepage: info.homepage || '',
        entry: info.entry,
        dir: info.dir,
        source: source || 'local',
        url: url || '',
        enabled: true,
        installedAt: new Date().toISOString(),
        config: {},
        state: 'idle',
        error: null,
        activate: info.activate,
        deactivate: info.deactivate || null,
        manifest: info.manifest || {},
        instance: null,
        commands: [],
        disposers: [],
        ipcChannels: [],
        pages: [],
        pageHandler: null
    };
}

/* 从本地路径安装：可以是 xxx.js，也可以是插件文件夹 */
function installFromPath(target, options) {
    const opts = options || {};
    if (!target) return { ok: false, error: '缺少路径' };

    const entry = loader.resolveEntry(target);
    if (!entry) {
        return { ok: false, error: '不是有效的插件：需要 .js 文件，或含 index.js / package.json 的插件文件夹' };
    }

    /* 先试加载一次，确认它真的能被 require，顺便拿到元信息 */
    let info;
    try {
        info = loader.loadEntry(entry);
    } catch (e) {
        return { ok: false, error: '插件加载失败：' + String((e && e.message) || e) };
    }

    /* 同 id 已存在 → 覆盖安装：先卸载旧的 */
    if (plugins.has(info.id)) uninstall(info.id);

    /* 拷进插件目录，之后一律从插件目录加载，避免源文件被改动/删除 */
    let isDir = false;
    try { isDir = fs.statSync(target).isDirectory(); } catch (e) {}
    const dest = destFor(info.id, isDir);
    try {
        if (isDir) copyRecursive(target, dest);
        else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(target, dest); }
    } catch (e) {
        return { ok: false, error: '写入插件目录失败：' + String((e && e.message) || e) };
    }

    const newEntry = loader.resolveEntry(dest);
    if (!newEntry) return { ok: false, error: '插件拷贝到目录后找不到入口文件' };

    try {
        info = loader.loadEntry(newEntry);
    } catch (e) {
        return { ok: false, error: '插件加载失败：' + String((e && e.message) || e) };
    }

    const rec = freshRecord(info, opts.source || 'local', opts.url || '');
    plugins.set(rec.id, rec);
    const okActivate = activate(rec);
    persist();

    return {
        ok: true,
        id: rec.id,
        name: rec.name,
        version: rec.version,
        activated: okActivate,
        error: rec.error,
        replaced: true
    };
}

/* 从下载地址里取文件名：优先认 ?r=download&file=xxx 里的参数（中文名也可能在这里），
   否则取 URL 路径的最后一段 */
function fileNameFromUrl(url) {
    let u = null;
    try { u = new URL(String(url)); } catch (e) { u = null; }
    if (u && u.search) {
        const m = /[?&](?:file|name|f)=([^&]+)/i.exec(u.search);
        if (m) {
            try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
        }
    }
    if (u) {
        try { return decodeURIComponent((u.pathname || '').split('/').pop() || ''); } catch (e) {}
    }
    return String(url || '').split('?')[0].split('/').pop() || '';
}

/* 备用地址：静态路径 ↔ download 路由 互相兜底。
   中文文件名走静态路径常被服务器 404，走 PHP 路由则一定能拿到；反之亦然。 */
function altUrlFor(url) {
    let u = null;
    try { u = new URL(String(url)); } catch (e) { return ''; }
    const dir = u.origin + (u.pathname || '').replace(/[^/]*$/, '');
    const qm = /[?&](?:file|name|f)=([^&]+)/i.exec(u.search || '');
    if (qm) {
        let name = qm[1];
        try { name = decodeURIComponent(name); } catch (e) {}
        return dir + encodeURIComponent(name);      // 路由 → 静态
    }
    const base = (u.pathname || '').split('/').pop() || '';
    if (!base) return '';
    let name = base;
    try { name = decodeURIComponent(base); } catch (e) {}
    return dir + '?r=download&file=' + encodeURIComponent(name);   // 静态 → 路由
}

/* 从市场 / 任意 URL 安装一个 .js 插件文件 */
async function installFromUrl(url, options) {
    const market = require('./market');
    let r = await market.download(url);
    if (!r.ok) {
        /* 主地址不通就换一种取法再试一次（404 多为中文名 / 伪静态导致） */
        const alt = altUrlFor(url);
        if (alt && alt !== url) {
            const r2 = await market.download(alt);
            if (r2.ok) { r = r2; url = alt; }
        }
    }
    if (!r.ok) return { ok: false, error: r.error || ('下载失败（HTTP ' + (r.status || '?') + '）') };

    let name = String(r.name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    const fromUrl = fileNameFromUrl(url);
    if (fromUrl) name = fromUrl.replace(/[\\/:*?"<>|]/g, '_').trim();
    if (!/\.(js|cjs)$/i.test(name)) {
        /* URL 上没有后缀时，按插件 id 兜底命名 */
        name = (loader.safeId(name || 'remote-plugin')) + '.js';
    }
    const dest = path.join(pluginsDir(), name);
    try {
        fs.mkdirSync(pluginsDir(), { recursive: true });
        fs.writeFileSync(dest, r.text, 'utf8');
    } catch (e) {
        return { ok: false, error: '写入插件失败：' + String((e && e.message) || e) };
    }
    return installFromPath(dest, Object.assign({}, options || {}, { source: 'market', url: String(url) }));
}

function uninstall(id) {
    const rec = plugins.get(id);
    if (!rec) return { ok: false, error: '插件不存在：' + id };
    if (rec.state === 'active') deactivate(rec);
    try { delete require.cache[path.resolve(rec.entry)]; } catch (e) {}
    removeFiles(rec);
    plugins.delete(id);
    persist();
    return { ok: true, id };
}

function setEnabled(id, enabled) {
    const rec = plugins.get(id);
    if (!rec) return { ok: false, error: '插件不存在：' + id };
    if (rec.state === 'missing') return { ok: false, error: '插件文件已丢失，无法启用' };

    if (enabled) {
        rec.enabled = true;   // 关键：重新启用必须把开关写回 true，否则 persist 仍按 false 落盘，重启后不会再自动启用
        if (rec.state === 'active') { persist(); return { ok: true, id, state: rec.state }; }
        /* 首次启用或文件在磁盘上但还没 require 过 */
        if (!rec.activate) {
            try {
                const info = loader.loadEntry(rec.entry);
                mergeInfo(rec, info);
            } catch (e) {
                rec.state = 'error';
                rec.error = String((e && e.message) || e);
                persist();
                return { ok: false, error: '插件加载失败：' + rec.error };
            }
        }
        const okActivate = activate(rec);
        persist();
        return { ok: okActivate, id, state: rec.state, error: rec.error };
    }

    deactivate(rec);
    rec.enabled = false;
    persist();
    return { ok: true, id, state: rec.state };
}

function reload(id) {
    const rec = plugins.get(id);
    if (!rec) return { ok: false, error: '插件不存在：' + id };
    if (rec.state === 'active') deactivate(rec);
    try { delete require.cache[path.resolve(rec.entry)]; } catch (e) {}
    try {
        const info = loader.loadEntry(rec.entry);
        mergeInfo(rec, info);
    } catch (e) {
        rec.state = 'error';
        rec.error = String((e && e.message) || e);
        persist();
        return { ok: false, error: '重新加载失败：' + rec.error };
    }
    const okActivate = activate(rec);
    persist();
    return { ok: okActivate, id, state: rec.state, error: rec.error };
}

/* ══════ 查询 ══════ */

function list() {
    const out = [];
    for (const rec of plugins.values()) {
        out.push({
            id: rec.id,
            name: rec.name,
            version: rec.version,
            description: rec.description,
            author: rec.author,
            homepage: rec.homepage || '',
            entry: rec.entry,
            dir: rec.dir,
            source: rec.source || 'local',
            url: rec.url || '',
            enabled: !!rec.enabled,
            state: rec.state,
            error: rec.error,
            installedAt: rec.installedAt,
            commands: (rec.commands || []).map(cid => {
                const c = commands.get(cid);
                return c ? { id: c.id, title: c.title } : null;
            }).filter(Boolean),
            pages: (rec.pages || []).map(p => ({
                id: p.id, title: p.title || p.id, icon: p.icon || '◈', html: p.html || ''
            }))
        });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return out;
}

function commandsList() {
    const out = [];
    for (const c of commands.values()) out.push({ id: c.id, pluginId: c.pluginId, title: c.title });
    return out;
}

async function runCommand(commandId, args) {
    const c = commands.get(commandId);
    if (!c) return { ok: false, error: '命令不存在：' + commandId };
    if (typeof c.handler !== 'function') return { ok: false, error: '命令没有可执行的处理函数' };
    try {
        const result = await c.handler(args);
        return { ok: true, result: result === undefined ? null : result };
    } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
    }
}

/* 渲染层事件 → 插件订阅者 */
function emitEvent(event, payload) {
    const name = String(event || '');
    if (name === 'file:open' || name === 'file:save') {
        const p = payload && (payload.path || payload.file);
        if (p) lastActiveFile = String(p);
    }
    const arr = listeners.get(name);
    if (!arr || !arr.length) return { delivered: 0 };
    let n = 0;
    for (const item of arr.slice()) {
        try { item.handler(payload); n++; }
        catch (e) { console.error(`[plugins] 事件 ${name} 处理异常：`, e && e.message); }
    }
    return { delivered: n };
}

/* 插件页面 / 图标的交互事件（按钮点击等）→ 路由到该插件的 onPageEvent 处理器 */
function routePageEvent(payload) {
    const p = payload || {};
    const rec = plugins.get(p.pluginId);
    if (!rec || typeof rec.pageHandler !== 'function') return { delivered: 0 };
    try { rec.pageHandler(p); return { delivered: 1 }; }
    catch (e) { console.error(`[plugins] 页面事件处理异常：`, e && e.message); return { delivered: 0 }; }
}

/* ══════ 启动 ══════ */

function init(contextRef) {
    ctx = contextRef;
    loadIndex();

    try { fs.mkdirSync(pluginsDir(), { recursive: true }); } catch (e) {}

    const found = loader.scanDir(pluginsDir());
    const seen = new Set();

    for (const f of found) {
        let info;
        try {
            info = loader.loadEntry(f.entry);
        } catch (e) {
            console.error('[plugins] 加载失败：', f.entry, e && e.message);
            const rec = plugins.get(f.id);
            if (rec) { rec.state = 'error'; rec.error = String((e && e.message) || e); }
            continue;
        }
        const existing = plugins.get(info.id);
        const rec = existing || freshRecord(info, 'local', '');
        if (existing) {
            existing.entry = info.entry;
            mergeInfo(rec, info);
            existing.state = 'idle';
            existing.error = null;
        }
        plugins.set(rec.id, rec);
        seen.add(rec.id);
    }

    /* 索引里有、磁盘上已经没有的：保留条目并标出来，方便用户在界面上清理 */
    for (const rec of plugins.values()) {
        if (!seen.has(rec.id)) { rec.state = 'missing'; rec.error = '插件文件已丢失'; }
    }

    for (const rec of plugins.values()) {
        if (rec.enabled && rec.state !== 'missing') activate(rec);
    }
    persist();

    /* 插件在 activate 里订阅的 app:ready 会在本次激活批次之后收到 */
    setImmediate(() => emitEvent('app:ready', {}));

    return { total: plugins.size, active: Array.from(plugins.values()).filter(r => r.state === 'active').length };
}

module.exports = {
    init,
    list,
    commands: commandsList,
    runCommand,
    emitEvent,
    routePageEvent,
    installFromPath,
    installFromUrl,
    uninstall,
    setEnabled,
    reload,
    pluginsDir,
    record: id => plugins.get(id) || null
};
