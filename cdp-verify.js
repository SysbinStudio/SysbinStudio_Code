/*
 * 打包版功能验证：通过 Chrome DevTools 协议驱动已启动的正式包
 */
const TARGET = 'F:/Sysbin Code/1.0.2/dist/win-unpacked/Sysbin Studio Code.exe';
const http = require('http');

// 环境里存在代理，fetch 会被代理拦截而失败；这里直接用 http 模块走回环
function httpGet(url) {
    return new Promise((res, rej) => {
        http.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => res(d));
        }).on('error', rej);
    });
}

(async () => {
    const list = JSON.parse(await httpGet('http://127.0.0.1:9222/json'));
    const page = list.find(t => t.type === 'page');
    if (!page) { console.log('FAIL 未找到页面'); process.exit(1); }
    console.log('页面: ' + page.url.split('/').pop());

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const send = (method, params) => new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
        }
    };
    await new Promise(r => { ws.onopen = r; });

    const expr = `(async () => {
        const H = window.__hex;
        if (!H) return JSON.stringify({ fatal: '打包版缺少 __hex 探针' });
        const t0 = Date.now();
        await H.open(${JSON.stringify(TARGET)});
        const openMs = Date.now() - t0;
        await new Promise(r => setTimeout(r, 1500));
        const out = {
            openMs,
            visible: H.visible(),
            rows: H.rowCount(),
            first: H.firstRow().slice(0, 52),
            stat: H.statLeft(),
            size: H.HEX.size,
            sizeMB: (H.HEX.size / 1048576).toFixed(1),
            cachedChunks: H.HEX.chunks.size,
            topVis: H.visibility()
        };
        // 往下翻，验证内容仍在视口内
        H.scrollTo(4000000);
        await new Promise(r => setTimeout(r, 1200));
        out.midVis = H.visibility();
        out.midStat = H.statLeft();
        H.scrollTo(999999999);
        await new Promise(r => setTimeout(r, 1200));
        out.endVis = H.visibility();
        out.endStat2 = H.statLeft();
        H.goto('0x1000');
        await new Promise(r => setTimeout(r, 800));
        out.gotoStat = H.statLeft();
        await H.search('This program', 'text');
        await new Promise(r => setTimeout(r, 1500));
        out.hits = H.HEX.hits.length;
        await H.pe();
        await new Promise(r => setTimeout(r, 1000));
        out.tabsAfterPe = H.tabCount();
        out.errors = (window.__errors || []).slice(0, 3);
        return JSON.stringify(out);
    })()`;

    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const raw = r.result && r.result.value;
    let o;
    try { o = JSON.parse(raw); } catch (e) { console.log('原始返回: ' + raw); process.exit(1); }

    console.log('\n════════ 打包版 (app.asar) 功能验证 ════════');
    if (o.fatal) { console.log('❌ ' + o.fatal); process.exit(1); }

    console.log('  打开耗时        ' + o.openMs + ' ms');
    console.log('  文件大小        ' + o.sizeMB + ' MB (' + o.size + ' 字节)');
    console.log('  hex 视图显示    ' + (o.visible ? 'OK' : '❌'));
    console.log('  首屏行数        ' + o.rows + ' 行');
    console.log('  首行内容        ' + o.first);
    console.log('  状态栏          ' + o.stat);
    console.log('  已缓存块        ' + o.cachedChunks + ' 块（按需加载，非全量）');
    console.log('  首屏行在视口内  ' + (o.topVis && o.topVis.inView ? 'OK' : '❌') +
        (o.topVis ? ' (行顶+' + o.topVis.rowTopInBox + '/' + o.topVis.boxH + 'px)' : ''));
    console.log('  下翻行在视口内  ' + (o.midVis && o.midVis.inView ? 'OK' : '❌') +
        (o.midVis ? ' (行顶+' + o.midVis.rowTopInBox + '/' + o.midVis.boxH + 'px, ' + o.midStat + ')' : ''));
    console.log('  底部行在视口内  ' + (o.endVis && o.endVis.inView ? 'OK' : '❌') +
        (o.endVis ? ' (行顶+' + o.endVis.rowTopInBox + '/' + o.endVis.boxH + 'px, ' + o.endStat2 + ')' : ''));
    console.log('  跳转 0x1000     ' + o.gotoStat);
    console.log('  搜索命中        ' + o.hits + ' 处');
    console.log('  PE 后标签数     ' + o.tabsAfterPe);
    console.log('  渲染层错误      ' + (o.errors.length ? '❌ ' + o.errors.join(' | ') : '无'));

    const visOk = o.topVis && o.topVis.inView && o.midVis && o.midVis.inView && o.endVis && o.endVis.inView;
    console.log('──────────────────────────────');
    const pass = o.visible && o.rows > 0 && o.hits > 0 && o.tabsAfterPe > 1 && visOk && !o.errors.length;
    console.log(pass ? '✅ 打包版全部通过' : '❌ 存在问题');

    ws.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.log('异常: ' + e.message); process.exit(1); });