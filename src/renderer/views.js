/* ═══════════════════════════════════════════
   11. 视图切换与设置
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   10. 视图切换
   ═══════════════════════════════════════════ */

const VIEW_TITLES = { explorer: '资源管理器', search: '搜索', outline: '大纲', tools: '代码工具', plugins: '插件', ai: 'AI 助手', about: '关于' };

function showView(name) {
    if (name === 'ai') { toggleAiPanel(true); return; }
    const sb = el.sidebar;
    if (sb.classList.contains('hidden')) { sb.classList.remove('hidden'); }
    document.querySelectorAll('.ab-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    el.sidebar.querySelectorAll('.sb-body').forEach(b => b.classList.toggle('active', b.id === 'view-' + name));
    el.sbTitle.textContent = VIEW_TITLES[name] || '';
    el.sbActions.textContent = '';
    if (name === 'search') setTimeout(() => el.searchInput.focus(), 40);
    if (name === 'outline') renderOutline();
    if (name === 'about') renderAbout();
    if (name === 'plugins') refreshPlugins();
}

/* AI 助手停靠在右侧栏，入口在底部「下边栏」的 AI 按钮。
   与左侧边栏相互独立：打开 AI 不会抢占左侧资源管理器等视图。 */
function toggleAiPanel(force) {
    const rs = $('sidebar-right');
    if (!rs) return;
    const willOpen = (force !== undefined) ? !!force : rs.classList.contains('hidden');
    rs.classList.toggle('hidden', !willOpen);
    const btn = $('ai-launch');
    if (btn) btn.classList.toggle('active', willOpen);
    if (willOpen) {
        const v = $('view-ai');
        if (v) v.classList.add('active');
        renderAI();
    }
}

/* 底部「下边栏」AI 启动按钮 + 右侧栏关闭按钮 */
(function bindAiLauncher() {
    const launch = $('ai-launch');
    if (launch) launch.addEventListener('click', () => toggleAiPanel());
    const close = $('ai-close');
    if (close) close.addEventListener('click', () => toggleAiPanel(false));
})();

function toggleSidebar() {
    el.sidebar.classList.toggle('hidden');
}

function toggleTheme() {
    const t = state.settings.theme === 'dark' ? 'light' : 'dark';
    state.settings.theme = t;
    applyTheme();
    persistSettings();
    if (state.suppress) return;
    const sel = $('set-theme');
    if (sel) sel.value = t;
    toast('已切换到' + (t === 'dark' ? '深色' : '浅色') + '主题', 'info', 1400);
}

/* ═══════════════════════════════════════════
   11. 设置
   ═══════════════════════════════════════════ */

/* 编辑器底色：装了背景插件（state.backdrop.on）时按 dim 打一层透明度，
   让底层背景图透出来。dim = 面板不透明度，1 表示完全不透明。 */
function editorBgFor(baseHex) {
    const bd = state.backdrop;
    if (!bd || !bd.on || !(bd.dim < 1)) return baseHex;
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(baseHex);
    if (!m) return baseHex;
    const a = Math.round(Math.max(0, Math.min(1, bd.dim)) * 255).toString(16).padStart(2, '0');
    return '#' + m[1] + m[2] + m[3] + a;
}

function applyTheme() {
    const s = state.settings || DEFAULT_SETTINGS;   // 启动早期设置可能还没载入
    document.body.classList.toggle('theme-light', s.theme === 'light');
    document.documentElement.style.setProperty('--accent', s.accent || '#6c9ef8');
    const hsl = hexToRgb(s.accent || '#6c9ef8');
    if (hsl) document.documentElement.style.setProperty('--accent-dim', `rgba(${hsl.r},${hsl.g},${hsl.b},0.18)`);
    if (editor) {
        monaco.editor.defineTheme('sysbin-dark', {
            base: 'vs-dark', inherit: true, rules: [],
            colors: {
                'editor.background': editorBgFor('#0d0d13'),
                'editor.foreground': '#d7d7e2',
                'editor.lineHighlightBackground': editorBgFor('#16161f'),
                'editorCursor.foreground': s.accent || '#6c9ef8',
                'editor.selectionBackground': '#2a3550',
                'editorLineNumber.foreground': '#3d3d4d',
                'editorLineNumber.activeForeground': '#8a8a9c',
                'editorIndentGuide.background1': '#21212c',
                'editorGutter.background': editorBgFor('#0d0d13')
            }
        });
        monaco.editor.defineTheme('sysbin-light', {
            base: 'vs', inherit: true, rules: [],
            colors: {
                'editor.background': editorBgFor('#ffffff'),
                'editor.lineHighlightBackground': '#f4f4f8',
                'editorCursor.foreground': s.accent || '#4a7ad6',
                'editor.selectionBackground': '#d3e2ff'
            }
        });
        monaco.editor.setTheme(s.theme === 'light' ? 'sysbin-light' : 'sysbin-dark');
    }
}

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function applyEditorOptions() {
    if (!editor) return;
    const s = state.settings;
    editor.updateOptions({
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        tabSize: s.tabSize,
        lineNumbers: s.lineNumbers ? 'on' : 'off',
        wordWrap: s.wordWrap ? 'on' : 'off',
        minimap: { enabled: !!s.minimap, renderCharacters: false },
        bracketPairColorization: { enabled: !!s.bracketColor }
    });
    el.stIndent.textContent = '空格: ' + s.tabSize;
}

function applyAll() {
    applyTheme();
    applyEditorOptions();
}

let persistTimer = null;
function persistSettings(msg) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
        const res = await API.saveSettings(state.settings);
        const st = $('set-status');
        if (st) {
            st.textContent = res && res.ok ? (msg || '已保存') + ' · settings.json' : '保存失败：' + ((res && res.error) || '未知错误');
            st.style.color = res && res.ok ? 'var(--ok)' : 'var(--err)';
        }
    }, 180);
}

function syncSettingsUI() {
    const s = state.settings;
    state.suppress = true;
    $('set-theme').value = s.theme;
    $('set-accent').value = s.accent;
    $('set-fontsize').value = s.fontSize;
    $('set-fontfamily').value = s.fontFamily;
    $('set-tabsize').value = String(s.tabSize);
    $('set-linenumbers').checked = !!s.lineNumbers;
    $('set-wordwrap').checked = !!s.wordWrap;
    $('set-minimap').checked = !!s.minimap;
    $('set-autosave').checked = !!s.autoSave;
    $('set-bracketcolor').checked = !!s.bracketColor;
    $('set-shellcwd').value = s.shellCwd || '';
    $('set-py-path').value = s.pythonPath || '';
    const ai = s.ai || (s.ai = {});
    $('set-ai-baseurl').value = ai.baseURL || '';
    $('set-ai-apikey').value = ai.apiKey || '';
    $('set-ai-model').value = ai.model || '';
    $('set-ai-temp').value = (ai.temperature !== undefined) ? ai.temperature : 0.7;
    state.suppress = false;
}

function openSettings() { openSettingsTab(); }

function bindSettings() {
    const done = $('settings-done');
    if (done) done.addEventListener('click', () => {
        const i = state.tabs.findIndex(t => t.kind === 'settings');
        if (i >= 0) closeTab(i);
    });

    $('set-theme').addEventListener('change', e => { state.settings.theme = e.target.value; applyTheme(); persistSettings(); });
    $('set-accent').addEventListener('input', e => { state.settings.accent = e.target.value; applyTheme(); });
    $('set-accent').addEventListener('change', () => persistSettings());
    $('set-fontsize').addEventListener('change', e => {
        const v = parseInt(e.target.value, 10);
        state.settings.fontSize = Math.min(22, Math.max(12, isNaN(v) ? 13 : v));
        e.target.value = state.settings.fontSize;
        applyEditorOptions(); persistSettings();
    });
    $('set-fontfamily').addEventListener('change', e => { state.settings.fontFamily = e.target.value; applyEditorOptions(); persistSettings(); });
    $('set-tabsize').addEventListener('change', e => { state.settings.tabSize = parseInt(e.target.value, 10) || 4; applyEditorOptions(); persistSettings(); });
    $('set-linenumbers').addEventListener('change', e => { state.settings.lineNumbers = e.target.checked; applyEditorOptions(); persistSettings(); });
    $('set-wordwrap').addEventListener('change', e => { state.settings.wordWrap = e.target.checked; applyEditorOptions(); persistSettings(); });
    $('set-minimap').addEventListener('change', e => { state.settings.minimap = e.target.checked; applyEditorOptions(); persistSettings(); });
    $('set-autosave').addEventListener('change', e => { state.settings.autoSave = e.target.checked; persistSettings(); });
    $('set-bracketcolor').addEventListener('change', e => { state.settings.bracketColor = e.target.checked; applyEditorOptions(); persistSettings(); });

    /* AI 助手配置：写到 settings.ai，落盘到 settings.json（与 AI 视图共享同一份数据） */
    const aiSync = () => {
        const ai = state.settings.ai || (state.settings.ai = {});
        ai.baseURL = ($('set-ai-baseurl').value || '').trim();
        ai.apiKey = ($('set-ai-apikey').value || '').trim();
        ai.model = ($('set-ai-model').value || '').trim();
        const t = parseFloat($('set-ai-temp').value);
        ai.temperature = isNaN(t) ? 0.7 : Math.max(0, Math.min(2, t));
        persistSettings('已保存 AI 配置');
    };
    $('set-ai-baseurl').addEventListener('change', aiSync);
    $('set-ai-apikey').addEventListener('change', aiSync);
    $('set-ai-model').addEventListener('change', aiSync);
    $('set-ai-temp').addEventListener('change', aiSync);
    $('set-shellcwd').addEventListener('change', e => { state.settings.shellCwd = e.target.value.trim(); persistSettings('已保存，下次启动终端生效'); });

    $('set-shellcwd-pick').addEventListener('click', async () => {
        const d = await API.openFolderDialog();
        if (!d) return;
        $('set-shellcwd').value = d;
        state.settings.shellCwd = d;
        persistSettings('已保存，下次启动终端生效');
    });

    $('set-py-path').addEventListener('change', async e => {
        const v = e.target.value.trim();
        state.settings.pythonPath = v;
        const r = await API.setPythonPath(v);
        showPyCurrent(r.pythonPath);
        persistSettings();
    });

    $('set-py-detect').addEventListener('click', async () => {
        $('set-py-result') || null;
        state.settings.pythonPath = '';
        $('set-py-path').value = '';
        const r = await API.setPythonPath('');
        showPyCurrent(r.pythonPath);
        persistSettings('已恢复自动探测');
        const t = await API.testPython('');
        toast(t.ok ? `自动探测：Python ${t.version}` : '探测失败：' + t.error, t.ok ? 'ok' : 'err', 2600);
    });

    $('set-py-test').addEventListener('click', async () => {
        const t = await API.testPython($('set-py-path').value.trim());
        toast(t.ok ? `可用 · Python ${t.version} · PyYAML ${t.yaml ? '已安装' : '未安装'}` : '不可用：' + t.error, t.ok ? 'ok' : 'err', 3200);
    });

    $('set-open-file').addEventListener('click', () => { const p = $('set-file-path').title; if (p) API.openPath(p); });
    $('set-open-dir').addEventListener('click', () => { const p = $('set-file-path').title; if (p) API.openPath(dirOf(p)); });

    $('set-reset').addEventListener('click', async () => {
        await API.resetSettings();
        state.settings = Object.assign({}, DEFAULT_SETTINGS);
        syncSettingsUI(); applyAll();
        const e = await API.envInfo();
        showPyCurrent(e.pythonPath);
        $('set-status').textContent = '已恢复默认设置';
        $('set-status').style.color = 'var(--ok)';
        toast('已恢复默认设置', 'ok', 1800);
    });
}

function showPyCurrent(p) {
    const s = state.settings;
    const tag = s.pythonPath ? '手动指定' : (state.env && state.env.pythonBundled ? '内置 · 随包自带' : '系统');
    $('set-py-current').textContent = (p || '未探测到可用解释器') + '（' + tag + '）';
}

async function refreshSettingsInfo() {
    $('set-file-path').textContent = (state.env && state.env.settingsPath) || '（未知）';
    $('set-file-path').title = (state.env && state.env.settingsPath) || '';
    showPyCurrent(state.env && state.env.pythonPath);
}
