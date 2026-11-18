/*
 * 打包版布局验证：通过 CDP 驱动正式包，确认欢迎页不再遮挡底部面板
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

    // 注入 9 条最近打开并显示欢迎页，复现截图现场
    await send('Runtime.evaluate', {
        expression: `(() => {
            document.getElementById('welcome').classList.add('show');
            const box = document.getElementById('welcome-recent');
            box.innerHTML = '<div class="wc-title">最近打开</div>';
            for (let i = 1; i <= 9; i++) {
                const b = document.createElement('button');
                b.className = 'wc-item';
                b.textContent = 'F:\\\\Sysbin IDE\\\\绿色版\\\\payload_' + i + '.bin';
                box.appendChild(b);
            }
        })()`, returnByValue: true
    });
    await new Promise(r => setTimeout(r, 900));

    const r = await send('Runtime.evaluate', {
        expression: `(() => {
            const w = document.getElementById('welcome');
            const p = document.getElementById('panel');
            const inner = document.querySelector('.welcome-inner');
            const host = document.getElementById('editor-host');
            const hb = host.getBoundingClientRect();
            const ib = inner.getBoundingClientRect();
            const pb = p.getBoundingClientRect();
            const cs = getComputedStyle(w);
            const probeX = Math.round(ib.left + ib.width / 2);
            let covered = false, hitTag = 'null';
            for (const dy of [8, 24, 40]) {
                const h = document.elementFromPoint(probeX, pb.top + dy);
                if (h && (h.id === 'welcome' || (h.closest && h.closest('#welcome')))) {
                    covered = true; hitTag = h.id || h.className || h.tagName; break;
                }
                if (dy === 8) hitTag = h ? (h.id || h.className || h.tagName) : 'null';
            }
            return JSON.stringify({
                welcomeOverflow: cs.overflowY,
                panelZ: getComputedStyle(p).zIndex,
                innerBottom: Math.round(ib.bottom),
                hostBottom: Math.round(hb.bottom),
                willOverflow: (cs.overflowY === 'visible') && (ib.bottom > hb.bottom + 1),
                panelCovered: covered, hitTag,
                recentScrolls: (() => { const x = document.querySelector('.welcome-recent'); return x ? x.scrollHeight > x.clientHeight : false; })()
            });
        })()`, returnByValue: true
    });

    const o = JSON.parse(r.result.value);
    console.log('\n════════ 打包版布局验证 ════════');
    console.log('  welcome overflow ' + o.welcomeOverflow + (o.recentScrolls ? ' · 列表区可滚动' : ''));
    console.log('  panel z-index    ' + o.panelZ);
    console.log('  内容超出编辑区   ' + (o.willOverflow ? '❌ 是' : '否'));
    console.log('  面板被遮挡       ' + (o.panelCovered ? '❌ 是（命中 ' + o.hitTag + '）' : 'OK 否（命中 ' + o.hitTag + '）'));
    const pass = !o.willOverflow && !o.panelCovered && o.welcomeOverflow === 'auto';
    console.log('──────────────────────────────');
    console.log(pass ? '✅ 打包版布局正常' : '❌ 存在问题');

    ws.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.log('异常: ' + e.message); process.exit(1); });