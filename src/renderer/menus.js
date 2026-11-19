/* ═══════════════════════════════════════════
   10. 菜单、上下文菜单、弹窗
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   8. 菜单 / 上下文菜单
   ═══════════════════════════════════════════ */

/* ─── 外部传入的路径 ───
   来自启动参数、二次启动（资源管理器双击已关联文件）、open-file 事件。
   目录按「打开文件夹」处理，文件按 openPath 打开。 */

async function statOf(p) {
    try { const r = await API.fileStat(p); return r && r.ok ? r : null; }
    catch (e) { return null; }
}

/* openFolder() 走的是系统选择框，这里是直接用给定目录打开，两条路复用同一套收尾逻辑。 */
async function openFolderAt(dir) {
    state.root = dir;
    state.expanded = new Set([dir]);
    el.folderName.textContent = baseOf(dir);
    el.folderName.title = dir;
    el.tbSearchLabel.textContent = baseOf(dir);
    el.tbSearchLabel.title = dir;
    el.stFolder.textContent = baseOf(dir);
    await renderTree();
    pushRecent(dir);
    logOut('已打开文件夹：' + dir, 'info');
    if (state.shell.started) API.shellRestart({ cwd: dir });
}

/* 启动时 boot() 会先建一个未命名欢迎页占位；
   紧接着就来了真实文件，那个占位就没意义了，直接清掉。 */
async function dropWelcomeTab() {
    if (state.tabs.length !== 1) return;
    const t = state.tabs[0];
    if (t && t.untitled && !t.dirty && !t.path) await closeTab(0);
}

async function openTargets(list) {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;

    await dropWelcomeTab();

    const errs = [];
    let dirOpened = false;
    for (const p of items) {
        const st = await statOf(p);
        if (!st) { errs.push({ error: '路径不存在：' + p }); continue; }
        if (st.isDir) {
            if (dirOpened) { errs.push({ error: '已打开文件夹，跳过：' + baseOf(p) }); continue; }
            await openFolderAt(p);
            dirOpened = true;
        } else {
            const r = await openPath(p, { quiet: items.length > 1 });
            if (r && !r.ok) errs.push(r);
        }
    }

    if (errs.length) {
        const first = errs[0].error || '未知错误';
        toast(errs.length === 1 ? first : `有 ${errs.length} 个路径未能打开：${first}`, 'err', 4200);
    }
    const okN = items.length - errs.length;
    if (okN > 0) { logOut('已从外部打开 ' + okN + ' 个路径', 'info'); toast('已打开 ' + okN + ' 个路径', 'ok', 1800); }
}

/* 在线文档：用系统默认浏览器打开（地址由主进程白名单校验） */
const DOC_URL = 'https://www.123pen.cn/ssc/docs/';

async function openDocs() {
    const r = await API.openExternal(DOC_URL);
    if (!r || !r.ok) {
        toast('无法打开文档：' + (r && r.error ? r.error : '未知错误'), 'err');
        return;
    }
    logOut('已在默认浏览器打开文档：' + DOC_URL, 'info');
}

const MENUS = {
    file: [
        { label: '新建文件', key: `${modKey()}+N`, act: () => newUntitled() },
        { label: '打开文件…', key: `${modKey()}+O`, act: () => openFileDialog() },
        { label: '打开文件夹…', key: `${modKey()}+K ${modKey()}+O`, act: () => openFolder() },
        { sep: true },
        { label: '保存', key: `${modKey()}+S`, act: () => saveActive() },
        { label: '另存为…', key: `${modKey()}+Shift+S`, act: () => saveActiveAs() },
        { label: '全部保存', act: () => saveAll() },
        { sep: true },
        { label: '关闭标签页', key: `${modKey()}+W`, act: () => closeTab(state.active) },
        { label: '关闭全部标签页', act: () => closeAll() },
        { sep: true },
        { label: '设置…', key: `${modKey()}+,`, act: () => openSettings() }
    ],
    edit: [
        { label: '撤销', key: `${modKey()}+Z`, act: () => editor && editor.trigger('menu', 'undo', null) },
        { label: '重做', key: `${modKey()}+Y`, act: () => editor && editor.trigger('menu', 'redo', null) },
        { sep: true },
        { label: '查找', key: `${modKey()}+F`, act: () => editor && editor.getAction('actions.find').run() },
        { label: '替换', key: `${modKey()}+H`, act: () => editor && editor.getAction('editor.action.startFindReplaceAction').run() },
        { label: '转到行…', key: `${modKey()}+G`, act: () => editor && editor.getAction('editor.action.gotoLine').run() },
        { sep: true },
        { label: '格式化文档', key: 'Shift+Alt+F', act: () => formatDocument() },
        { label: '注释行', key: `${modKey()}+/`, act: () => editor && editor.getAction('editor.action.commentLine').run() }
    ],
    view: [
        { label: '命令面板…', key: `${modKey()}+Shift+P`, act: () => openPalette('command') },
        { label: '快速打开文件…', key: `${modKey()}+P`, act: () => openPalette('file') },
        { label: '转到符号…', key: `${modKey()}+Shift+O`, act: () => openPalette('symbol') },
        { sep: true },
        { label: '资源管理器', key: `${modKey()}+Shift+E`, act: () => showView('explorer') },
        { label: '搜索', key: `${modKey()}+Shift+F`, act: () => showView('search') },
        { label: '大纲', act: () => showView('outline') },
        { label: '代码工具', act: () => showView('tools') },
        { label: 'AI 助手', key: `${modKey()}+Shift+A`, act: () => showView('ai') },
        { sep: true },
        { label: '切换侧边栏', key: `${modKey()}+B`, act: () => toggleSidebar() },
        { label: '切换终端', key: `${modKey()}+\``, act: () => togglePanel() },
        { label: '切换主题', act: () => toggleTheme() }
    ],
    run: [
        { label: '运行当前文件', key: 'F5', act: () => runActive() },
        { label: '检查 Python 语法', act: () => checkPythonSyntax() },
        { label: '重新加载窗口', act: () => location.reload() }
    ],
    help: [
        { label: '文档', act: () => openDocs() },
        { sep: true },
        { label: '关于 Sysbin Studio Code', act: () => showView('about') },
        { label: '打开数据目录', act: async () => { const e = await API.envInfo(); API.openPath(e.userData); } },
        { label: '键盘快捷键', act: () => showShortcuts() }
    ]
};

function bindMenus() {
    document.querySelectorAll('.tb-menu-item').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const items = MENUS[btn.dataset.menu] || [];
            document.querySelectorAll('.tb-menu-item').forEach(b => b.classList.remove('open'));
            btn.classList.add('open');
            const r = btn.getBoundingClientRect();
            showMenuPop(r.left, r.bottom + 3, items, () => {
                document.querySelectorAll('.tb-menu-item').forEach(b => b.classList.remove('open'));
            });
        });
    });
}

function showMenuPop(x, y, items, onClose) {
    el.menuPop.textContent = '';
    items.forEach(it => {
        if (it.sep) { const s = document.createElement('div'); s.className = 'menu-sep'; el.menuPop.appendChild(s); return; }
        const row = document.createElement('div');
        row.className = 'menu-item' + (it.disabled ? ' disabled' : '');
        row.innerHTML = `<span class="mi-label">${escapeHtml(it.label)}</span>` + (it.key ? `<span class="mi-key">${escapeHtml(it.key)}</span>` : '');
        row.addEventListener('click', () => { hideMenus(); if (onClose) onClose(); it.act(); });
        el.menuPop.appendChild(row);
    });
    el.menuPop.style.left = Math.min(x, window.innerWidth - 230) + 'px';
    el.menuPop.style.top = y + 'px';
    el.menuPop.classList.add('show');
}

function hideMenus() {
    el.menuPop.classList.remove('show');
    document.querySelectorAll('.tb-menu-item').forEach(b => b.classList.remove('open'));
}

function showContextMenu(x, y, items) {
    el.ctxMenu.textContent = '';
    items.forEach(it => {
        if (it.sep) { const s = document.createElement('div'); s.className = 'menu-sep'; el.ctxMenu.appendChild(s); return; }
        const row = document.createElement('div');
        row.className = 'menu-item' + (it.disabled ? ' disabled' : '');
        row.innerHTML = `<span class="mi-label">${escapeHtml(it.label)}</span>`;
        row.addEventListener('click', () => { hideContext(); it.act(); });
        el.ctxMenu.appendChild(row);
    });
    el.ctxMenu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
    el.ctxMenu.style.top = Math.min(y, window.innerHeight - items.length * 30 - 12) + 'px';
    el.ctxMenu.classList.add('show');
}

function hideContext() { el.ctxMenu.classList.remove('show'); }

function showShortcuts() {
    const rows = [
        [`${modKey()}+Shift+P`, '命令面板'], [`${modKey()}+P`, '快速打开文件'],
        [`${modKey()}+N`, '新建文件'], [`${modKey()}+O`, '打开文件'],
        [`${modKey()}+K ${modKey()}+O`, '打开文件夹'], [`${modKey()}+S`, '保存'],
        [`${modKey()}+Shift+S`, '另存为'], [`${modKey()}+W`, '关闭标签页'],
        [`${modKey()}+B`, '切换侧边栏'], [`${modKey()}+\``, '切换终端'],
        [`${modKey()}+F`, '查找'], [`${modKey()}+H`, '替换'],
        [`${modKey()}+G`, '转到行'], [`${modKey()}+/`, '注释行'],
        ['Shift+Alt+F', '格式化文档'], ['F5', '运行当前文件'],
        [`${modKey()}+Shift+E`, '资源管理器'], [`${modKey()}+Shift+F`, '搜索'],
        [`${modKey()}+Shift+O`, '转到符号'], [`${modKey()}+,`, '设置']
    ];
    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `<div class="modal small"><div class="modal-head"><span>键盘快捷键</span></div>
      <div class="modal-body" style="max-height:60vh">
        ${rows.map(([k, v]) => `<div class="set-row" style="padding:7px 0"><div class="set-info"><div class="set-name">${escapeHtml(v)}</div></div><div class="set-ctrl"><span class="pi-key" style="font-family:var(--mono);font-size:11px;color:var(--fg-2);background:var(--bg-3);padding:2px 8px;border-radius:4px">${escapeHtml(k)}</span></div></div>`).join('')}
      </div>
      <div class="modal-foot right"><button class="btn btn-primary btn-sm">知道了</button></div></div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', e => { if (e.target === mask || e.target.className.includes('btn')) mask.remove(); });
}

/* ═══════════════════════════════════════════
   9. 输入弹窗 / 确认框
   ═══════════════════════════════════════════ */

function promptInput({ title, label, desc, value, placeholder }) {
    return new Promise(resolve => {
        $('input-title').textContent = title || '输入';
        $('input-label').textContent = label || '名称';
        $('input-desc').textContent = desc || '';
        el.inputValue.value = value || '';
        el.inputValue.placeholder = placeholder || '';
        el.inputMask.classList.add('show');
        setTimeout(() => { el.inputValue.focus(); el.inputValue.select(); }, 30);

        const done = v => {
            el.inputMask.classList.remove('show');
            el.inputValue.removeEventListener('keydown', onKey);
            $('input-ok').removeEventListener('click', onOk);
            $('input-cancel').removeEventListener('click', onCancel);
            $('input-close').removeEventListener('click', onCancel);
            resolve(v);
        };
        const onKey = e => { if (e.key === 'Enter') done(el.inputValue.value.trim()); if (e.key === 'Escape') done(null); };
        const onOk = () => done(el.inputValue.value.trim());
        const onCancel = () => done(null);
        el.inputValue.addEventListener('keydown', onKey);
        $('input-ok').addEventListener('click', onOk);
        $('input-cancel').addEventListener('click', onCancel);
        $('input-close').addEventListener('click', onCancel);
    });
}

function confirmBox(title, message) {
    return new Promise(resolve => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask show';
        mask.innerHTML = `<div class="modal small"><div class="modal-head"><span>${escapeHtml(title)}</span></div>
          <div class="modal-body" style="padding:18px 16px 22px;font-size:13px;line-height:1.7;color:var(--fg-1);white-space:pre-wrap;word-break:break-all">${escapeHtml(message)}</div>
          <div class="modal-foot right"><button class="btn btn-outline btn-sm" data-r="0">取消</button><button class="btn btn-primary btn-sm" data-r="1">确定</button></div></div>`;
        document.body.appendChild(mask);
        mask.addEventListener('click', e => {
            const r = e.target.dataset && e.target.dataset.r;
            if (r !== undefined) { mask.remove(); resolve(r === '1'); }
        });
    });
}

function copyText(t) {
    if (!t) return;
    navigator.clipboard.writeText(t).then(() => toast('已复制到剪贴板', 'ok', 1400)).catch(() => toast('复制失败', 'err'));
}
