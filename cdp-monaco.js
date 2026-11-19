/*
 * 打包版 Monaco 验证：确认编辑器内核在 app.asar 内真实可用
 */
const http = require('http');
const fs = require('fs');
const PORT = process.env.CDP_PORT || '9222';
const OUT = 'F:/Sysbin Code/1.0.2/monaco-shot.png';
const SAMPLE = 'F:/Sysbin Code/1.0.2/package.json';

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

    const evalJs = async (expression, awaitPromise) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true });
        return r.result && r.result.value;
    };

    // 1. Monaco 全局与版本
    const env = JSON.parse(await evalJs(`JSON.stringify({
        monacoGlobal: typeof window.monaco !== 'undefined',
        editorApi: !!(window.monaco && window.monaco.editor && window.monaco.editor.create),
        languages: (window.monaco && window.monaco.languages) ? window.monaco.languages.getLanguages().length : 0,
        version: (window.monaco && window.monaco.editor) ? (window.monaco.editor.EditorType || {}).version || 'n/a' : 'n/a',
        editorInstance: !!window.__editor
    })`));

    // 2. 打开一个真实文本文件，确认模型与语法高亮生效
    await evalJs(`window.__hex.open(${JSON.stringify(SAMPLE)})`, true);
    await new Promise(r => setTimeout(r, 1800));

    const opened = JSON.parse(await evalJs(`(() => {
        const ed = window.__editor;
        if (!ed) return JSON.stringify({ err: '无编辑器实例' });
        const m = ed.getModel();
        return JSON.stringify({
            hasModel: !!m,
            languageId: m ? m.getLanguageId() : null,
            lineCount: m ? m.getLineCount() : 0,
            firstLine: m ? m.getLineInContent(0).slice(0, 40) : null,
            visible: ed.getDomNode() ? ed.getDomNode().offsetHeight > 0 : false,
            tabCount: window.__state.tabs.length,
            tabKind: window.__state.tabs[window.__state.active].kind || 'text',
            welcomeHidden: !document.getElementById('welcome').classList.contains('show'),
            hostDisplay: getComputedStyle(document.getElementById('editor')).display,
            hexHidden: !document.getElementById('hexview').classList.contains('show')
        });
    })()`));

    const img = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(img.result.data, 'base64'));

    console.log('\n════════ 打包版 Monaco 验证 ════════');
    console.log('  monaco 全局      ' + (env.monacoGlobal ? 'OK' : '❌ 缺失'));
    console.log('  editor API       ' + (env.editorApi ? 'OK' : '❌ 缺失'));
    console.log('  已注册语言数     ' + env.languages);
    console.log('  编辑器实例       ' + (env.editorInstance ? 'OK' : '❌ 未创建'));
    console.log('  --- 打开 package.json ---');
    console.log('  模型已挂载       ' + (opened.hasModel ? 'OK' : '❌'));
    console.log('  识别语言         ' + opened.languageId);
    console.log('  行数             ' + opened.lineCount);
    console.log('  首行内容         ' + opened.firstLine);
    console.log('  编辑器可见       ' + (opened.visible ? 'OK' : '❌ 高度为 0'));
    console.log('  欢迎页已隐藏     ' + (opened.welcomeHidden ? 'OK' : '❌ 仍显示'));
    console.log('  hex 视图已隐藏   ' + (opened.hexHidden ? 'OK' : '❌ 仍显示'));
    console.log('  渲染层错误       ' + ((window_errs => 'n/a')(null)));
    console.log('  截图             ' + OUT);
    console.log('──────────────────────────────');

    const pass = env.monacoGlobal && env.editorApi && env.editorInstance &&
                 env.languages > 10 && opened.hasModel && opened.visible &&
                 opened.lineCount > 10 && opened.welcomeHidden;
    console.log(pass ? '✅ 打包版 Monaco 完全可用' : '❌ 存在问题');

    ws.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.log('异常: ' + e.message); process.exit(1); });