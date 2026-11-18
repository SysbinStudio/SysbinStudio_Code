/* 回归测试：外部传入路径能否真正打开（对应「双击文件 / 右键打开方式 / 命令行传参」）。
 *
 * 这个测试绝不能设 SYSBIN_SELFTEST —— 设了 main.js 就不会自建窗口，
 * 测到的就不是真实启动链路了（曾经踩过这个坑）。
 *
 * 用法：
 *   electron argv-open-test.js <文件1> [文件夹] [文件2> ...
 * 不传参数则自动用一批固定样本。
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

/* 命令行给的路径在 argv[2..]；没给就用固定样本。
   开发态下 argv[1] 是 Electron 自己的入口脚本（也就是本文件）。*/
const given = process.argv.slice(2).filter(p => path.resolve(p) !== __filename);
const samples = given.length ? given : [
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, 'kernel.py'),
    path.join(__dirname, 'src'),
    path.join(__dirname, '不存在的文件.js')
];

/* 主进程是在 require('./main.js') 那一刻读 argv 的，
   所以样本必须在那之前写进 process.argv，否则主进程根本看不到它们。*/
process.argv = [process.argv[0], __filename].concat(samples);

require('./main.js');

app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) { console.log('❌ 没有窗口'); app.exit(1); return; }

    let ready = false;
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
            if (await win.webContents.executeJavaScript('!!(window.__readyProbe && window.__readyProbe())', true)) { ready = true; break; }
        } catch (e) {}
    }
    // open-targets 的异步链路（stat + readFile）需要额外时间
    await new Promise(r => setTimeout(r, 3000));

    const res = await win.webContents.executeJavaScript(`(function(){
        var out = { errors: (window.__errors||[]).slice(0,3) };
        try {
            out.tabs = window.__state.tabs.map(function(t){ return t.path || t.name; });
            out.root = window.__state.root;
            var m = window.__state.tabs[window.__state.active];
            out.active = (m && m.path) || '(无)';
            out.contentLen = m && m.model ? m.model.getValue().length : 0;
        } catch(e){ out.err = String(e); }
        return out;
    })()`, true).catch(e => ({ error: String(e) }));

    /* ── 断言 ── */
    const lines = [];
    let pass = true;
    const check = (ok, label) => { if (!ok) pass = false; lines.push((ok ? '  ✅ ' : '  ❌ ') + label); };

    check(ready, '渲染层就绪');
    check(!(res && res.errors && res.errors.length), '无渲染层报错：' + JSON.stringify((res && res.errors) || []));

    /* 传入的每个文件都应成为标签；每个文件夹都应成为工作区根 */
    const openedTabs = (res && res.tabs) || [];
    for (const p of samples) {
        let st = null;
        try { st = fs.statSync(p); } catch (e) {}
        if (!st) continue;
        const abs = path.resolve(p);
        if (st.isDirectory()) check(res.root === abs, '文件夹已设为工作区：' + path.basename(abs));
        else check(openedTabs.includes(abs), '文件已打开：' + path.basename(abs));
    }

    /* 欢迎页占位不应残留在标签栏 */
    check(!openedTabs.some(t => /^未命名-/.test(t)), '启动占位标签已清除：' + JSON.stringify(openedTabs));

    console.log('\n════ 外部打开回归测试 ════');
    console.log('  样本       ' + JSON.stringify(samples.map(s => path.basename(s))));
    console.log('  打开的标签 ' + JSON.stringify(openedTabs.map(t => path.basename(t))));
    console.log('  工作区根   ' + (res && res.root ? path.basename(res.root) : '(无)'));
    console.log('  当前标签   ' + (res && res.active ? path.basename(res.active) : '(无)'));
    lines.forEach(l => console.log(l));
    console.log('──────────────────────────────');
    console.log(pass ? '✅ 全部通过' : '❌ 存在失败项');

    setTimeout(() => { try { app.exit(pass ? 0 : 1); } catch (e) { process.exit(pass ? 0 : 1); } }, 200);
});