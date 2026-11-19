/* 自动化冒烟测试：无头加载界面，检查渲染层是否真正可用，然后退出。 */
process.env.SYSBIN_SELFTEST = '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');   // 注册全部 IPC handler

let win;

function finish(code, lines) {
    lines.forEach(l => console.log(l));
    setTimeout(() => { try { app.exit(code); } catch (e) { process.exit(code); } }, 300);
}

app.whenReady().then(async () => {
    win = new BrowserWindow({
        show: false,
        width: 1200, height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            allowRunningInsecureContent: true
        }
    });

    const errors = [];
    win.webContents.on('console-message', (e, level, message) => {
        if (level >= 2) errors.push('[console:' + level + '] ' + message);
    });
    win.webContents.on('did-fail-load', (e, code, desc) => errors.push('[load-fail] ' + desc));

    await win.loadFile(path.join('src', 'index.html'));

    // 等待 Monaco 加载 + boot 完成（最多 25 秒）
    let ready = false;
    for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
            const ok = await win.webContents.executeJavaScript(
                '!!(window.__readyProbe && window.__readyProbe())', true);
            if (ok) { ready = true; break; }
        } catch (e) {}
    }

    const res = await win.webContents.executeJavaScript(`(function(){
        var out = {};
        out.hasAPI = !!(window.sysbin && window.sysbin.readFile);
        out.monacoLoaded = !!(window.monaco && window.monaco.editor && !window.monaco.editor.__stub);
        try {
            out.editorExists = !!(window.__editor && window.__editor.getValue);
            out.editorIsFallback = !!(window.__editor && window.__editor.__fallback);
        } catch(e) { out.editorExists = false; }
        try { out.tabCount = window.__state.tabs.length; } catch(e){ out.tabCount = -1; }
        try { out.activeContent = window.__state.tabs[window.__state.active].model.getValue().slice(0,40); } catch(e){ out.activeContent = ''; }
        // 检查 DOM 是否绑定了事件：模拟点击活动栏
        try {
            var btn = document.querySelector('.ab-item[data-view="search"]');
            btn.click();
            out.viewSwitch = document.getElementById('view-search').classList.contains('active');
        } catch(e) { out.viewSwitch = 'ERR:' + e.message; }
        try {
            var b2 = document.querySelector('.tb-menu-item');
            b2.click();
            out.menuOpens = document.getElementById('menu-pop').classList.contains('show');
            document.body.click();
        } catch(e) { out.menuOpens = 'ERR:' + e.message; }
        try {
            document.getElementById('st-terminal').click();
            out.panelToggles = document.getElementById('panel').classList.contains('hidden');
        } catch(e) { out.panelToggles = 'ERR:' + e.message; }
        out.errors = window.__errors || [];
        return JSON.stringify(out);
    })()`, true);

    const r = JSON.parse(res);
    const lines = [];
    lines.push('──────── 冒烟测试结果 ────────');
    lines.push('preload API        : ' + (r.hasAPI ? 'OK' : '❌ 缺失'));
    lines.push('Monaco 已加载      : ' + (r.monacoLoaded ? 'OK（本地资源）' : '否'));
    lines.push('编辑器实例         : ' + (r.editorExists ? (r.editorIsFallback ? '降级 textarea' : 'Monaco') : '❌ 无'));
    lines.push('标签页数量         : ' + r.tabCount);
    lines.push('初始文档           : ' + JSON.stringify(r.activeContent));
    lines.push('侧栏视图切换       : ' + r.viewSwitch);
    lines.push('菜单弹出           : ' + r.menuOpens);
    lines.push('终端面板切换       : ' + r.panelToggles);
    if (r.errors.length) { lines.push('渲染层错误         : '); r.errors.forEach(e => lines.push('   ' + e)); }
    else lines.push('渲染层错误         : 无');
    if (errors.length) { lines.push('控制台错误:'); errors.slice(0, 12).forEach(e => lines.push('   ' + e)); }

    // ── 真实 IPC 链路测试 ──
    const ipc = await win.webContents.executeJavaScript(`(async function(){
        const R = {};
        const A = window.sysbin;
        const tmp = 'F:/Sysbin Code/1.0.0/_selftest';
        await A.createDir(tmp);   // 已存在则忽略错误

        // 1. 读内核文件
        const kp = 'F:/Sysbin Code/1.0.0/kernel.py';
        let rd = await A.readFile(kp);
        R.readFile = rd.ok ? ('OK ' + rd.content.length + ' 字符') : ('❌ ' + rd.error);

        // 2. 写文件 + 回读
        const tf = 'F:/Sysbin Code/1.0.0/_selftest/t-selftest.js';
        let wr = await A.writeFile({path: tf, content: 'const a=1; // 测试中文'});
        R.writeFile = wr.ok ? 'OK' : ('❌ ' + wr.error);
        let rd2 = await A.readFile(tf);
        R.roundtrip = (rd2.ok && rd2.content === 'const a=1; // 测试中文') ? 'OK 中文无损' : '❌ 内容不一致';

        // 3. 列目录
        let dd = await A.readDir('F:/Sysbin Code/1.0.0');
        R.readDir = dd.ok ? ('OK ' + dd.items.length + ' 项') : ('❌ ' + dd.error);

        // 4. 全局搜索
        let se = await A.searchText({root:'F:/Sysbin Code/1.0.0/src', query:'monaco', max:20});
        R.search = se.ok ? ('OK ' + se.results.length + ' 命中 / 扫描 ' + (se.scanned||0) + ' 文件') : ('❌ ' + se.error);

        // 5. 文件名搜索
        let sf = await A.searchFiles({root:'F:/Sysbin Code/1.0.0', query:'kernel', max:10});
        R.searchFiles = sf.ok ? ('OK ' + sf.results.length + ' 个') : ('❌ ' + sf.error);

        // 6. Python 内核
        let kr = await A.invoke({action:'json_fmt', raw:'{"b":1,"a":2}', mode:'pretty'});
        try { const p = JSON.parse(kr); R.kernel = p.result ? 'OK' : ('❌ ' + (p.error||'')); } catch(e){ R.kernel = '❌ 解析失败 ' + kr; }

        // 7. 环境信息
        let env = await A.envInfo();
        R.env = env && env.electron ? ('OK Electron ' + env.electron + ' / Python ' + (env.pythonBundled?'内置':'系统')) : '❌';

        // 8. 设置读写
        let ss = await A.saveSettings({fontSize: 15});
        let sl = await A.loadSettings();
        R.settings = (ss.ok && sl.data && sl.data.fontSize === 15) ? 'OK 持久化生效' : '❌';

        // 9. 终端会话
        let sh = await A.shellStart({cwd: tmp});
        R.shellStart = sh && sh.ok ? 'OK' : ('❌ ' + (sh && sh.error));
        await new Promise(r=>setTimeout(r,1500));
        let sn = await A.shellStatus();
        R.shellRunning = sn && sn.running ? ('OK cwd=' + (sn.cwd||'-')) : '❌ 未运行';
        await A.shellStop();

        // 10. 单次命令执行
        let cm = await A.runCommand({cmd:'echo hello-sysbin', cwd: tmp, timeout:15000});
        R.runCommand = (cm && cm.stdout && cm.stdout.includes('hello-sysbin')) ? 'OK' : ('❌ ' + JSON.stringify(cm).slice(0,120));

        // 清理
        try { await A.deletePath(tf); } catch(e){}
        return JSON.stringify(R);
    })()`, true);

    const q = JSON.parse(ipc);
    lines.push('──────── IPC 链路 ────────');
    Object.keys(q).forEach(k => lines.push(k.padEnd(14) + ' : ' + q[k]));

    const ipcOk = ['readFile','writeFile','roundtrip','readDir','search','searchFiles','kernel','env','settings','shellStart','shellRunning','runCommand']
        .every(k => String(q[k]).startsWith('OK'));

    const okAll = r.hasAPI && r.editorExists && r.tabCount > 0 && r.viewSwitch === true && r.menuOpens === true && ipcOk;
    lines.push('──────────────────────────────');
    lines.push(okAll ? '✅ 全部通过' : '❌ 存在问题');
    finish(okAll ? 0 : 1, lines);
});

app.on('window-all-closed', () => app.quit());
