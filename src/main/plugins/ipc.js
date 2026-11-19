'use strict';

/* ═══════════════════════════════════════════
   插件相关 IPC
   渲染层通过这里管理插件与访问市场，不直接碰文件系统和网络。

   通道一览：
     plugins-list            已安装插件清单
     plugins-commands        插件注册的命令（命令面板用）
     plugins-run-command     执行某个插件命令
     plugins-install-local   弹对话框挑一个 .js 安装
     plugins-install-path    安装指定路径
     plugins-install-url     从 URL 下载并安装
     plugins-uninstall       卸载
     plugins-toggle          启用 / 停用
     plugins-reload          重新加载（改完代码不用重启编辑器）
     plugins-open-dir        打开插件目录
     plugins-market-fetch    拉取市场目录清单
     plugins-market-install  从市场安装某一项
     plugins-event           渲染层 → 插件的事件（file:open / file:save …）
   ═══════════════════════════════════════════ */

const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const registry = require('./registry');
const market = require('./market');
const { MARKET_URL, PLUGIN_EXTENSIONS } = require('../core/constants');

const PLUGIN_FILTERS = [
    { name: '插件脚本', extensions: PLUGIN_EXTENSIONS.map(e => e.replace(/^\./, '')) },
    { name: '所有文件', extensions: ['*'] }
];

function register(ctx) {
    registry.init(ctx);

    ipcMain.handle('plugins-list', async () => ({ ok: true, plugins: registry.list() }));

    ipcMain.handle('plugins-commands', async () => ({ ok: true, commands: registry.commands() }));

    ipcMain.handle('plugins-run-command', async (e, payload) => {
        const p = payload || {};
        return registry.runCommand(p.id, p.args);
    });

    ipcMain.handle('plugins-install-local', async () => {
        const res = await dialog.showOpenDialog(ctx.getWindow(), {
            properties: ['openFile'],
            filters: PLUGIN_FILTERS
        });
        if (res.canceled || !res.filePaths || !res.filePaths.length) return { ok: false, canceled: true };
        return registry.installFromPath(res.filePaths[0]);
    });

    ipcMain.handle('plugins-install-path', async (e, p) => registry.installFromPath(p));

    ipcMain.handle('plugins-install-url', async (e, url) => {
        if (!url || !/^https?:\/\//i.test(String(url))) return { ok: false, error: '仅支持 http(s) 地址' };
        return registry.installFromUrl(String(url));
    });

    ipcMain.handle('plugins-uninstall', async (e, id) => registry.uninstall(id));

    ipcMain.handle('plugins-toggle', async (e, payload) => {
        const p = payload || {};
        return registry.setEnabled(p.id, !!p.enabled);
    });

    ipcMain.handle('plugins-reload', async (e, id) => registry.reload(id));

    ipcMain.handle('plugins-open-dir', async () => {
        const dir = registry.pluginsDir();
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
        try {
            const r = await shell.openPath(dir);
            return { ok: !r, path: dir, error: r || '' };
        } catch (err) { return { ok: false, path: dir, error: String((err && err.message) || err) }; }
    });

    ipcMain.handle('plugins-market-fetch', async (e, payload) => {
        const url = (payload && payload.url) || MARKET_URL;
        return market.fetchListing(url);
    });

    ipcMain.handle('plugins-market-install', async (e, payload) => {
        const url = payload && payload.url;
        if (!url) return { ok: false, error: '缺少下载地址' };
        return registry.installFromUrl(String(url));
    });

    /* 在市场页面打开某个链接。只允许 123pen.cn，避免被插件数据带偏到任意站点。 */
    ipcMain.handle('plugins-open-url', async (e, url) => {
        const u = String(url || '').trim();
        let host = '';
        try { host = new URL(u).hostname.toLowerCase(); } catch (err) { return { ok: false, error: '无效的地址' }; }
        if (!/^https?:$/i.test(new URL(u).protocol)) return { ok: false, error: '仅支持 http(s) 地址' };
        if (host !== '123pen.cn' && !host.endsWith('.123pen.cn')) return { ok: false, error: '只允许打开 123pen.cn 的链接' };
        try { await shell.openExternal(u); return { ok: true }; }
        catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    });

    /* 渲染层事件：文件打开 / 保存等，转给订阅了的插件 */
    ipcMain.on('plugins-event', (e, payload) => {
        const p = payload || {};
        registry.emitEvent(p.event, p.payload);
    });

    /* 插件页面 / 图标里的交互（按钮点击等）由渲染层转发过来，路由到对应插件 */
    ipcMain.on('plugin:page-event', (e, payload) => {
        registry.routePageEvent(payload || {});
    });
}

module.exports = { register };
