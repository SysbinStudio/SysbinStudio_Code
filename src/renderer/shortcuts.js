/* ═══════════════════════════════════════════
   15. 键盘快捷键与界面绑定
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   15. 键盘快捷键
   ═══════════════════════════════════════════ */

function bindShortcuts() {
    document.addEventListener('keydown', e => {
        const mod = e.ctrlKey || e.metaKey;
        const inEditor = editor && editor.hasTextFocus && editor.hasTextFocus();

        // Ctrl+Shift+P 命令面板
        if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('command'); return; }
        // Ctrl+P 快速打开
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('file'); return; }
        // Ctrl+Shift+O 符号
        if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openPalette('symbol'); return; }
        // Ctrl+Shift+E/F
        if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); showView('explorer'); return; }
        if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); showView('search'); return; }
        // Ctrl+Shift+A 打开 AI 助手（在 AI 输入框内不拦截，避免影响输入）
        if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
            const tg = e.target;
            if (tg && tg.closest && tg.closest('#view-ai')) return;
            e.preventDefault(); showView('ai'); return;
        }
        // Ctrl+K 组合（Ctrl+K Ctrl+O 打开文件夹）
        if (mod && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            pendingChord = true;
            setTimeout(() => { pendingChord = false; }, 1500);
            return;
        }
        if (pendingChord && e.key.toLowerCase() === 'o') { e.preventDefault(); pendingChord = false; openFolder(); return; }

        if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newUntitled(); return; }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openFileDialog(); return; }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveActive(); return; }
        if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveActiveAs(); return; }
        if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(state.active); return; }
        if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); return; }
        if (mod && e.key === '`') { e.preventDefault(); togglePanel(); return; }
        if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
        if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); togglePanel(); return; }
        if (mod && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); openPalette('symbol'); return; }
        if (e.key === 'F5') { e.preventDefault(); runActive(); return; }
        if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); formatDocument(); return; }

        if (mod && e.key.toLowerCase() === 'tab') { e.preventDefault(); nextTab(e.shiftKey ? -1 : 1); return; }
        if (e.key === 'Escape') { hideMenus(); hideContext(); }
    });
}
let pendingChord = false;

function nextTab(dir) {
    if (state.tabs.length < 2) return;
    let i = state.active + dir;
    if (i < 0) i = state.tabs.length - 1;
    if (i >= state.tabs.length) i = 0;
    activateTab(i);
}

/* ═══════════════════════════════════════════
   16. 面板拖拽 / 初始化
   ═══════════════════════════════════════════ */

function bindResizers() {
    const bar = $('panel-resizer');
    const panel = el.panel;
    let dragging = false, startY = 0, startH = 0;
    bar.addEventListener('mousedown', e => {
        dragging = true; startY = e.clientY; startH = panel.getBoundingClientRect().height;
        document.body.style.cursor = 'ns-resize'; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const h = Math.max(100, Math.min(window.innerHeight * 0.72, startH + (startY - e.clientY)));
        panel.style.height = h + 'px';
        if (editor) editor.layout();
    });
    document.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.cursor = ''; if (editor) editor.layout(); } });
}

function bindPanels() {
    document.querySelectorAll('.ptab').forEach(b => {
        b.addEventListener('click', () => { switchPanelView(b.dataset.panel); });
    });
    $('panel-close').addEventListener('click', () => togglePanel(false));
    el.stTerminal.addEventListener('click', () => togglePanel());
    el.stProblems.addEventListener('click', () => { togglePanel(true); switchPanelView('problems'); });
    el.stLang.addEventListener('click', () => openPalette('command'));
}

function bindActivityBar() {
    document.querySelectorAll('.ab-item').forEach(b => {
        b.addEventListener('click', () => {
            const v = b.dataset.view;
            if (b.classList.contains('active') && !el.sidebar.classList.contains('hidden')) toggleSidebar();
            else showView(v);
        });
    });
}

function bindTitlebar() {
    $('tb-search').addEventListener('click', () => openPalette('file'));
    $('tb-settings').addEventListener('click', openSettings);
    document.addEventListener('mousedown', e => {
        if (!el.menuPop.contains(e.target)) hideMenus();
        if (!el.ctxMenu.contains(e.target)) hideContext();
    });
    window.addEventListener('blur', () => { hideMenus(); hideContext(); });
}

function bindWelcome() {
    $('w-open-file').addEventListener('click', openFileDialog);
    $('w-open-folder').addEventListener('click', openFolder);
    $('w-new-file').addEventListener('click', () => newUntitled());
    $('w-terminal').addEventListener('click', () => togglePanel());
}

function bindExplorer() {
    $('explorer-open').addEventListener('click', openFolder);
    $('explorer-collapse').addEventListener('click', collapseAll);
}

function bindTools() {
    $('tool-doc').addEventListener('click', formatDocument);
    $('tool-stats').addEventListener('click', doStats);
    $('tool-json-format').addEventListener('click', () => doJson('pretty'));
    $('tool-json-minify').addEventListener('click', () => doJson('minify'));
    $('tool-json-sort').addEventListener('click', () => doJson('sort'));
    $('tool-convert').addEventListener('click', () => doConvert($('convert-src').value, $('convert-dst').value));
}

function bindAbout() {
    $('about-userdata').addEventListener('click', async () => { const e = await API.envInfo(); API.openPath(e.userData); });
    $('about-appdir').addEventListener('click', async () => { const e = await API.envInfo(); API.openPath(e.appDir || e.appPath); });
}

function bindEditorEvents() {
    editor.onDidChangeCursorPosition(e => {
        el.stPos.textContent = `行 ${e.position.lineNumber}，列 ${e.position.column}`;
    });
    editor.onDidChangeModelContent(() => scheduleOutline());
    editor.onDidChangeModelLanguage(() => scheduleOutline());
    editor.onDidFocusEditorText(() => {});
    // 编辑器内 Ctrl+点击 / F12 等由 Monaco 处理；这里补充拖拽文件到编辑器
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());
}
