'use strict';

/* ═══════════════════════════════════════════
   插件加载器

   插件接口约定（两种形态，任选其一）：

   1) 单文件插件 —— 任意一个 .js 文件：
        module.exports = {
            id: 'my-plugin',          // 可选，缺省用文件名
            name: '我的插件',
            version: '1.0.0',
            description: '……',
            author: '……',
            activate(api) { api.registerCommand({ ... }); },
            deactivate() {}
        };
      也支持直接导出函数：module.exports = function (api) { ... }

   2) 目录插件 —— 一个文件夹，里面有 package.json（可用 main 指定入口）
      或 index.js / main.js / <目录名>.js。

   加载即 require()：插件运行在主进程，与编辑器同本机信任级别，
   因此只从用户数据目录下的 plugins 目录加载，不扫别处。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { PLUGIN_EXTENSIONS } = require('../core/constants');

function hasPluginExt(file) {
    return PLUGIN_EXTENSIONS.includes(path.extname(String(file)).toLowerCase());
}

function readPackage(dir) {
    try {
        const f = path.join(dir, 'package.json');
        if (!fs.existsSync(f)) return null;
        const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
        return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) {
        return null;
    }
}

/* 找入口 JS：文件直接返回；目录按 package.json.main → index.js → main.js → <目录名>.js */
function resolveEntry(target) {
    let st;
    try { st = fs.statSync(target); } catch (e) { return null; }
    if (st.isFile()) return hasPluginExt(target) ? target : null;
    if (!st.isDirectory()) return null;

    const pkg = readPackage(target);
    const candidates = [];
    if (pkg && pkg.main) candidates.push(pkg.main);
    candidates.push('index.js', 'main.js', path.basename(target) + '.js');
    for (const c of candidates) {
        if (!c || typeof c !== 'string') continue;
        const full = path.isAbsolute(c) ? c : path.join(target, c);
        try {
            if (fs.existsSync(full) && fs.statSync(full).isFile() && hasPluginExt(full)) return full;
        } catch (e) {}
    }
    return null;
}

function safeId(raw) {
    const s = String(raw || '').trim().toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s || 'plugin';
}

/* 兼容 export default（有些插件作者会按 ESM 习惯写） */
function unwrap(mod) {
    if (mod && typeof mod === 'object' && !Array.isArray(mod) && mod.default && typeof mod.default !== 'undefined') {
        const d = mod.default;
        if (typeof d === 'function' || (d && typeof d === 'object')) return d;
    }
    return mod;
}

/* 归一化导出：统一成 { id, name, version, ..., activate, deactivate } */
function normalize(mod, entryFile) {
    const m = unwrap(mod) || {};
    const dir = path.dirname(entryFile);
    const pkg = readPackage(dir);

    let meta = {};
    let activate = null;
    let deactivate = null;

    if (typeof m === 'function') {
        activate = m;
        meta = (m.meta && typeof m.meta === 'object') ? m.meta : {};
    } else if (m && typeof m === 'object') {
        meta = m;
        if (typeof m.activate === 'function') activate = m.activate;
        if (typeof m.deactivate === 'function') deactivate = m.deactivate;
    }

    const base = path.basename(entryFile, path.extname(entryFile));
    const id = safeId(meta.id || (pkg && pkg.name) || base);

    return {
        id,
        name: String(meta.name || (pkg && (pkg.displayName || pkg.name)) || id),
        version: String(meta.version || (pkg && pkg.version) || '0.0.0'),
        description: String(meta.description || (pkg && pkg.description) || ''),
        author: String(meta.author || (pkg && pkg.author && (pkg.author.name || pkg.author)) || ''),
        homepage: String(meta.homepage || (pkg && pkg.homepage) || ''),
        entry: entryFile,
        dir,
        activate,
        deactivate,
        manifest: meta
    };
}

/* require 一个插件文件；会先清缓存，保证「重新加载」拿到的是新代码 */
function loadEntry(entryFile) {
    const abs = path.resolve(entryFile);
    try { delete require.cache[abs]; } catch (e) {}
    const mod = require(abs);
    const info = normalize(mod, abs);
    if (typeof info.activate !== 'function' && typeof mod !== 'function') {
        // 纯声明式插件（只导出元信息）也允许，只是没有可执行的激活逻辑
        info.activate = null;
    }
    return info;
}

/* 扫描插件目录：返回可直接 loadEntry 的入口列表 */
function scanDir(dir) {
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const en of entries) {
        if (en.name.startsWith('.') || en.name === 'node_modules') continue;
        const full = path.join(dir, en.name);
        const entry = resolveEntry(full);
        if (entry) out.push({ path: full, entry, id: safeId(en.isDirectory() ? en.name : path.basename(en.name, path.extname(en.name))) });
    }
    return out;
}

module.exports = { resolveEntry, loadEntry, scanDir, safeId, readPackage, hasPluginExt };
