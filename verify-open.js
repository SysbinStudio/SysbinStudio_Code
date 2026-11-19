/*
 * 确认白名单内的文档地址能真正调用系统浏览器（会打开浏览器窗口，属预期行为）
 */
process.env.SYSBIN_SELFTEST = '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });
    await win.loadURL('about:blank');

    const t0 = Date.now();
    const raw = await win.webContents.executeJavaScript(`
        window.sysbin.openExternal('https://www.123pen.cn/ssc/docs/')
    `, true).catch(e => ({ ok: false, error: String(e) }));

    const ms = Date.now() - t0;
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    console.log('\n════════ 打开外部文档 ════════');
    console.log('  返回       ' + JSON.stringify(r));
    console.log('  耗时       ' + ms + ' ms');
    console.log('──────────────────────────────');
    console.log(r && r.ok ? '✅ 已调用系统默认浏览器打开文档' : '❌ 失败: ' + (r && r.error));
    setTimeout(() => app.exit(r && r.ok ? 0 : 1), 200);
});