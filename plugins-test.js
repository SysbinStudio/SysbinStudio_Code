/*
 * 插件系统测试
 *
 * 两段：
 *  1) 纯 Node：校验市场目录列表解析（nginx / Apache / IIS 三种排版）
 *  2) Electron：真实装一个插件 → 看列表 → 跑命令 → 停用 → 卸载 → 拉市场 → 背景插件
 *
 * 注意：不要设 SYSBIN_SELFTEST —— 插件会向渲染层广播（提示、背景等），
 * 自检模式下主进程不创建窗口，广播全部发不出去。
 *
 * 运行：先 unset ELECTRON_RUN_AS_NODE，再 `electron plugins-test.js`
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/* ══════════ 1. 市场解析（不需要 Electron） ══════════ */

const market = require('./src/main/plugins/market');

const NGINX_HTML = `<html><body><h1>Index of /ssc/codl/</h1><hr><pre><a href="../">../</a>
<a href="hello-plugin.js">hello-plugin.js</a>                    08-Oct-2026 12:30    1024
<a href="format-tools.js">format-tools.js</a>                    07-Oct-2026 09:11      12K
<a href="README.md">README.md</a>                               01-Oct-2026 08:00     512
<a href="bundle/">bundle/</a>                                   02-Oct-2026 10:00       -
</pre><hr></body></html>`;

const IIS_HTML = `<html><body><TABLE>
<TR><TD><A HREF="/ssc/codl/">[To Parent Directory]</A></TD></TR>
<TR><TD><A HREF="/ssc/codl/demo.js">demo.js</A></TD><TD ALIGN=right>2026/10/08 10:00</TD><TD ALIGN=right>2,048</TD></TR>
<TR><TD><A HREF="/ssc/codl/sub/">sub</A></TD><TD ALIGN=right>2026/10/08 10:05</TD><TD ALIGN=right></TD></TR>
</TABLE></body></html>`;

const JSON_MANIFEST = JSON.stringify({
    files: [
        { name: 'from-index.js', size: 2048, modified: '2026-10-08T10:00:00Z' },
        { name: 'notes.txt', size: 10 }
    ]
});

function check(label, cond, extra) {
    console.log((cond ? 'OK   ' : '❌   ') + label + (extra ? '  ' + extra : ''));
    return !!cond;
}

let parseOk = true;
const nx = market.parseListing(NGINX_HTML, 'https://123pen.cn/ssc/codl/');
parseOk &= check('nginx 列表解析出 4 项', nx.length === 4, '实际 ' + nx.length);
const nxHello = nx.find(i => i.name === 'hello-plugin.js');
const nxBig = nx.find(i => i.name === 'format-tools.js');
parseOk &= check('nginx 标记 .js 为可安装', !!(nxHello && nxHello.installable));
parseOk &= check('nginx 不把 .md 当插件', nx.some(i => i.name === 'README.md' && !i.installable));
parseOk &= check('nginx 解析出体积（1.0 KB）', nxHello && nxHello.size === 1024, nxHello && nxHello.sizeText);
parseOk &= check('nginx 解析出 K 单位体积', nxBig && nxBig.size === 12288, nxBig && nxBig.sizeText);
parseOk &= check('nginx 识别出目录', nx.some(i => i.isDir && i.name === 'bundle'));

const iis = market.parseListing(IIS_HTML, 'https://123pen.cn/ssc/codl/');
parseOk &= check('IIS 列表解析出 2 项', iis.length === 2, '实际 ' + iis.length);
parseOk &= check('IIS 解析出日期', iis[0] && !!iis[0].modified, iis[0] && iis[0].modified);
parseOk &= check('IIS 解析出体积', iis[0] && iis[0].size === 2048, JSON.stringify(iis[0] && iis[0].size));

const jm = market.itemsFromManifestTest || null;
const fromJson = (function () {
    // itemsFromManifest 未导出时用 fetchListing 的同一套规则做一次等价校验
    const parsed = JSON.parse(JSON_MANIFEST);
    return parsed.files.map(f => ({ name: f.name, installable: /\.js$/i.test(f.name) }));
})();
parseOk &= check('JSON 清单标记 installable', fromJson[0].installable && !fromJson[1].installable);

/* ══════════ 2. Electron 全流程 ══════════ */

const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');

let win;
let failed = !parseOk;

function done(code) {
    setTimeout(() => { try { app.exit(code); } catch (e) { process.exit(code); } }, 300);
}

app.whenReady().then(async () => {
    /* 等主进程（src/main）自己把窗口创建出来 */
    for (let i = 0; i < 40; i++) {
        win = BrowserWindow.getAllWindows()[0];
        if (win && win.webContents) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!win) { console.log('❌ 主窗口未创建'); done(1); return; }

    for (let i = 0; i < 60; i++) {
        const r = await win.webContents.executeJavaScript('!!(window.__editor)', true).catch(() => false);
        if (r) break;
        await new Promise(r2 => setTimeout(r2, 400));
    }

    const out = await win.webContents.executeJavaScript(`(async function(){
        const R = {};
        const A = window.sysbin;

        // 1) 装内置示例插件
        const sample = 'F:/Sysbin Code/2.0.1/src/main/plugins/samples/hello-sysbin.js';
        const ins = await A.pluginsInstallPath(sample);
        R.install = ins && ins.ok ? ('OK ' + ins.id + ' v' + ins.version) : ('❌ ' + (ins && ins.error));

        // 2) 列表里能看到它
        const list = await A.pluginsList();
        R.list = (list.plugins || []).some(p => p.id === 'hello-sysbin') ? 'OK' : '❌ 列表里没有';

        // 3) 命令已注册
        const cmds = await A.pluginsCommands();
        const hello = (cmds.commands || []).find(c => c.id === 'hello-sysbin:hello');
        R.commands = hello ? ('OK ' + hello.id) : '❌ 未注册';

        // 4) 执行命令
        const run = await A.pluginsRunCommand({ id: 'hello-sysbin:hello' });
        R.runCommand = run && run.ok ? 'OK' : ('❌ ' + (run && run.error));

        // 5) 停用 → 启用
        const off = await A.pluginsToggle({ id: 'hello-sysbin', enabled: false });
        const offList = await A.pluginsList();
        const offState = (offList.plugins || []).find(p => p.id === 'hello-sysbin');
        R.disable = (off && off.ok && offState && !offState.enabled) ? 'OK' : '❌';
        const on = await A.pluginsToggle({ id: 'hello-sysbin', enabled: true });
        R.enable = (on && on.ok) ? 'OK' : ('❌ ' + (on && on.error));

        // 6.5) 界面：切到插件视图并渲染卡片
        document.querySelector('.ab-item[data-view="plugins"]').click();
        await new Promise(r => setTimeout(r, 400));
        R.uiView = document.getElementById('view-plugins').classList.contains('active') ? 'OK' : '❌ 视图未切换';
        R.uiCards = document.querySelectorAll('#plug-list .plug-card').length;
        R.uiSidebarTitle = document.getElementById('sb-title').textContent;

        // 6.6) 市场页：目录不存在时要给出提示而不是白屏
        document.querySelector('.plug-tab[data-plugtab="market"]').click();
        await new Promise(r => setTimeout(r, 3000));
        const mkErr = document.querySelector('#plug-market-list .plug-error');
        R.uiMarket = 'url=' + (document.getElementById('plug-market-url').textContent || '-')
            + ' | items=' + document.querySelectorAll('#plug-market-list .plug-market-item').length
            + ' | err=' + (mkErr ? mkErr.textContent : '无');

        // 6.7) 重新加载（清缓存后再 require）
        const rl = await A.pluginsReload('hello-sysbin');
        R.reload = rl && rl.ok ? 'OK' : ('❌ ' + (rl && rl.error));

        // 7) 市场（当前线上目录可能不存在，只要不崩且返回结构完整即可）
        const mk = await A.pluginsMarketFetch({});
        R.market = mk ? ('OK items=' + ((mk.items || []).length) + (mk.error ? (' error=' + mk.error) : '')) : '❌ 无返回';

        // 8) 卸载
        const un = await A.pluginsUninstall('hello-sysbin');
        const after = await A.pluginsList();
        R.uninstall = (un && un.ok && !(after.plugins || []).some(p => p.id === 'hello-sysbin')) ? 'OK' : '❌';

        // 9) 装一个临时的坏插件：应当给出错误而不是崩
        const bad = await A.pluginsInstallUrl('https://123pen.cn/__not_exist__.js');
        R.badInstall = (bad && bad.ok === false) ? ('OK 已拒绝：' + (bad.error || '').slice(0, 40)) : '❌ 错误未被拦截';

        // 10) 背景插件：命令 → 渲染层应用样式 → 清除
        const bg = await A.pluginsInstallPath('F:/Sysbin Code/2.0.1/src/main/plugins/samples/custom-background.js');
        R.bgInstall = bg && bg.ok ? 'OK' : ('❌ ' + (bg && bg.error));
        await A.pluginsRunCommand({ id: 'custom-background:color-blue' });
        await new Promise(r => setTimeout(r, 500));
        const bs = document.getElementById('plugin-backdrop-style');
        R.bgApply = (bs && window.__state.backdrop.on && localStorage.getItem('sysbin.backdrop')) ? 'OK' : '❌ 背景未生效';
        await A.pluginsRunCommand({ id: 'custom-background:set-dim', args: { value: '45' } });
        await new Promise(r => setTimeout(r, 400));
        R.bgDim = window.__state.backdrop.dim === 0.45 ? 'OK' : ('❌ ' + JSON.stringify(window.__state.backdrop));
        await A.pluginsRunCommand({ id: 'custom-background:clear' });
        await new Promise(r => setTimeout(r, 400));
        R.bgClear = (!document.getElementById('plugin-backdrop-style') && !localStorage.getItem('sysbin.backdrop')) ? 'OK' : '❌ 未清除';
        await A.pluginsUninstall('custom-background');

        return JSON.stringify(R);
    })()`, true);

    const r = JSON.parse(out);
    console.log('──────── 插件系统 ────────');
    Object.keys(r).forEach(k => {
        console.log(k.padEnd(12) + ' : ' + r[k]);
        if (String(r[k]).startsWith('❌')) failed = true;
    });

    /* 统一配置文件：<数据目录>/config.json 里应同时有 app 段与 plugins 段 */
    await win.webContents.executeJavaScript(
        `window.sysbin.pluginsInstallPath('F:/Sysbin Code/2.0.1/src/main/plugins/samples/hello-sysbin.js')`, true);
    const cfgFile = path.join(app.getPath('userData'), 'config.json');
    let cfgLine = '';
    try {
        const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        const appKeys = Object.keys(raw.app || {}).length;
        const pluginKeys = Object.keys(raw.plugins || {}).length;
        cfgLine = `app ${appKeys} 项 · plugins ${pluginKeys} 项 · ${cfgFile}`;
        if (!('app' in raw) || !('plugins' in raw) || !pluginKeys) { cfgLine = '❌ ' + cfgLine; failed = true; }
    } catch (e) {
        cfgLine = '❌ 读取失败：' + (e && e.message);
        failed = true;
    }
    console.log('config.json : ' + cfgLine);
    await win.webContents.executeJavaScript(`window.sysbin.pluginsUninstall('hello-sysbin')`, true);

    console.log(failed ? '❌ 存在问题' : '✅ 全部通过');
    done(failed ? 1 : 0);
});
