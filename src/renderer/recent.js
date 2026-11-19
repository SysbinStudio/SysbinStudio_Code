/* ═══════════════════════════════════════════
   13. 最近打开
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   13. 最近打开
   ═══════════════════════════════════════════ */

function pushRecent(p) {
    if (!p) return;
    const list = state.settings.recent || [];
    const i = list.indexOf(p);
    if (i >= 0) list.splice(i, 1);
    list.unshift(p);
    state.settings.recent = list.slice(0, 8);
    persistSettings();
    renderRecent();
}

function renderRecent() {
    const box = $('welcome-recent');
    const list = (state.settings.recent || []).filter(p => p && baseOf(p));
    if (!list.length) { box.textContent = ''; return; }
    box.innerHTML = '<div class="wc-title">最近打开</div>';
    list.forEach(p => {
        const b = document.createElement('button');
        b.className = 'wc-item';
        b.textContent = p;
        b.title = p;
        b.addEventListener('click', () => openPath(p));
        box.appendChild(b);
    });
}
