/*
 * 打包版「文档」菜单验证
 */
const http = require('http');
const PORT = process.env.CDP_PORT || '9222';

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
    const list = JSON.parse(await httpGet('http://127.0.0.1:' + PORT + '/json'));
    const page = list.find(t => t.type === 'page');
    if (!page) { console.log('FAIL 未找到页面'); process.exit(1); }

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

    const r = await send('Runtime.evaluate', {
        expression: `(async () => {
            const A = window.sysbin;
            const out = { apiExists: typeof A.openExternal === 'function' };
            document.querySelector('[data-menu="help"]').click();
            await new Promise(r => setTimeout(r, 400));
            const pop = document.getElementById('menu-pop');
            const txt = pop ? pop.innerText : '';
            out.hasDoc = txt.indexOf('文档') >= 0;
            out.menuText = txt.replace(/\\n+/g, ' | ').trim();
            document.body.click();
            out.denyOther = await A.openExternal('https://evil.example.com/');
            return JSON.stringify(out);
        })()`, awaitPromise: true, returnByValue: true
    });

    const o = JSON.parse(r.result.value);
    console.log('\n════════ 打包版「文档」验证 ════════');
    console.log('  preload 接口    ' + (o.apiExists ? 'OK' : '❌'));
    console.log('  帮助菜单内容    ' + o.menuText);
    console.log('  含「文档」项    ' + (o.hasDoc ? 'OK' : '❌'));
    console.log('  白名单拦截      ' + (o.denyOther && o.denyOther.ok === false ? 'OK 已拒绝' : '❌ 未拒绝'));
    console.log('──────────────────────────────');
    const pass = o.apiExists && o.hasDoc && o.denyOther && o.denyOther.ok === false;
    console.log(pass ? '✅ 打包版通过' : '❌ 存在问题');
    ws.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.log('异常: ' + e.message); process.exit(1); });