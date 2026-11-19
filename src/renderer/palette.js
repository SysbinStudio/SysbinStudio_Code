/* ═══════════════════════════════════════════
   9. 命令面板 / 快速打开
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   7. 命令面板 / 快速打开
   ═══════════════════════════════════════════ */

let paletteMode = 'command';
let paletteItems = [];
let paletteSel = 0;

const COMMANDS = [
    { label: '文件：新建文件', key: `${modKey()}+N`, run: () => newUntitled() },
    { label: '文件：打开文件…', key: `${modKey()}+O`, run: () => openFileDialog() },
    { label: '文件：打开文件夹…', key: `${modKey()}+K ${modKey()}+O`, run: () => openFolder() },
    { label: '文件：保存', key: `${modKey()}+S`, run: () => saveActive() },
    { label: '文件：另存为…', key: `${modKey()}+Shift+S`, run: () => saveActiveAs() },
    { label: '文件：全部保存', run: () => saveAll() },
    { label: '文件：关闭标签页', key: `${modKey()}+W`, run: () => closeTab(state.active) },
    { label: '文件：关闭所有标签页', run: () => closeAll() },
    { sep: true },
    { label: '编辑：格式化文档', key: 'Shift+Alt+F', run: () => formatDocument() },
    { label: '编辑：注释/取消注释', key: `${modKey()}+/`, run: () => editor && editor.getAction('editor.action.commentLine').run() },
    { label: '编辑：查找', key: `${modKey()}+F`, run: () => editor && editor.getAction('actions.find').run() },
    { label: '编辑：替换', key: `${modKey()}+H`, run: () => editor && editor.getAction('editor.action.startFindReplaceAction').run() },
    { label: '编辑：转到行…', key: `${modKey()}+G`, run: () => editor && editor.getAction('editor.action.gotoLine').run() },
    { sep: true },
    { label: '视图：切换终端', key: `${modKey()}+\``, run: () => togglePanel() },
    { label: '视图：切换侧边栏', key: `${modKey()}+B`, run: () => toggleSidebar() },
    { label: '视图：资源管理器', key: `${modKey()}+Shift+E`, run: () => showView('explorer') },
    { label: '视图：搜索', key: `${modKey()}+Shift+F`, run: () => showView('search') },
    { label: '视图：大纲', key: `${modKey()}+Shift+O`, run: () => showView('outline') },
    { label: '视图：AI 助手', key: `${modKey()}+Shift+A`, run: () => showView('ai') },
    { label: 'AI：用 AI 改写当前文件', run: () => aiRewriteCurrent() },
    { label: '视图：问题面板', run: () => { togglePanel(true); switchPanelView('problems'); } },
    { label: '视图：输出面板', run: () => { togglePanel(true); switchPanelView('output'); } },
    { label: '视图：切换主题', run: () => toggleTheme() },
    { label: '视图：设置…', key: `${modKey()}+,`, run: () => openSettings() },
    { sep: true },
    { label: '运行：运行当前文件', key: 'F5', run: () => runActive() },
    { label: '运行：检查 Python 语法', run: () => checkPythonSyntax() },
    { sep: true },
    { label: '代码工具：格式化 JSON', run: () => doJson('pretty') },
    { label: '代码工具：压缩 JSON', run: () => doJson('minify') },
    { label: '代码工具：JSON 键名排序', run: () => doJson('sort') },
    { label: '代码工具：统计当前文件', run: () => doStats() },
    { label: '代码工具：JSON → YAML', run: () => doConvert('json', 'yaml') },
    { label: '代码工具：YAML → JSON', run: () => doConvert('yaml', 'json') },
    { label: '代码工具：XML → JSON', run: () => doConvert('xml', 'json') }
];

async function saveAll() {
    let n = 0;
    for (let i = 0; i < state.tabs.length; i++) {
        if (!state.tabs[i].dirty) continue;
        state.active = i;
        if (await saveActive(true)) n++;
    }
    if (n) toast(`已保存 ${n} 个文件`, 'ok', 1600);
    else toast('没有需要保存的文件', 'info', 1500);
}

function openPalette(mode) {
    paletteMode = mode;
    el.overlay.classList.add('show');
    el.palettePrefix.textContent = mode === 'file' ? '⏵' : mode === 'symbol' ? '@' : '>';
    el.paletteInput.value = '';
    el.paletteInput.placeholder = mode === 'file' ? '输入文件名以快速打开…' : mode === 'symbol' ? '输入 @ 搜索符号…' : '输入命令…';
    el.paletteHint.innerHTML = '<span>↑↓ 选择</span><span>Enter 确认</span><span>Esc 关闭</span>';
    refreshPalette('');
    el.paletteInput.focus();
}

function closePalette() {
    el.overlay.classList.remove('show');
    if (editor) editor.focus();
}

async function refreshPalette(q) {
    paletteItems = [];
    if (paletteMode === 'command') {
        paletteItems = COMMANDS.filter(c => !c.sep && (!q || c.label.toLowerCase().includes(q.toLowerCase())));
    } else if (paletteMode === 'file') {
        if (!state.root) { paletteItems = []; }
        else {
            const res = await API.searchFiles({ root: state.root, query: q, max: 80 });
            paletteItems = (res.results || []).map(r => ({ label: r.rel, detail: baseOf(r.path), path: r.path }));
        }
    } else if (paletteMode === 'symbol') {
        const t = activeTab();
        if (t) {
            const syms = lightOutline(t.model);
            const all = [];
            syms.forEach(s => all.push(s));
            paletteItems = all
                .filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()))
                .map(s => ({ label: s.name, detail: '行 ' + s.range.startLineNumber, line: s.range.startLineNumber }));
        }
    }
    paletteSel = 0;
    renderPalette(q);
}

function renderPalette(q) {
    el.paletteList.textContent = '';
    if (!paletteItems.length) {
        el.paletteList.innerHTML = '<div class="empty-state small"><p>无匹配项</p></div>';
        return;
    }
    paletteItems.slice(0, 200).forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'palette-item' + (i === paletteSel ? ' sel' : '');
        let label = escapeHtml(it.label);
        if (q && paletteMode !== 'symbol') {
            const idx = it.label.toLowerCase().indexOf(q.toLowerCase());
            if (idx >= 0) {
                label = escapeHtml(it.label.slice(0, idx)) + '<mark>' + escapeHtml(it.label.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(it.label.slice(idx + q.length));
            }
        }
        row.innerHTML = `<span class="pi-label">${label}</span>` +
            (it.detail ? `<span class="pi-detail">${escapeHtml(it.detail)}</span>` : '') +
            (it.key ? `<span class="pi-key">${escapeHtml(it.key)}</span>` : '');
        row.addEventListener('click', () => runPaletteItem(i));
        row.addEventListener('mousemove', () => { paletteSel = i; });
        el.paletteList.appendChild(row);
    });
    const sel = el.paletteList.querySelector('.palette-item.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

async function runPaletteItem(i) {
    const it = paletteItems[i];
    if (!it) return;
    if (paletteMode === 'command') { closePalette(); it.run(); return; }
    if (paletteMode === 'file') { closePalette(); await openPath(it.path); return; }
    if (paletteMode === 'symbol') {
        closePalette();
        editor.revealLineInCenter(it.line);
        editor.setPosition({ lineNumber: it.line, column: 1 });
        editor.focus();
    }
}

function bindPalette() {
    el.paletteInput.addEventListener('input', async () => {
        clearTimeout(paletteTimer);
        paletteTimer = setTimeout(() => refreshPalette(el.paletteInput.value), 130);
    });
    el.paletteInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); paletteSel = Math.min(paletteItems.length - 1, paletteSel + 1); renderPalette(el.paletteInput.value); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSel = Math.max(0, paletteSel - 1); renderPalette(el.paletteInput.value); }
        else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteSel); }
    });
    el.overlay.addEventListener('mousedown', e => { if (e.target === el.overlay) closePalette(); });
}
let paletteTimer = null;

async function openFileDialog() {
    const paths = await API.openFileDialog();
    if (!paths || !paths.length) return;

    // 单个文件：失败原因直接展示
    if (paths.length === 1) { await openPath(paths[0]); return; }

    // 多选：逐個打开，失败汇总成一条提示，避免刷屏
    const errs = [];
    for (const p of paths) {
        const r = await openPath(p, { quiet: true });
        if (r && !r.ok) errs.push(r);
    }
    if (errs.length === 1) {
        toast('无法打开：' + errs[0].error, 'err', 4200);
    } else if (errs.length > 1) {
        const big = errs.filter(e => e.tooLarge).length;
        toast(`${errs.length} / ${paths.length} 个文件未能打开` + (big ? `（${big} 个超过上限）` : ''), 'err', 4200);
    }
}
