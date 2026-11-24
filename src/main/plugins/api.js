'use strict';

/* ═══════════════════════════════════════════
   插件 API

   每个插件激活时拿到一份自己的 api 实例，作用域隔离：
   - 命令只挂在自己名下，卸载时自动摘掉
   - 配置写在自己命名空间里，不污染全局 settings.json
   - 注册的 IPC 通道统一加 plugin:<id>: 前缀

   插件作者拿到的东西（api.*）：
     log / info / warn / error   写「输出」面板
     notify(text, kind)          右上角提示条
     registerCommand(cmd)        注册命令，出现在命令面板里
     on(event, handler)          订阅编辑器事件（file:open / file:save / app:ready …）
     emit(event, payload)        向渲染层广播自定义事件
     window.send(channel, data)  给渲染层发自定义消息
     ipc.handle(channel, fn)     注册一个可从渲染层 invoke 的通道
     settings.get / set / all    插件私有配置（持久化到 plugins.json）
     editor.openFile / insertText / activeFile
     shell.run(cmd, cwd)         跑一条命令，拿 stdout/stderr
     http.get(url)               取远程文本（受体积上限约束）
     fs / path / os              Node 内置模块
     dispose(fn)                 注册停用时要执行的清理动作
   ═══════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain, dialog } = require('electron');
const commandsService = require('../services/commands');
const market = require('./market');

function createApi(opts) {
    const { record, ctx, hooks } = opts;
    const id = record.id;

    const log = (text, level) => {
        ctx.send('plugin-log', { pluginId: id, text: String(text), level: level || 'info' });
    };

    const api = {
        /* ── 元信息 ── */
        id,
        name: record.name,
        version: record.version,
        manifest: Object.assign({}, record.manifest || {}),
        /* 插件自己的安装目录：想放数据文件就建个子目录，卸载时会一起删掉 */
        pluginDir: record.dir || (record.entry ? path.dirname(record.entry) : null),

        /* ── 日志与提示 ── */
        log: text => log(text, 'info'),
        info: text => log(text, 'info'),
        warn: text => log(text, 'warn'),
        error: text => log(text, 'err'),
        notify: (text, kind) => ctx.send('plugin-notify', { pluginId: id, text: String(text), kind: kind || 'info' }),

        /* ── 命令 ── */
        registerCommand(cmd) {
            if (!cmd || !cmd.id) throw new Error('registerCommand 需要提供 id');
            const full = String(cmd.id).includes(':') ? String(cmd.id) : `${id}:${cmd.id}`;
            const def = {
                id: full,
                pluginId: id,
                title: String(cmd.title || cmd.label || full),
                handler: typeof cmd.handler === 'function' ? cmd.handler : (typeof cmd.run === 'function' ? cmd.run : null)
            };
            hooks.addCommand(def);
            log(`已注册命令 ${full}`, 'info');
            return full;
        },
        registerCommands(list) {
            return (list || []).map(c => api.registerCommand(c));
        },
        executeCommand(commandId, args) {
            return hooks.runCommand(commandId, args);
        },

        /* ── 事件 ── */
        on(event, handler) {
            if (typeof handler !== 'function') return () => {};
            hooks.addListener(String(event), handler, id);
            return () => hooks.removeListener(String(event), handler);
        },
        emit(event, payload) {
            ctx.send('plugin-event', { pluginId: id, event: String(event), payload });
        },

        /* ── 窗口通信 ── */
        window: {
            send(channel, payload) {
                return ctx.send('plugin-message', { pluginId: id, channel: String(channel), payload });
            },
            notify: (text, kind) => api.notify(text, kind)
        },

        /* ── 自定义 IPC ── */
        ipc: {
            handle(channel, handler) {
                const full = `plugin:${id}:${channel}`;
                ipcMain.removeHandler(full);
                ipcMain.handle(full, async (e, ...args) => {
                    try { return await handler(...args); }
                    catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
                });
                hooks.addIpcChannel(full);
                return full;
            }
        },

        /* ── 私有配置 ── */
        settings: {
            get(key, def) {
                const cfg = record.config || (record.config = {});
                const v = cfg[key];
                return v === undefined ? def : v;
            },
            set(key, value) {
                if (!record.config) record.config = {};
                record.config[key] = value;
                hooks.persist();
                return value;
            },
            all() { return Object.assign({}, record.config || {}); }
        },

        /* ── 编辑器 ── */
        editor: {
            /* 让编辑器打开一个文件（渲染层收到后走正常打开流程） */
            openFile(p) {
                if (!p) return false;
                ctx.send('plugin-open-file', { pluginId: id, path: String(p) });
                return true;
            },
            insertText(text) {
                ctx.send('plugin-edit', { pluginId: id, action: 'insert', text: String(text) });
                return true;
            },
            activeFile() { return hooks.activeFile(); }
        },

        /* ── 系统对话框（走主进程，窗口未就绪时也能弹） ── */
        dialog: {
            openFile(options) {
                const opts = Object.assign({ properties: ['openFile'] }, options || {});
                return dialog.showOpenDialog(ctx.getWindow(), opts);
            },
            openFolder(options) {
                const opts = Object.assign({ properties: ['openDirectory'] }, options || {});
                return dialog.showOpenDialog(ctx.getWindow(), opts);
            },
            saveFile(options) {
                return dialog.showSaveDialog(ctx.getWindow(), options || {});
            }
        },

        /* ── 其它能力 ── */
        shell: {
            run: (cmd, cwd, timeout) => commandsService.run(cmd, cwd, timeout)
        },
        http: {
            get: (url, options) => market.fetchText(url, options)
        },

        /* ── 插件页面 / 侧边栏图标 ──
           让插件把「设置 / 页面」放进代码区的新标签页，并在活动栏加图标。
           插件市场已有人工审核，插件与编辑器同本机信任级别。 */
        registerPage(opts) {
            if (!opts || !opts.id) throw new Error('registerPage 需要提供 id');
            const def = Object.assign({ pluginId: id }, opts);
            hooks.addPage(def);
            log(`已注册页面 ${id}/${def.id}`, 'info');
            return def.id;
        },
        /* 更新一个已注册页面的内容（html/title/icon），并刷新已打开的标签页。
           不会重复登记页面列表——配置变更后面板要显示最新值时用它。 */
        updatePage(opts) {
            if (!opts || !opts.id) return false;
            const def = Object.assign({ pluginId: id }, opts);
            ctx.send('plugin-message', { pluginId: id, channel: 'page:update', payload: def });
            return true;
        },
        openPage(ref) {
            if (!ref) return false;
            const payload = (typeof ref === 'string') ? { pluginId: id, pageId: ref } : Object.assign({ pluginId: id }, ref);
            hooks.openPage(payload);
            return true;
        },
        /* 订阅插件页面 / 图标的交互事件（按钮 data-action 点击等） */
        onPageEvent(handler) {
            hooks.setPageHandler(handler);
            return () => hooks.setPageHandler(null);
        },

        /* 命令执行：让插件直接跑一条 shell 命令，拿标准输出 / 错误。
           返回 { ok, code, stdout, stderr, timeout, spawnError } */
        exec(cmd, opts) {
            const cwd = opts && opts.cwd;
            const timeout = opts && opts.timeout;
            return commandsService.run(String(cmd), cwd, timeout).then(r => ({
                ok: !r.spawnError && !r.timeout,
                code: r.code,
                stdout: r.stdout || '',
                stderr: r.stderr || '',
                timeout: !!r.timeout,
                spawnError: !!r.spawnError
            }));
        },

        /* 停用时要做的清理 */
        dispose(fn) {
            if (typeof fn === 'function') hooks.addDisposer(fn);
        },

        /* Node 内置：本机工具型编辑器，插件与编辑器同信任级别 */
        fs, path, os
    };

    return api;
}

module.exports = { createApi };
