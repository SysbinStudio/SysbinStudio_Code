/* ═══════════════════════════════════════════
   17. 启动
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */

/* ═══════════ 启动 ═══════════ */

// 渲染层错误收集 + 自检探针（供 selftest.js 使用）
window.__errors = [];
window.addEventListener('error', e => {
    window.__errors.push(String((e && e.message) || e));
});
window.addEventListener('unhandledrejection', e => {
    window.__errors.push('Promise: ' + String((e && e.reason) || e));
});
window.__state = state;
Object.defineProperty(window, '__editor', { get: () => editor });
window.__readyProbe = () => !!editor && !!state.settings && state.tabs.length > 0;

/* 十六进制视图探针（供 bin-ui-test.js 使用） */
window.__hex = {
    HEX,
    open: (p) => openPath(p),
    render: () => hexRender(),
    strings: () => hexExtractStrings(),
    pe: () => hexPeInfo(),
    search: (q, mode) => { el.hexSearch.value = q; el.hexSearchMode.value = mode || 'text'; return hexDoSearch(); },
    goto: (v) => { el.hexGoto.value = String(v); hexDoGoto(); },
    visible: () => el.hexview.classList.contains('show'),
    rowCount: () => el.hexRows.querySelectorAll('.hex-row').length,
    firstRow: () => { const r = el.hexRows.querySelector('.hex-row'); return r ? r.innerText.replace(/\s+/g, ' ').trim() : ''; },
    statLeft: () => el.hexStatLeft.textContent,
    /* 行是否真的落在可视区内（DOM 有节点 ≠ 用户看得到） */
    visibility: () => {
        const body = el.hexBody;
        const r = el.hexRows.querySelector('.hex-row');
        if (!r) return { rows: 0, inView: false, textLen: 0 };
        const rb = r.getBoundingClientRect();
        const bb = body.getBoundingClientRect();
        return {
            rows: el.hexRows.querySelectorAll('.hex-row').length,
            inView: rb.top >= bb.top - 4 && rb.top <= bb.bottom,
            rowTopInBox: Math.round(rb.top - bb.top),
            boxH: Math.round(bb.height),
            textLen: r.innerText.trim().length
        };
    },
    tabCount: () => state.tabs.length,
    scrollTo: (y) => { el.hexBody.scrollTop = y; }
};

startMonaco();
