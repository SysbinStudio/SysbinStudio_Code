/*
 * 十六进制视图界面实测
 * 真实加载界面，打开 168 MB EXE，验证视图渲染、滚动、跳转、搜索、分析结果。
 */
process.env.SYSBIN_SELFTEST = '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');

const TARGET = 'F:/Sysbin Code/1.0.2/dist/win-unpacked/Sysbin Studio Code.exe';

function finish(code, lines) {
    console.log('\n' + lines.join('\n'));
    setTimeout(() => app.exit(code), 300);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: true, width: 1280, height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });

    win.webContents.on('console-message', (e, level, msg) => {
        if (level >= 2 && process.env.BIN_DEBUG) console.log('  [renderer]', msg);
    });

    await win.loadFile(path.join(__dirname, 'src', 'index.html'));

    // 等待 Monaco 与初始化完成
    let ready = false;
    for (let i = 0; i < 60; i++) {
        ready = await win.webContents.executeJavaScript('!!(window.__hex && window.__editor)', true).catch(() => false);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }

    const lines = [];
    lines.push('════════ 十六进制视图 · 界面实测 ════════');

    if (!ready) {
        lines.push('❌ 界面初始化失败（Monaco 未就绪）');
        finish(1, lines); return;
    }
    lines.push('  界面初始化      OK');

    const R = await win.webContents.executeJavaScript(`
(async () => {
    const H = window.__hex;
    const out = {};
    const p = ${JSON.stringify(TARGET)};

    // 1. 打开二进制文件
    let t = Date.now();
    await H.open(p);
    await new Promise(r => setTimeout(r, 800));
    out.openMs = Date.now() - t;
    out.visible = H.visible();
    out.rows = H.rowCount();
    out.firstRow = H.firstRow().slice(0, 58);
    out.tabKind = window.__state.tabs[window.__state.active].kind;

    // 调试：视图与布局状态
    const hv = document.getElementById('hexview');
    const ed = document.getElementById('editor');
    const hb = document.getElementById('hex-body');
    out.dbgClass = hv ? hv.className : 'NULL';
    out.dbgDisplay = hv ? getComputedStyle(hv).display : '-';
    out.dbgEditorDisplay = ed ? getComputedStyle(ed).display : '-';
    out.dbgBodyH = hb ? hb.clientHeight : -1;
    out.dbgBodyScrollH = hb ? hb.scrollHeight : -1;
    out.dbgWinH = window.innerHeight;

    // 2. 拖到滚动条最底部：验证能真正触达文件末尾（不受浏览器 scrollHeight 上限限制）
    t = Date.now();
    H.scrollTo(999999999);
    await new Promise(r => setTimeout(r, 1000));
    out.endRows = H.rowCount();
    out.endStat = H.statLeft();
    out.endMs = Date.now() - t;
    out.endVis = H.visibility();

    // 3. 中段随机访问
    t = Date.now();
    H.scrollTo(3000000);
    await new Promise(r => setTimeout(r, 900));
    out.scrollRows = H.rowCount();
    out.scrollStat = H.statLeft();
    out.scrollMs = Date.now() - t;
    out.scrollVis = H.visibility();
    out.cachedChunks = H.HEX.chunks.size;
    out.memNote = (H.HEX.chunks.size * 64 / 1024).toFixed(1) + ' MB 已缓存';

    // 3. 偏移跳转
    H.goto('0x1000');
    await new Promise(r => setTimeout(r, 700));
    out.gotoStat = H.statLeft();

    // 4. 搜索
    await H.search('This program', 'text');
    await new Promise(r => setTimeout(r, 1200));
    out.hitCount = H.HEX.hits.length;

    // 5. 提取字符串 → 生成结果标签页
    await H.strings();
    await new Promise(r => setTimeout(r, 1500));
    out.afterStringsTabs = H.tabCount();

    // 6. PE 信息 → 生成结果标签页
    await H.pe();
    await new Promise(r => setTimeout(r, 800));
    out.afterPeTabs = H.tabCount();

    out.errors = (window.__errors || []).slice(0, 5);
    return JSON.stringify(out);
})()
`, true).catch(e => JSON.stringify({ fatal: String(e) }));

    let r;
    try { r = JSON.parse(R); } catch (e) { r = { fatal: R }; }

    if (r.fatal) { lines.push('❌ ' + r.fatal); finish(1, lines); return; }

    lines.push('  打开耗时        ' + r.openMs + ' ms');
    lines.push('  hex 视图显示    ' + (r.visible ? 'OK' : '❌ 未显示'));
    lines.push('  标签类型        ' + (r.tabKind === 'hex' ? 'OK (hex)' : '❌ ' + r.tabKind));
    lines.push('  首屏行数        ' + r.rows + ' 行');
    lines.push('  首行内容        ' + r.firstRow);
    lines.push('  拖到最底部      ' + r.endRows + ' 行, ' + r.endMs + ' ms');
    lines.push('  末尾偏移        ' + r.endStat);
    lines.push('  底部行在视口内  ' + (r.endVis && r.endVis.inView ? 'OK' : '❌ 否') +
        (r.endVis ? ' (行顶+' + r.endVis.rowTopInBox + '/' + r.endVis.boxH + 'px, 文本' + r.endVis.textLen + '字)' : ''));
    lines.push('  中段访问        ' + r.scrollRows + ' 行, ' + r.scrollMs + ' ms');
    lines.push('  中段偏移        ' + r.scrollStat);
    lines.push('  中段行在视口内  ' + (r.scrollVis && r.scrollVis.inView ? 'OK' : '❌ 否') +
        (r.scrollVis ? ' (行顶+' + r.scrollVis.rowTopInBox + '/' + r.scrollVis.boxH + 'px, 文本' + r.scrollVis.textLen + '字)' : ''));
    lines.push('  已缓存块        ' + r.cachedChunks + ' 块 ≈ ' + r.memNote + '（文件 168 MB）');
    lines.push('  跳转 0x1000     ' + r.gotoStat);
    lines.push('  搜索命中        ' + r.hitCount + ' 处');
    lines.push('  字符串后标签数  ' + r.afterStringsTabs);
    lines.push('  PE 信息后标签数 ' + r.afterPeTabs);

    if (r.errors && r.errors.length) {
        lines.push('  渲染层错误      ❌ ' + r.errors.join(' | '));
    } else {
        lines.push('  渲染层错误      无');
    }

    // 末尾偏移应接近文件总长 0xA89F600 (168.6 MB)
    const endOk = /0x\s*A[0-9A-F]{6}/i.test(r.endStat || '') || /16[0-9]/.test(r.endStat || '');
    lines.push('  可达文件末尾    ' + (endOk ? 'OK' : '❌ 滚动条无法触达末尾'));

    // 往下翻时行内容必须落在视口内且非空
    const visOk = r.endVis && r.endVis.inView && r.endVis.textLen > 0 &&
                  r.scrollVis && r.scrollVis.inView && r.scrollVis.textLen > 0;
    lines.push('  下翻内容可见    ' + (visOk ? 'OK' : '❌ 视口内无内容'));

    const pass = r.visible && r.rows > 0 && r.tabKind === 'hex' &&
                 r.endRows > 0 && r.scrollRows > 0 && endOk && visOk && r.hitCount > 0 &&
                 r.afterStringsTabs > 1 && r.afterPeTabs > r.afterStringsTabs &&
                 !(r.errors && r.errors.length);

    lines.push('──────────────────────────────');
    lines.push(pass ? '✅ 全部通过' : '❌ 存在问题');

    win.destroy();
    finish(pass ? 0 : 1, lines);
});
