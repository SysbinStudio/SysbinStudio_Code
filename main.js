/*
 * Sysbin Studio Code — 主进程入口
 *
 * 这里只做三件事：关掉有问题的 GPU 沙箱、装配模块、启动应用外壳。
 * 具体功能实现全部在 src/main/ 下，按 core / util / services / plugins 分层：
 *
 *   core      应用外壳、窗口、设置持久化、共享上下文、常量与路径
 *   util      编码与文件系统等无状态工具
 *   services  文件、工作区、搜索、命令、终端、二进制、Python、环境
 *   plugins   插件加载器、插件 API、插件注册表、插件市场
 *
 * 注意：不要在这里写业务逻辑，否则又会堆成一个几千行的文件。
 */
'use strict';

const { app } = require('electron');

// 虚拟机 / 无显卡 / 受限沙箱环境下 GPU 进程会反复崩溃，统一走软件渲染；
// 本机 Chromium 沙箱实测会以 0xC0000005 崩溃，故一并关闭。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

require('./src/main').start();
