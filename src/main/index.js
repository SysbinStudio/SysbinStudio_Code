'use strict';

/* ═══════════════════════════════════════════
   主进程装配入口

   目录约定：
     core/      应用外壳、窗口、设置、共享上下文、常量与路径
     util/      无状态工具（编码、文件系统）
     services/  文件、工作区、搜索、命令、终端、二进制、Python、环境
     plugins/   插件加载器 / API / 注册表 / 市场 / IPC

   每个 service 统一暴露 register(ctx)，由这里统一装配；
   相互之间没有隐式全局依赖，单独 require 也不会触发副作用。
   ═══════════════════════════════════════════ */

const { app } = require('electron');
const context = require('./core/context');
const settings = require('./core/settings');
const appShell = require('./core/app-shell');

const python = require('./services/python');
const files = require('./services/files');
const workspace = require('./services/workspace');
const search = require('./services/search');
const commands = require('./services/commands');
const terminal = require('./services/terminal');
const binary = require('./services/binary');
const environment = require('./services/environment');
const ai = require('./services/ai');

const plugins = require('./plugins');

/* 顺序即注册顺序；彼此无依赖，出错也不影响其余模块 */
const SERVICES = [
    python,       // Python 内核探测与调用
    files,        // 文件读写
    workspace,    // 目录树与文件操作
    search,       // 全局搜索 / 快速打开
    commands,     // 单次命令执行
    terminal,     // 常驻 PowerShell 终端
    binary,       // 十六进制 / 字符串 / PE
    environment,  // 环境信息与设置
    ai,           // AI 助手代理（ai-chat / ai-chat-abort）
    plugins       // 插件系统（内部会再注册一批 plugin-* 通道）
];

let started = false;

function start() {
    if (started) return;
    started = true;

    /* 设置里的 Python 路径变更 → 同步给内核服务（settings 不反向依赖业务） */
    settings.onChange(data => {
        if (data && typeof data.pythonPath === 'string') python.setCustomPath(data.pythonPath.trim() || null);
    });
    const saved = settings.read();
    if (saved && typeof saved.pythonPath === 'string' && saved.pythonPath.trim()) {
        python.setCustomPath(saved.pythonPath.trim());
    }

    for (const svc of SERVICES) {
        try {
            svc.register(context);
        } catch (e) {
            console.error('[boot] 模块注册失败：', e && (e.stack || e.message));
        }
    }

    /* 退出前收掉常驻终端，避免 powershell 变孤儿进程 */
    app.on('before-quit', () => terminal.shutdown());

    appShell.start();
}

module.exports = { start, context, settings, plugins };
