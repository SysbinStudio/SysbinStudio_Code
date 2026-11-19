/* ═══════════════════════════════════════════
   8. 集成终端
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   5. 终端
   ═══════════════════════════════════════════ */

function shortCwd(p) {
    if (!p) return 'PS>';
    const parts = p.split(/[\\/]/);
    return 'PS ' + (parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : p) + '>';
}

function ensureShell() {
    if (state.shell.started) return;
    state.shell.started = true;
    const cwd = (state.settings && state.settings.shellCwd) || state.root || null;
    API.shellStart({ cwd });
    termLine('终端会话已启动' + (cwd ? '（' + cwd + '）' : ''), 'info');
}

function shellSend(line) {
    ensureShell();
    termLine(el.termPrompt.textContent + ' ' + line, 'prompt');
    API.shellInput(line);
    state.shell.history.push(line);
    state.shell.histIdx = state.shell.history.length;
}

function bindTerminal() {
    API.onShellOutput(text => {
        String(text).split(/\r?\n/).forEach(l => termLine(l));
    });
    API.onShellStatus(st => {
        if (st && st.cwd) { state.shell.cwd = st.cwd; el.termPrompt.textContent = shortCwd(st.cwd); }
        if (st && st.stopped) termLine('[会话已结束，点「终端」按钮或重启可恢复]', 'info');
    });

    el.termInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const v = el.termInput.value;
            if (!v.trim()) return;
            shellSend(v);
            el.termInput.value = '';
        } else if (e.key === 'ArrowUp') {
            const h = state.shell.history;
            if (h.length) { state.shell.histIdx = Math.max(0, state.shell.histIdx - 1); el.termInput.value = h[state.shell.histIdx] || ''; }
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            const h = state.shell.history;
            if (h.length) {
                state.shell.histIdx = Math.min(h.length, state.shell.histIdx + 1);
                el.termInput.value = state.shell.histIdx >= h.length ? '' : h[state.shell.histIdx];
            }
            e.preventDefault();
        } else if (e.key === 'c' && e.ctrlKey) {
            e.preventDefault();
            API.shellStop();
            state.shell.started = false;
        } else if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault();
            el.terminal.textContent = '';
        }
    });
}

function togglePanel(force) {
    const show = force !== undefined ? force : el.panel.classList.contains('hidden');
    el.panel.classList.toggle('hidden', !show);
    $('st-terminal').classList.toggle('active', show);
    if (show) { ensureShell(); el.termInput.focus(); }
}

function switchPanelView(name) {
    document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.pview').forEach(v => v.classList.toggle('active', v.id === 'panel-' + name));
}

/* ═══════════════════════════════════════════
   6. 运行代码 / 问题面板
   ═══════════════════════════════════════════ */

async function runActive() {
    const t = activeTab();
    if (!t) return;
    togglePanel(true);
    switchPanelView('terminal');
    let file = t.path;
    if (file) {
        if (t.dirty) await saveActive(true);
    } else {
        const conf = LANG_BY_EXT[t.lang] || PLAIN;
        const base = (t.name || 'main').replace(/[^\w.-]/g, '_');
        const r = await API.tempSave({ content: t.model.getValue(), ext: conf.ext, name: base });
        if (!r.ok) { termLine('无法创建临时文件：' + r.error, 'err'); return; }
        file = r.path;
        termLine('未保存的文件已暂存到：' + file, 'info');
    }
    const conf = langOf(file);
    const cmd = conf.run.replace(/\{file\}/g, file).replace(/\{dir\}/g, dirOf(file));
    const d = dirOf(file);
    if (d) shellSend(`Set-Location -LiteralPath "${d}"`);
    shellSend(cmd);
    el.termInput.focus();
}

function setProblems(list) {
    state.problems = list || [];
    el.problemsList.textContent = '';
    const errs = state.problems.filter(p => p.severity === 'error').length;
    const warns = state.problems.length - errs;
    el.stProblems.textContent = `✕ ${errs}   ⚠ ${warns}`;
    el.badgeProblems.textContent = state.problems.length ? String(state.problems.length) : '';

    if (!state.problems.length) {
        el.problemsList.innerHTML = '<div class="empty-state small"><p>没有检测到问题</p></div>';
        return;
    }
    state.problems.forEach(p => {
        const row = document.createElement('div');
        row.className = 'problem-item ' + (p.severity === 'error' ? 'error' : 'warning');
        row.innerHTML = `<span class="p-icon">${p.severity === 'error' ? '✕' : '⚠'}</span>
                         <span class="p-msg">${escapeHtml(p.message)}</span>
                         <span class="p-loc">${escapeHtml(baseOf(p.path))}:${p.line}:${p.column}</span>`;
        row.addEventListener('click', () => gotoLocation(p.path, p.line, p.column));
        el.problemsList.appendChild(row);
    });
}

async function checkPythonSyntax() {
    const t = activeTab();
    if (!t || !t.path || extOf(t.path) !== 'py') return;
    const res = await API.invoke({ action: 'py_check', raw: t.model.getValue(), name: baseOf(t.path) });
    let p;
    try { p = JSON.parse(res); } catch (e) { return; }
    if (!p || !p.result) return;
    const list = [];
    if (!p.result.ok && p.result.diagnostics) {
        p.result.diagnostics.forEach(d => list.push({
            severity: 'error', path: t.path, line: d.line || 1, column: d.column || 1,
            message: d.message || '语法错误'
        }));
    }
    setProblems(list);
    if (list.length) switchPanelView('problems');
}

/* 用 Monaco 内置格式化 */
async function formatDocument() {
    const t = activeTab();
    if (!t || !editor) return;
    try {
        const action = editor.getAction('editor.action.formatDocument');
        await action.run();
        toast('已格式化文档', 'ok', 1500);
    } catch (e) {
        toast('该语言暂不支持自动格式化', 'warn', 2200);
    }
}

async function kernelAction(payload, onOk) {
    const t = activeTab();
    if (!t) { toast('请先打开一个文件', 'warn'); return; }
    const res = await API.invoke(payload);
    const r = ktextOf(res);
    if (r.error) { toast(r.text, 'err', 3600); logOut(r.text, 'err'); return; }
    if (onOk) onOk(r.text, t);
}
