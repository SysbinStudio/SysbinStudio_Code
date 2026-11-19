'use strict';

/* ═══════════════════════════════════════════
   环境信息与设置 IPC
   关于页 / 设置页展示用的运行时信息，Python 解释器探测与切换。
   ═══════════════════════════════════════════ */

const os = require('os');
const { app, ipcMain } = require('electron');
const { spawnSync } = require('child_process');
const { APP_NAME } = require('../core/constants');
const paths = require('../core/paths');
const settings = require('../core/settings');
const config = require('../core/config');
const python = require('./python');
const { decodeOut } = require('../util/text');

function envInfo() {
    return {
        appVersion: app.getVersion(),
        name: APP_NAME,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        v8: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        locale: app.getLocale(),
        appPath: app.getAppPath(),
        userData: paths.userData(),
        home: os.homedir(),
        isPackaged: app.isPackaged,
        pythonPath: python.findPython(),
        pythonBundled: !!python.bundledPython(),
        kernelDir: python.kernelDir(),
        settingsPath: settings.filePath(),
        /* 设置与插件清单都在这一个文件里 */
        configPath: config.path(),
        /* 插件相关：插件页面 / 市场会用到 */
        pluginsDir: paths.pluginsDir()
    };
}

function register() {
    ipcMain.handle('env-info', async () => envInfo());

    ipcMain.handle('set-python-path', async (e, p) => {
        const resolved = python.setCustomPath((p && String(p).trim()) || null);
        return { ok: true, custom: !!((p && String(p).trim())), pythonPath: resolved };
    });

    ipcMain.handle('test-python', async (e, p) => {
        const target = (p && String(p).trim()) || python.findPython();
        const script = 'import sys\nprint(sys.version.split()[0])\nimport importlib.util as u\nprint("yaml=" + ("yes" if u.find_spec("yaml") else "no"))\n';
        let r;
        try { r = spawnSync(target, ['-c', script], { timeout: 20000, windowsHide: true }); }
        catch (err) { return { ok: false, path: target, error: String((err && err.message) || err) }; }
        if (r.error) return { ok: false, path: target, error: String(r.error.message || r.error) };
        if (r.status !== 0) {
            return {
                ok: false, path: target,
                error: (decodeOut(r.stderr || Buffer.alloc(0)) || '退出码 ' + r.status).trim().split('\n')[0]
            };
        }
        const lines = decodeOut(r.stdout || Buffer.alloc(0)).trim().split(/\r?\n/);
        return { ok: true, path: target, version: (lines[0] || '').trim(), yaml: lines.some(l => l.trim() === 'yaml=yes') };
    });

    ipcMain.handle('settings-load', async () => ({ ok: true, path: settings.filePath(), data: settings.read() }));

    ipcMain.handle('settings-save', async (e, data) => {
        const merged = Object.assign({}, settings.read() || {}, (data && typeof data === 'object') ? data : {});
        merged.updatedAt = new Date().toISOString();
        return settings.write(merged);
    });

    ipcMain.handle('settings-reset', async () => settings.reset());
}

module.exports = { register, envInfo };
