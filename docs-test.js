/*
 * 「文档」菜单项验证：菜单是否出现 + 外链白名单是否生效
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

    const raw = await win.webContents.executeJavaScript(`
(async () => {
    const A = window.sysbin;
    const out = {};

    // 1. 打开帮助菜单，检查是否含「文档」
    document.querySelector('[data-menu="help"]').click();
    await new Promise(r => setTimeout(r, 400));
    const pop = document.getElementById('menu-pop');
    out.menuVisible = pop && (pop.classList.contains('show') || getComputedStyle(pop).display !== 'none');
    const items = pop ? [...pop.querySelectorAll('*')].map(e => (e.textContent || '').trim()) : [];
    const uniq = [...new Set(items)].filter(t => t && t.length < 20);
    out.menuItems = uniq;
    out.hasDoc = uniq.some(t => t === '文档');
    out.docIsFirst = uniq.indexOf('文档') >= 0 && uniq.indexOf('文档') === 0;
    document.body.click();

    // 2. 白名单：非白名单地址应被拒绝
    out.denyOther = await A.openExternal('https://evil.example.com/steal');
    // 3. 白名单：http 应被拒绝
    out.denyHttp = await A.openExternal('http://www.123pen.cn/ssc/docs/');
    // 4. 空白应被拒绝
    out.denyEmpty = await A.openExternal('');

    return JSON.stringify(out);
})()
`, true).catch(e => JSON.stringify({ fatal: String(e) }));

    let r;
    try { r = JSON.parse(raw); } catch (e) { r = { fatal: raw }; }

    const lines = ['════════ 「文档」菜单验证 ════════'];
    if (r.fatal) { lines.push('❌ ' + r.fatal); finish(1, lines); return; }

    lines.push('  帮助菜单弹出    ' + (r.menuVisible ? 'OK' : '❌'));
    lines.push('  菜单项          ' + JSON.stringify(r.menuItems));
    lines.push('  含「文档」项    ' + (r.hasDoc ? 'OK' : '❌ 缺失'));
    lines.push('  「文档」置顶    ' + (r.docIsFirst ? 'OK' : '否'));
    lines.push('  --- 外链白名单 ---');
    lines.push('  非白名单地址    ' + (r.denyOther && r.denyOther.ok === false ? 'OK 已拒绝（' + r.denyOther.error + '）' : '❌ 未拒绝'));
    lines.push('  http 地址       ' + (r.denyHttp && r.denyHttp.ok === false ? 'OK 已拒绝（' + r.denyHttp.error + '）' : '❌ 未拒绝'));
    lines.push('  空字符串        ' + (r.denyEmpty && r.denyEmpty.ok === false ? 'OK 已拒绝' : '❌ 未拒绝'));

    const pass = r.hasDoc && r.menuVisible &&
                 r.denyOther && r.denyOther.ok === false &&
                 r.denyHttp && r.denyHttp.ok === false &&
                 r.denyEmpty && r.denyEmpty.ok === false;

    lines.push('──────────────────────────────');
    lines.push(pass ? '✅ 全部通过（未验证项：实际打开浏览器）' : '❌ 存在问题');
    lines.push('提示：白名单通过后需人工点一次「帮助 → 文档」确认浏览器能打开。');

    win.destroy();
    finish(pass ? 0 : 1, lines);
});