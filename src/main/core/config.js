'use strict';

/* ═══════════════════════════════════════════
   统一配置存储：<数据目录>/config.json

   一份文件装两类数据，省得设置和插件各写各的、互相覆盖：

     {
       "version": 2,
       "app":     { …编辑器设置：主题、字号、Python 路径… },
       "plugins": { "插件id": { id, name, enabled, config:{…} … } },
       "updatedAt": "2026-10-09T…"
     }

   - 段（section）返回的是活引用，改完调 save() 落盘
   - 写盘走临时文件 + 重命名，崩溃也不会写坏
   - 首次使用会把旧的 settings.json / plugins.json 迁移进来（旧文件保留作备份）
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const CONFIG_VERSION = 2;

let cache = null;
let migrated = false;
const listeners = [];

function filePath() { return paths.configFile(); }

/* 旧版本散落的两个文件，迁移时用 */
function legacyFiles() {
    return [
        { section: 'app', file: paths.settingsFile() },
        { section: 'plugins', file: path.join(paths.userData(), 'plugins.json') }
    ];
}

function empty() {
    return { version: CONFIG_VERSION, app: {}, plugins: {}, updatedAt: null };
}

function readDisk() {
    const f = filePath();
    try {
        if (fs.existsSync(f)) {
            const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                if (!obj.app || typeof obj.app !== 'object') obj.app = {};
                if (!obj.plugins || typeof obj.plugins !== 'object') obj.plugins = {};
                return obj;
            }
        }
    } catch (e) {
        console.error('[config] 读取失败：', e && e.message);
    }
    return null;
}

/* 老版本留下来的 settings.json / plugins.json 合进新文件，旧文件保留不动 */
function migrateFrom(data) {
    if (migrated) return data;
    migrated = true;
    let touched = false;
    for (const item of legacyFiles()) {
        if (Object.keys(data[item.section] || {}).length) continue;      // 新文件里已有内容就不用搬
        try {
            if (!fs.existsSync(item.file)) continue;
            const obj = JSON.parse(fs.readFileSync(item.file, 'utf8'));
            if (obj && typeof obj === 'object') {
                data[item.section] = item.section === 'plugins' ? obj : obj;
                touched = true;
            }
        } catch (e) {
            console.error('[config] 迁移失败：', item.file, e && e.message);
        }
    }
    if (touched) {
        try { writeDisk(data); } catch (e) {}
    }
    return data;
}

function writeDisk(data) {
    const f = filePath();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    const text = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, text, 'utf8');
    try {
        fs.renameSync(tmp, f);
    } catch (e) {
        fs.writeFileSync(f, text, 'utf8');
        try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
    }
}

function load() {
    if (cache) return cache;
    cache = readDisk();
    if (!cache) {
        cache = empty();
        migrateFrom(cache);
    }
    return cache;
}

/* 取一个段（app / plugins）；不存在就建一个空的 */
function section(name) {
    const data = load();
    if (!data[name] || typeof data[name] !== 'object') data[name] = {};
    return data[name];
}

function save() {
    const data = load();
    data.version = CONFIG_VERSION;
    data.updatedAt = new Date().toISOString();
    try {
        writeDisk(data);
        notify();
        return true;
    } catch (e) {
        console.error('[config] 写入失败：', e && e.message);
        return false;
    }
}

/* 清空某一段（另一段保留）；不传名字就是整个文件归零 */
function reset(name) {
    const data = load();
    if (name === 'app' || name === 'plugins') {
        data[name] = {};
        save();
        return true;
    }
    try { fs.rmSync(filePath(), { force: true }); } catch (e) {}
    cache = empty();
    save();
    return true;
}

function notify() {
    for (const fn of listeners) {
        try { fn(load()); } catch (e) { console.error('[config] 变更回调异常：', e && e.message); }
    }
}

function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
    };
}

module.exports = { path: filePath, load, section, save, reset, onChange };
