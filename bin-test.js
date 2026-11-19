/*
 * 二进制 / 大文件能力实测
 * 用真实的 168 MB EXE 验证：分块读取、PE 解析、字符串提取、字节搜索。
 */
process.env.SYSBIN_SELFTEST = '1';
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

require('./main.js');   // 注册全部 IPC handler（自检模式下不会创建主窗口）

const TARGET = 'F:/Sysbin Code/1.0.2/dist/win-unpacked/Sysbin Studio Code.exe';

function finish(code, lines) {
    console.log('\n' + lines.join('\n'));
    setTimeout(() => app.exit(code), 200);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    await win.loadURL('about:blank');

    const raw = await win.webContents.executeJavaScript(`
(async () => {
    const A = window.sysbin;
    const p = ${JSON.stringify(TARGET)};
    const out = {};
    const t0 = Date.now();

    // 1. file-read 应判定为二进制（而非"太大"）
    const fr = await A.readFile(p);
    out.fileRead = fr.ok ? 'FAIL 竟当作文本打开了' : (fr.isBinary ? 'OK 识别为二进制 ' + fr.sizeText : 'FAIL ' + fr.error);

    // 2. 分块读取：文件开头
    let t = Date.now();
    const h1 = await A.hexRead({ path: p, offset: 0, length: 256 });
    out.hexHead = h1.ok ? ('OK ' + h1.length + ' 字节, 耗时 ' + (Date.now()-t) + 'ms')
                        : ('FAIL ' + h1.error);

    // 3. 分块读取：100 MB 处（随机访问，验证不整读）
    t = Date.now();
    const h2 = await A.hexRead({ path: p, offset: 100 * 1024 * 1024, length: 256 });
    out.hexMid = h2.ok ? ('OK ' + h2.length + ' 字节, 耗时 ' + (Date.now()-t) + 'ms')
                       : ('FAIL ' + h2.error);

    // 4. 分块读取：文件末尾
    const h3 = await A.hexRead({ path: p, offset: h1.size - 128, length: 256 });
    out.hexTail = h3.ok ? ('OK ' + h3.length + ' 字节（末尾自动截断）') : ('FAIL ' + h3.error);

    // 5. 越界读取
    const h4 = await A.hexRead({ path: p, offset: h1.size + 9999, length: 256 });
    out.hexOOB = h4.ok && h4.length === 0 ? 'OK 返回空' : ('FAIL ' + JSON.stringify(h4));

    // 6. PE 解析
    t = Date.now();
    const pe = await A.peInfo(p);
    out.pe = pe.ok
        ? ('OK ' + pe.bits + ' · ' + pe.machine + ' · ' + pe.subsystem + ' · 节区' + pe.sections.length + ' · 导入' + pe.imports.length + ', 耗时 ' + (Date.now()-t) + 'ms')
        : ('FAIL ' + pe.error);
    if (pe.ok) {
        out.peDetail = '   入口 ' + pe.entry + ' 基址 ' + pe.imageBase + ' 编译 ' + pe.timeStamp
                     + ' | 节区: ' + pe.sections.map(s => s.name).join(',');
        out.peImports = '   导入库: ' + pe.imports.slice(0, 6).join(', ') + (pe.imports.length > 6 ? ' …' : '');
    }

    // 7. 字符串提取
    t = Date.now();
    const st = await A.binStrings({ path: p, minLen: 6, maxResults: 5000 });
    out.strings = st.ok
        ? ('OK 共 ' + st.total + ' 条（取 ' + st.shown + ' 条）, 耗时 ' + (Date.now()-t) + 'ms')
        : ('FAIL ' + st.error);
    if (st.ok && st.hits.length) {
        out.stringsSample = '   示例: ' + st.hits.slice(0, 3).map(h => h.text.slice(0, 42)).join(' | ');
    }

    // 8. 文本搜索
    t = Date.now();
    const se = await A.binSearch({ path: p, query: 'This program', mode: 'text', maxHits: 50 });
    out.searchText = se.ok ? ('OK ' + se.count + ' 处, 耗时 ' + (Date.now()-t) + 'ms') : ('FAIL ' + se.error);

    // 9. 十六进制搜索（MZ 头）
    const se2 = await A.binSearch({ path: p, query: '4D5A', mode: 'hex', maxHits: 20 });
    out.searchHex = se2.ok ? ('OK ' + se2.count + ' 处') : ('FAIL ' + se2.error);

    out.totalTime = ((Date.now() - t0) / 1000).toFixed(2) + 's';
    return JSON.stringify(out);
})()
`, true).catch(e => JSON.stringify({ fatal: String(e) }));

    let r;
    try { r = JSON.parse(raw); } catch (e) { r = { fatal: raw }; }

    const lines = [];
    lines.push('════════ 二进制能力实测（168 MB EXE）════════');
    if (r.fatal) { lines.push('致命错误: ' + r.fatal); finish(1, lines); return; }

    const order = ['fileRead', 'hexHead', 'hexMid', 'hexTail', 'hexOOB', 'pe', 'peDetail', 'peImports',
                   'strings', 'stringsSample', 'searchText', 'searchHex'];
    for (const k of order) if (r[k] !== undefined) lines.push('  ' + k.padEnd(14) + ' ' + r[k]);

    const bad = order.filter(k => r[k] && String(r[k]).startsWith('FAIL'));
    lines.push('──────────────────────────────');
    lines.push('总耗时 ' + r.totalTime);
    lines.push(bad.length ? ('❌ ' + bad.length + ' 项失败: ' + bad.join(', ')) : '✅ 全部通过');

    win.destroy();
    finish(bad.length ? 1 : 0, lines);
});
