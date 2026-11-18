/*
 * 布局回归测试：欢迎页内容过长时是否溢出并盖住底部面板
 * 复现现场：1092x787 窗口 + 9 条「最近打开」
 */
process.env.SYSBIN_SELFTEST = '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');

function finish(code, lines) {
    console.log('\n' + lines.join('\n'));
    setTimeout(() => app.exit(code), 200);
}

async function measure(win, label) {
    const raw = await win.webContents.executeJavaScript(`
(() => {
    const host = document.getElementById('editor-host');
    const inner = document.querySelector('.welcome-inner');
    const panel = document.getElementById('panel');
    if (!host || !inner || !panel) return JSON.stringify({ fatal: '元素缺失' });
    const hb = host.getBoundingClientRect();
    const ib = inner.getBoundingClientRect();
    const pb = panel.getBoundingClientRect();
    const welcome = document.getElementById('welcome');

    // 判断一：overflow 可见且内容超出编辑区 => 必然溢出到面板
    const cs = getComputedStyle(welcome);
    const willOverflow = (cs.overflow === 'visible' || cs.overflowY === 'visible') &&
                         (ib.bottom > hb.bottom + 1);

    // 判断二：命中测试，探测点取欢迎内容列的水平中心（避开两侧空白区）
    let covered = false, hitTag = 'null';
    const probeX = Math.round(ib.left + ib.width / 2);
    for (const dy of [8, 24, 40]) {
        const hit = document.elementFromPoint(probeX, pb.top + dy);
        const isWelcome = !!(hit && (hit.id === 'welcome' || (hit.closest && hit.closest('#welcome'))));
        if (isWelcome) { covered = true; hitTag = (hit.id || hit.className || hit.tagName); break; }
        if (dy === 8) hitTag = hit ? (hit.id || hit.className || hit.tagName) : 'null';
    }

    return JSON.stringify({
        hostTop: Math.round(hb.top), hostBottom: Math.round(hb.bottom),
        innerTop: Math.round(ib.top), innerBottom: Math.round(ib.bottom),
        panelTop: Math.round(pb.top), panelBottom: Math.round(pb.bottom),
        willOverflow,
        panelCovered: covered,
        hitTag,
        welcomeOverflow: cs.overflowY,
        scrollable: welcome.scrollHeight > welcome.clientHeight,
        recentScrolls: (() => { const r = document.querySelector('.welcome-recent'); return r ? r.scrollHeight > r.clientHeight : false; })(),
        recentCount: document.querySelectorAll('.welcome-recent .wc-item').length
    });
})()
`, true);
    let o;
    try { o = JSON.parse(raw); } catch (e) { o = { fatal: raw }; }
    return Object.assign({ label }, o);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: true, width: 1092, height: 787,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });
    await win.loadFile(path.join(__dirname, 'src', 'index.html'));

    let ready = false;
    for (let i = 0; i < 60; i++) {
        ready = await win.webContents.executeJavaScript('!!(window.__editor)', true).catch(() => false);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }

    const lines = [];
    lines.push('════════ 欢迎页布局回归测试 ════════');
    if (!ready) { lines.push('❌ 初始化失败'); finish(1, lines); return; }

    // 注入 9 条最近打开，复现截图现场
    await win.webContents.executeJavaScript(`
(() => {
    // 复现「无标签页」时的欢迎页
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
    await new Promise(r => setTimeout(r, 500));

    const a = await measure(win, '1092x787 / 9 条最近打开');

    // 极端窗口：更矮
    win.setSize(900, 560);
    await new Promise(r => setTimeout(r, 700));
    const b = await measure(win, '900x560 / 9 条最近打开');

    for (const m of [a, b]) {
        lines.push('');
        lines.push('  [' + m.label + ']');
        if (m.fatal) { lines.push('    ❌ ' + m.fatal); continue; }
        lines.push('    编辑区范围    ' + m.hostTop + ' → ' + m.hostBottom);
        lines.push('    欢迎内容范围  ' + m.innerTop + ' → ' + m.innerBottom);
        lines.push('    面板起始位置  ' + m.panelTop);
        lines.push('    最近文件条数  ' + m.recentCount);
        lines.push('    内容超出编辑区  ' + (m.willOverflow ? '❌ 是（' + m.innerBottom + ' > ' + m.hostBottom + '）' : '否'));
        lines.push('    面板被遮挡    ' + (m.panelCovered ? '❌ 是（命中 ' + m.hitTag + '）' : 'OK 否（命中 ' + m.hitTag + '）'));
        lines.push('    welcome 溢出  ' + m.welcomeOverflow + (m.scrollable ? ' · 可滚动' : ' · 无需滚动'));
        lines.push('    列表区可滚动  ' + (m.recentScrolls ? '是' : '否'));
    }

    const pass = !a.fatal && !b.fatal &&
                 !a.willOverflow && !b.willOverflow &&
                 !a.panelCovered && !b.panelCovered;
    lines.push('──────────────────────────────');
    lines.push(pass ? '✅ 全部通过' : '❌ 存在问题');

    win.destroy();
    finish(pass ? 0 : 1, lines);
});