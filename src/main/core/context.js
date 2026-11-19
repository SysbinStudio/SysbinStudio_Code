'use strict';

/* ═══════════════════════════════════════════
   主进程共享上下文

   只做两件事：
   1. 持有唯一的主窗口引用（窗口可能被关闭 / 重建，各模块不要自己缓存）
   2. 向渲染层广播消息

   service 与插件都通过它通信，互相之间不直接依赖窗口对象。
   ═══════════════════════════════════════════ */

const { app } = require('electron');

let mainWindow = null;

const context = {
    app,

    setWindow(w) { mainWindow = w; },

    /* 窗口已关闭 / 已销毁时返回 null，调用方不必重复判断 */
    getWindow() {
        try {
            return (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
        } catch (e) {
            return null;
        }
    },

    /* 广播：窗口不在或已销毁时静默失败，不抛异常打断业务流程 */
    send(channel, payload) {
        const w = context.getWindow();
        if (!w || !w.webContents) return false;
        try {
            w.webContents.send(channel, payload);
            return true;
        } catch (e) {
            return false;
        }
    }
};

module.exports = context;
