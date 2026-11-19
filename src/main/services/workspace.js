'use strict';

/* ═══════════════════════════════════════════
   工作区服务
   目录树、新建 / 重命名 / 删除（回收站）、在资源管理器中显示、
   系统默认程序打开、外部文档白名单跳转。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');
const { IGNORED_DIRS } = require('../util/fs-util');
const { DOC_URL } = require('../core/constants');

/* 外部文档白名单：渲染层只能指定这里面的地址，
   否则一旦被注入脚本劫持就能借此打开任意页面。 */
const SAFE_EXTERNAL = new Set([DOC_URL]);

function register(ctx) {
    ipcMain.handle('read-dir', async (e, dir) => {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const items = entries
                .filter(i => !IGNORED_DIRS.has(i.name))
                .map(i => {
                    let size = 0;
                    try { if (!i.isDirectory()) size = fs.statSync(path.join(dir, i.name)).size; } catch (err) {}
                    return { name: i.name, path: path.join(dir, i.name), isDir: i.isDirectory(), size };
                });
            items.sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name, 'zh'));
            return { ok: true, dir, items };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('dialog-open-folder', async () => {
        const res = await dialog.showOpenDialog(ctx.getWindow(), { properties: ['openDirectory'] });
        if (res.canceled || !res.filePaths.length) return null;
        return res.filePaths[0];
    });

    ipcMain.handle('fs-create-file', async (e, target) => {
        try {
            if (fs.existsSync(target)) return { ok: false, error: '同名文件已存在' };
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, '', 'utf8');
            return { ok: true, path: target };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('fs-create-dir', async (e, target) => {
        try {
            if (fs.existsSync(target)) return { ok: false, error: '同名文件夹已存在' };
            fs.mkdirSync(target, { recursive: true });
            return { ok: true, path: target };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('fs-rename', async (e, payload) => {
        try {
            if (fs.existsSync(payload.to)) return { ok: false, error: '目标名称已存在' };
            fs.renameSync(payload.from, payload.to);
            return { ok: true, path: payload.to };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    // 删除走回收站（shell.trashItem），避免误删无法恢复
    ipcMain.handle('fs-delete', async (e, target) => {
        try {
            await shell.trashItem(target);
            return { ok: true, path: target, trashed: true };
        } catch (err) {
            return { ok: false, error: '移入回收站失败：' + err.message };
        }
    });

    ipcMain.handle('fs-reveal', async (e, target) => {
        try { shell.showItemInFolder(target); return { ok: true }; }
        catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('open-path', async (e, p) => {
        try {
            const r = await shell.openPath(String(p || ''));
            return { ok: !r, error: r || '' };
        } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    });

    ipcMain.handle('open-external', async (e, url) => {
        const u = String(url || '').trim();
        if (!SAFE_EXTERNAL.has(u)) return { ok: false, error: '该链接不在允许列表中' };
        if (!/^https:\/\//i.test(u)) return { ok: false, error: '仅允许 https 链接' };
        try { await shell.openExternal(u); return { ok: true }; }
        catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    });
}

module.exports = { register };
