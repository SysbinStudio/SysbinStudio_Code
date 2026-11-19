'use strict';

/* ═══════════════════════════════════════════
   编辑器设置

   数据落在 <数据目录>/config.json 的 app 段（统一由 core/config.js 管），
   这里只做「设置」这一层语义封装，不直接碰文件。

   旧版本的 settings.json 会在首次启动时自动迁进来。
   ═══════════════════════════════════════════ */

const config = require('./config');

function filePath() { return config.path(); }

/* 没有设置内容时返回 null，和旧行为保持一致（渲染层据此判断要不要用默认值） */
function read() {
    const app = config.section('app');
    return Object.keys(app).length ? app : null;
}

/* 整段替换：先清空再写入，避免残留已删除的键 */
function write(obj) {
    const cur = config.section('app');
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, obj && typeof obj === 'object' ? obj : {});
    const ok = config.save();
    return { ok, path: filePath(), data: cur };
}

function reset() {
    config.reset('app');
    return { ok: true, path: filePath() };
}

function onChange(fn) { return config.onChange(fn); }

module.exports = { read, write, reset, onChange, filePath };
