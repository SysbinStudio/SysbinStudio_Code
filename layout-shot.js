/*
 * 布局截图取证：直接看渲染结果，而不是靠几何推断
 */
process.env.SYSBIN_SELFTEST = '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');

const OUT = 'F:/Sysbin Code/1.0.2/shot.png';

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: true, width: 1092, height: 787,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });
    await win.loadFile(path.join(__dirname, 'src', 'index.html'));

    for (let i = 0; i < 60; i++) {
        const r = await win.webContents.executeJavaScript('!!(window.__editor)', true).catch(() => false);
        if (r) break;
        await new Promise(r2 => setTimeout(r2, 500));
    }

    await win.webContents.executeJavaScript(`
(() => {
    document.getElementById('welcome').classList.add('show');
    const box = document.getElementById('welcome-recent');
    box.innerHTML = '<div class="wc-title">最近打开</div>';
    for (let i = 1; i <= 9; i++) {
        const b = document.createElement('button');
        b.className = 'wc-item';
        b.textContent = 'F:\\\\Sysbin IDE\\\\Sysbin Studio 2.0.0 绿色版\\\\payload_' + i + '.bin';
        box.appendChild(b);
    }
})()
`, true);
    await new Promise(r => setTimeout(r, 900));

    const img = await win.webContents.capturePage();
    fs.writeFileSync(OUT, img.toPNG());

    const geo = await win.webContents.executeJavaScript(`
(() => {
    const w = document.getElementById('welcome');
    const p = document.getElementById('panel');
    const inner = document.querySelector('.welcome-inner');
    const cs = getComputedStyle(w);
    return JSON.stringify({
        welcomeRect: (r => [Math.round(r.top), Math.round(r.bottom)])(w.getBoundingClientRect()),
        innerRect: (r => [Math.round(r.top), Math.round(r.bottom)])(inner.getBoundingClientRect()),
        panelRect: (r => [Math.round(r.top), Math.round(r.bottom)])(p.getBoundingClientRect()),
        welcomePos: cs.position, welcomeZ: cs.zIndex, welcomeOverflow: cs.overflow,
        panelZ: getComputedStyle(p).zIndex, panelPos: getComputedStyle(p).position,
        hitAtPanel: (h => h ? (h.id || h.className) : 'null')(document.elementFromPoint(600, 512))
    });
})()
`, true);

    console.log(geo);
    console.log('截图已保存: ' + OUT);
    setTimeout(() => app.exit(0), 200);
});