/* ═══════════════════════════════════════════
   6. 全局搜索
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   3. 搜索
   ═══════════════════════════════════════════ */

const searchOpts = { caseSensitive: false, regex: false };
let searchTimer = null;

function bindSearch() {
    el.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 260);
    });
    el.searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); }
    });
    $('search-toggle-case').addEventListener('click', function () {
        searchOpts.caseSensitive = !searchOpts.caseSensitive;
        this.classList.toggle('active', searchOpts.caseSensitive);
        runSearch();
    });
    $('search-toggle-regex').addEventListener('click', function () {
        searchOpts.regex = !searchOpts.regex;
        this.classList.toggle('active', searchOpts.regex);
        runSearch();
    });
}

async function runSearch() {
    const q = el.searchInput.value;
    if (!state.root) { el.searchMeta.textContent = '请先打开一个文件夹'; el.searchResults.textContent = ''; return; }
    if (!q.trim()) { el.searchMeta.textContent = ''; el.searchResults.textContent = ''; return; }
    el.searchMeta.textContent = '搜索中…';
    const res = await API.searchText({ root: state.root, query: q, caseSensitive: searchOpts.caseSensitive, useRegex: searchOpts.regex });
    if (!res.ok) { el.searchMeta.textContent = res.error; return; }

    const groups = new Map();
    res.results.forEach(r => {
        if (!groups.has(r.path)) groups.set(r.path, []);
        groups.get(r.path).push(r);
    });

    el.searchMeta.textContent = `${res.results.length} 个结果，来自 ${groups.size} 个文件` + (res.truncated ? '（已截断）' : '');
    el.searchResults.textContent = '';

    for (const [path, hits] of groups) {
        const box = document.createElement('div');
        box.className = 'search-file';
        const head = document.createElement('div');
        head.className = 'search-file-head';
        head.innerHTML = `<span class="sf-name">${escapeHtml(baseOf(path))}</span><span class="sf-dir">${escapeHtml(dirOf(path).replace(state.root, '').replace(/^[/\\]/, ''))}</span><span class="sf-count">${hits.length}</span>`;
        head.addEventListener('click', () => openPath(path));
        box.appendChild(head);

        hits.forEach(h => {
            const row = document.createElement('div');
            row.className = 'search-hit';
            const before = h.text.slice(0, h.matchStart);
            const mid = h.text.slice(h.matchStart, h.matchStart + h.matchLen);
            const after = h.text.slice(h.matchStart + h.matchLen);
            row.innerHTML = `<span class="sh-line">${h.line}</span><span class="sh-text">${escapeHtml(before)}<mark>${escapeHtml(mid)}</mark>${escapeHtml(after)}</span>`;
            row.addEventListener('click', () => gotoLocation(path, h.line, h.column));
            box.appendChild(row);
        });
        el.searchResults.appendChild(box);
    }
    if (!res.results.length) {
        el.searchResults.innerHTML = '<div class="empty-state small"><p>没有找到匹配结果</p></div>';
    }
}

async function gotoLocation(path, line, column) {
    const idx = state.tabs.findIndex(t => t.path === path);
    if (idx >= 0) activateTab(idx);
    else await openPath(path);
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: column || 1 });
    editor.focus();
}
