'use strict';

/* ═══════════════════════════════════════════
   路径工具
   所有模块都从这里取路径，不各自拼 __dirname，
   这样目录结构调整时只需要改这一处。

   打包后本文件位于 app.asar/src/main/core/paths.js，
   因此应用根目录 = 上溯三级。
   ═══════════════════════════════════════════ */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let _appRoot = null;
let _userData = null;

/* 应用根目录：main.js / src / preload.js 都在这里 */
function appRoot() {
    if (_appRoot) return _appRoot;
    _appRoot = path.join(__dirname, '..', '..', '..');
    return _appRoot;
}

/* asar 解包目录：kernel.py 与内置 python 需要真实文件系统路径，
   Python 读不到 asar 包内的文件，所以 electron-builder 会把它们解包出来。 */
function unpackedRoot() {
    const root = appRoot();
    const unpacked = root.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
    try {
        return fs.existsSync(unpacked) ? unpacked : root;
    } catch (e) {
        return root;
    }
}

/* 用户数据目录：设置、插件、插件索引都放在这里 */
function userData() {
    if (_userData) return _userData;
    try { _userData = app.getPath('userData'); }
    catch (e) { _userData = path.join(appRoot(), '.userdata'); }
    return _userData;
}

/* 统一配置文件：编辑器设置 + 插件设置都在这里 */
function configFile() { return path.join(userData(), 'config.json'); }

/* 旧版本遗留（仅迁移时读取，不再写入） */
function settingsFile() { return path.join(userData(), 'settings.json'); }

function pluginsIndexFile() { return path.join(userData(), 'plugins.json'); }

/* 插件目录：每个插件一个子目录或单个 .js 文件 */
function pluginsDir() { return path.join(userData(), 'plugins'); }

function preloadFile() { return path.join(appRoot(), 'preload.js'); }

function indexHtml() { return path.join(appRoot(), 'src', 'index.html'); }

module.exports = {
    appRoot,
    unpackedRoot,
    userData,
    settingsFile,
    configFile,
    pluginsDir,
    pluginsIndexFile,
    preloadFile,
    indexHtml
};
