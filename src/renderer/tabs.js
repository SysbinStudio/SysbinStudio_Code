/* ═══════════════════════════════════════════
   2. 标签页：激活 / 打开 / 大文件精简模式
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   1. 标签页与编辑器
   ═══════════════════════════════════════════ */

function activeTab() { return state.tabs[state.active] || null; }

function updateWelcome() {
    el.welcome.classList.toggle('show', state.tabs.length === 0);
}

function renderTabs() {
    el.tabs.textContent = '';
    state.tabs.forEach((t, i) => {
        const node = document.createElement('div');
        node.className = 'tab' + (i === state.active ? ' active' : '') + (t.dirty ? ' dirty' : '');
        node.title = t.path || t.name;

        const isPlugin = t.kind === 'plugin';
        const isSettings = t.kind === 'settings';
        const ic = iconOf(t.path || (t.name + '.' + (t.lang || 'txt')));
        const icon = document.createElement('span');
        icon.className = 'tab-icon ' + (t.path ? ic.cls : (isPlugin ? 'ic-plugin' : isSettings ? 'ic-settings' : 'ic-default'));
        icon.textContent = t.path ? ic.ch : (isPlugin ? (t.icon || '◈') : isSettings ? '⚙' : '◇');

        const name = document.createElement('span');
        name.className = 'tab-name';
        name.textContent = t.path ? baseOf(t.path) : t.name;

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); closeTab(i); });

        node.appendChild(icon);
        node.appendChild(name);
        node.appendChild(close);
        node.addEventListener('click', () => activateTab(i));
        node.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(i); } });
        node.addEventListener('contextmenu', e => {
            e.preventDefault();
            showTabContextMenu(e.clientX, e.clientY, i);
        });
        el.tabs.appendChild(node);
    });
    updateWelcome();
    if (typeof syncPluginIconActive === 'function') syncPluginIconActive();
}

function renderBreadcrumb() {
    const t = activeTab();
    if (!t || !t.path || !state.root) {
        el.breadcrumb.classList.remove('show');
        return;
    }
    const rel = t.path.startsWith(state.root) ? t.path.slice(state.root.length).replace(/^[/\\]/, '') : t.path;
    const parts = rel.split(/[/\\]/);
    el.breadcrumb.textContent = '';
    el.breadcrumb.classList.add('show');
    parts.forEach((p, i) => {
        if (i) {
            const s = document.createElement('span');
            s.className = 'bc-sep';
            s.textContent = '›';
            el.breadcrumb.appendChild(s);
        }
        const n = document.createElement('span');
        n.className = i === parts.length - 1 ? 'bc-last' : '';
        n.textContent = p;
        el.breadcrumb.appendChild(n);
    });
}

/* ─────────── 大文件精简模式 ───────────
   Monaco 带完整语法分析，打开大文本时高亮 / 折叠 / 括号配对 / 智能提示
   都会退化成全量计算，几 MB 就足以让界面冻结。
   超过阈值的文件自动切到精简模式：保留编辑、查找、保存，
   关掉所有需要遍历全文的特性。 */
const LARGE_FILE_BYTES = 2 * 1024 * 1024;

const FULL_EDITOR_OPTS = {
    minimap: { enabled: true, renderCharacters: false },
    folding: true,
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    matchBrackets: 'always',
    suggestOnTriggerCharacters: true,
    quickSuggestions: true,
    wordBasedSuggestions: 'currentDocument',
    codeLens: true,
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    colorDecorators: true,
    links: true,
    renderWhitespace: 'selection',
    smoothScrolling: true
};

const LEAN_EDITOR_OPTS = {
    minimap: { enabled: false },
    folding: false,
    renderLineHighlight: 'none',
    bracketPairColorization: { enabled: false },
    matchBrackets: 'never',
    suggestOnTriggerCharacters: false,
    quickSuggestions: false,
    wordBasedSuggestions: 'off',
    codeLens: false,
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    colorDecorators: false,
    links: false,
    renderWhitespace: 'none',
    smoothScrolling: false,
    largeFileOptimizations: true
};

function applyEditorProfile(large, readOnly) {
    if (!editor) return;
    const wantLarge = !!large;
    if (!!state.largeMode !== wantLarge) {
        state.largeMode = wantLarge;
        editor.updateOptions(wantLarge ? LEAN_EDITOR_OPTS : FULL_EDITOR_OPTS);
    }
    editor.updateOptions({ readOnly: !!readOnly });
}

function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}

function modelUri(p) { return monaco.Uri.parse('inmemory://sysbin/' + encodeURIComponent(p)); }

function attachModelChange(tab, model) {
    model.onDidChangeContent(() => {
        if (!tab.dirty) { tab.dirty = true; renderTabs(); renderTree(); }
        scheduleAutoSave();
    });
}

function activateTab(i) {
    if (i < 0 || i >= state.tabs.length) return;
    const prev = activeTab();
    if (prev && prev.kind !== 'hex' && editor) prev.state = editor.saveViewState();
    state.active = i;
    /* 若 AI 右侧栏正打开，同步其「引用文件」下拉（异步避开各分支提前 return） */
    if (typeof aiRefreshTargets === 'function') {
        const rs = document.getElementById('sidebar-right');
        if (rs && !rs.classList.contains('hidden')) setTimeout(aiRefreshTargets, 0);
    }
    const t = state.tabs[i];

    /* 二进制：切到十六进制视图 */
    if (t.kind === 'hex') {
        showMainView('hex');
        hexOpen(t.path, t.size);
        updateStatusPaths();
        renderTabs();
        renderBreadcrumb();
        renderOutline();
        state.selectedPath = t.path;
        renderTree();
        el.stLang.textContent = '十六进制';
        el.stPos.textContent = fmtSize(t.size);
        return;
    }

    /* 插件页面：渲染到 #plugin-view，不走编辑器 */
    if (t.kind === 'plugin') {
        showMainView('plugin');
        const pv = $('plugin-view');
        if (pv) {
            pv.innerHTML = '';
            if (typeof t.html === 'string' && t.html) pv.innerHTML = t.html;
            else pv.innerHTML = '<div class="plugin-empty">该插件页面没有可显示的内容。</div>';
        }
        el.stLang.textContent = '插件页';
        el.stPos.textContent = t.name || '';
        updateStatusPaths();
        renderTabs();
        renderBreadcrumb();
        state.selectedPath = null;
        renderTree();
        return;
    }

    /* 设置页面：渲染到 #settings-view，不走编辑器 */
    if (t.kind === 'settings') {
        showMainView('settings');
        el.stLang.textContent = '设置';
        el.stPos.textContent = '';
        updateStatusPaths();
        renderTabs();
        renderBreadcrumb();
        state.selectedPath = null;
        renderTree();
        return;
    }

    /* 文本：切回 Monaco，按需套用精简模式与只读 */
    showMainView('text');
    applyEditorProfile(!!t.large, !!t.readonly);
    editor.setModel(t.model);
    if (t.state) editor.restoreViewState(t.state);
    t.dirty = t.dirty;   // 保持
    const langName = (t.path ? langOf(t.path) : (LANG_BY_EXT[t.lang] || PLAIN)).name;
    el.stLang.textContent = t.large ? langName + ' · 精简模式' : langName;
    updateStatusPaths();
    renderTabs();
    renderBreadcrumb();
    renderOutline();
    state.selectedPath = t.path;
    renderTree();
    const pos = editor.getPosition() || { lineNumber: 1, column: 1 };
    el.stPos.textContent = `行 ${pos.lineNumber}，列 ${pos.column}`;
    editor.focus();
}

function openTab(path, content, size) {
    const exist = state.tabs.findIndex(t => t.path === path && t.kind !== 'hex');
    if (exist >= 0) { activateTab(exist); return exist; }
    const conf = langOf(path);
    const byteLen = Number(size) || (content ? content.length : 0);
    const large = byteLen > LARGE_FILE_BYTES;
    let model = monaco.editor.getModel(modelUri(path));
    if (!model) model = monaco.editor.createModel(content || '', conf.monaco, modelUri(path));
    else if (content !== undefined && model.getValue() !== content) model.setValue(content);
    const tab = { path, name: null, lang: conf.ext, model, dirty: false, state: null, large, size: byteLen };
    attachModelChange(tab, model);
    state.tabs.push(tab);
    activateTab(state.tabs.length - 1);
    pushRecent(path);
    if (large) toast(`大文件 ${fmtSize(byteLen)}：已启用精简模式以保证流畅`, 'warn', 3800);
    return state.tabs.length - 1;
}

/* 打开一个「插件页面」标签页：插件通过 api.registerPage 注册的页面，
   在代码区以独立标签页呈现。同一页面的标签复用，不会重复打开。 */
function openPluginTab(pluginId, pageId, opts) {
    opts = opts || {};
    const key = pluginId + ':' + pageId;
    const exist = state.tabs.findIndex(t => t.kind === 'plugin' && t.pluginKey === key);
    if (exist >= 0) { activateTab(exist); return exist; }
    const tab = {
        kind: 'plugin',
        pluginKey: key,
        pluginId: pluginId,
        pageId: pageId,
        name: opts.title || pageId,
        icon: opts.icon || '◈',
        html: opts.html || '',
        dirty: false,
        state: null,
        size: 0
    };
    state.tabs.push(tab);
    activateTab(state.tabs.length - 1);
    return state.tabs.length - 1;
}

/* 打开「设置」标签页：在代码区以独立标签页呈现（与插件页同机制）。
   同一时刻只有一个设置标签，重复点击会复用。 */
function openSettingsTab() {
    const exist = state.tabs.findIndex(t => t.kind === 'settings');
    if (exist >= 0) { activateTab(exist); return exist; }
    const tab = { kind: 'settings', name: '设置', icon: '⚙', dirty: false, state: null, size: 0 };
    state.tabs.push(tab);
    activateTab(state.tabs.length - 1);
    if (typeof syncSettingsUI === 'function') syncSettingsUI();
    if (typeof refreshSettingsInfo === 'function') refreshSettingsInfo();
    return state.tabs.length - 1;
}
