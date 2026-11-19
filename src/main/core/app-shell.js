'use strict';

/* ═══════════════════════════════════════════
   应用外壳

   职责：单实例锁、窗口创建、生命周期事件、外部传入路径的投递。
   业务相关的 IPC 一律不在这里，分在 services/ 与 plugins/ 下。
   ═══════════════════════════════════════════ */

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const context = require('./context');
const paths = require('./paths');
const { APP_NAME } = require('./constants');

/* ══════ 启动参数 ══════
   支持 `Sysbin Studio Code.exe <文件或文件夹>`：资源管理器「打开方式」、
   双击已关联文件、命令行传参都走这条路。 */

let pendingTargets = [];
let rendererReady = false;

/* Electron 自身的开关（--inspect 之类）与本应用无关，要剔除掉。
   只把剩下的、且在磁盘上真实存在的路径当作待打开目标。 */
function targetsFromArgv(argv) {
    const list = (argv || []).slice(1);

    /* 开发态（electron . 或 electron xxx.js）下 argv[1] 是应用入口本身，
       用户真正想打开的路径从 argv[2] 才开始；打包态 argv[1] 起就是用户路径。
       process.defaultApp 正是用来区分这两种情况的。*/
    if (process.defaultApp) list.shift();

    const out = [];
    for (const raw of list) {
        if (typeof raw !== 'string' || !raw) continue;
        if (raw.startsWith('-')) continue;                        // --inspect / --no-sandbox 等
        if (raw === '.' || raw === paths.appRoot()) continue;     // 打包/调试启动时传入的应用目录
        let abs;
        try { abs = path.resolve(raw); } catch (e) { continue; }
        if (abs === __filename) continue;                         // 开发态入口脚本本身
        try { if (abs === path.resolve(process.execPath)) continue; } catch (e) {}   // 可执行文件自身
        try { if (fs.existsSync(abs)) out.push(abs); } catch (e) {}
    }
    return out;
}

/* 目标一律先攒在主进程，渲染层就绪后主动来取。
   不能在 did-finish-load 时直接 push：那一刻 Monaco 还在异步加载，
   渲染层的接收器尚未注册，消息会被静默丢掉（表现为只打开部分文件）。 */
function deliverTargets(list) {
    if (!rendererReady) { pendingTargets = pendingTargets.concat(list); return false; }
    return context.send('open-targets', list);
}

function addTargets(list) {
    if (!list || !list.length) return;
    deliverTargets(list);
}

/* ══════ 窗口 ══════ */

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 800,
        minHeight: 520,
        backgroundColor: '#11111b',
        title: APP_NAME,
        show: false,
        webPreferences: {
            preload: paths.preloadFile(),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,            // 允许从 CDN 加载 Monaco 资源
            allowRunningInsecureContent: true
        }
    });
    context.setWindow(win);
    win.loadFile(paths.indexHtml());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { context.setWindow(null); rendererReady = false; });
    return win;
}

/* 渲染层 boot 完成后调用：取走冷启动攒下的路径，并标记后续可以直推。 */
function registerIpc() {
    ipcMain.handle('open-targets-take', async () => {
        rendererReady = true;
        const list = pendingTargets;
        pendingTargets = [];
        return list;
    });
}

function start() {
    registerIpc();
    pendingTargets = targetsFromArgv(process.argv);

    /* 单实例：第二次双击文件时把路径转交已有窗口，而不是再开一个新壳。
       自检模式下由 selftest.js 自行管理窗口。 */
    const gotLock = process.env.SYSBIN_SELFTEST ? true : app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
        return;
    }

    app.on('second-instance', (e, argv) => {
        const list = targetsFromArgv(argv);
        if (!list.length) return;
        const win = context.getWindow();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
            addTargets(list);
        } else {
            pendingTargets = pendingTargets.concat(list);
        }
    });

    /* macOS：Finder「打开方式」走 open-file 事件，不走 argv。 */
    app.on('open-file', (e, p) => {
        e.preventDefault();
        const list = [path.resolve(p)];
        const win = context.getWindow();
        if (win) { win.focus(); addTargets(list); }
        else pendingTargets = pendingTargets.concat(list);
    });

    app.whenReady().then(() => {
        Menu.setApplicationMenu(null);   // 使用自绘标题栏 / 菜单
        /* 调试钩子：SYSBIN_DEBUG=1 打印渲染层报错 */
        if (process.env.SYSBIN_DEBUG) {
            const win = context.getWindow();
            if (win) {
                win.webContents.on('console-message', (e, level, message, line, src) => {
                    if (level >= 2) console.log('[renderer:' + level + ']', message, src + ':' + line);
                });
            }
        }
        // 自检模式下由 selftest.js 自行管理窗口，这里不创建
        if (process.env.SYSBIN_SELFTEST) return;
        if (!context.getWindow()) createWindow();
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

module.exports = { start, createWindow, targetsFromArgv, addTargets };
