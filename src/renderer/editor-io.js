/* ═══════════════════════════════════════════
   4. 文件 IO：新建、保存、运行、打开路径
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
function newUntitled(syntax) {
    untitledSeq++;
    const conf = syntax ? (LANGS.find(l => l.ext === syntax) || PLAIN) : PLAIN;
    const name = '未命名-' + untitledSeq;
    const uri = monaco.Uri.parse('inmemory://sysbin/untitled-' + untitledSeq);
    const model = monaco.editor.createModel('', conf.monaco, uri);
    const tab = { path: null, name, lang: conf.ext, model, dirty: false, state: null, untitled: true };
    attachModelChange(tab, model);
    state.tabs.push(tab);
    activateTab(state.tabs.length - 1);
    return tab;
}

async function closeTab(i) {
    const t = state.tabs[i];
    if (!t) return;
    if (t.dirty) {
        const choice = await askSave(t.path ? baseOf(t.path) : t.name);
        if (choice === 'cancel') return;
        if (choice === 'save') {
            state.active = i;
            const ok = await saveActive();
            if (!ok) return;
        }
    }
    const wasActive = state.active === i;
    state.tabs.splice(i, 1);
    const m = t.model;
    if (wasActive) {
        if (state.tabs.length) activateTab(Math.min(i, state.tabs.length - 1));
        else { state.active = -1; showMainView('text'); updateWelcome(); renderTabs(); renderBreadcrumb(); renderOutline(); }
    } else if (state.active > i) {
        state.active--;
        renderTabs();
    }
    try { m.dispose(); } catch (e) {}
}

function askSave(name) {
    return new Promise(resolve => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask show';
        mask.innerHTML = `
            <div class="modal small">
              <div class="modal-head"><span>是否保存更改？</span></div>
              <div class="modal-body" style="padding:18px 16px 22px;font-size:13px;line-height:1.7;color:var(--fg-1)">
                文件 <b style="color:var(--fg-0)">${escapeHtml(name)}</b> 有未保存的修改。<br>如果不保存，更改将会丢失。
              </div>
              <div class="modal-foot right" style="border-top:1px solid var(--border-soft)">
                <button class="btn btn-outline btn-sm" data-r="cancel">取消</button>
                <button class="btn btn-outline btn-sm" data-r="nosave">不保存</button>
                <button class="btn btn-primary btn-sm" data-r="save">保存</button>
              </div>
            </div>`;
        document.body.appendChild(mask);
        mask.addEventListener('click', e => {
            const r = e.target.dataset && e.target.dataset.r;
            if (r) { mask.remove(); resolve(r); }
        });
    });
}

/* ─────────── 保存 ─────────── */

let autoSaveTimer = null;
function scheduleAutoSave() {
    if (!state.settings || !state.settings.autoSave) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { saveActive(true); }, 1000);
}

async function saveActive(silent) {
    const t = activeTab();
    if (!t) return false;
    if (!t.path) return state.settings.autoSave ? false : saveActiveAs();
    const res = await API.writeFile({ path: t.path, content: t.model.getValue() });
    if (!res.ok) { toast('保存失败：' + res.error, 'err'); logOut('保存失败：' + res.error, 'err'); return false; }
    t.dirty = false;
    renderTabs(); renderTree();
    pluginsEmit('file:save', { path: t.path });   // 通知订阅了该事件的插件
    if (!silent) { toast('已保存 ' + baseOf(t.path), 'ok', 1400); logOut('已保存：' + t.path, 'ok'); }
    return true;
}

async function saveActiveAs() {
    const t = activeTab();
    if (!t) return false;
    const res = await API.saveFileDialog({ path: t.path || t.name + '.txt', content: t.model.getValue() });
    if (!res) return false;
    if (res.error) { toast('保存失败：' + res.error, 'err'); return false; }
    const p = res.path;
    const conf = langOf(p);
    const uri = modelUri(p);
    let model = monaco.editor.getModel(uri);
    const old = t.model;
    if (model && model !== old) { model.setValue(old.getValue()); }
    else { model = monaco.editor.createModel(old.getValue(), conf.monaco, uri); }

    const dup = state.tabs.findIndex(x => x.path === p && x !== t);
    if (dup >= 0) state.tabs.splice(dup, 1);

    t.path = p; t.name = null; t.model = model; t.dirty = false; t.untitled = false;
    attachModelChange(t, model);
    const viewState = editor.saveViewState();
    editor.setModel(model);
    try { editor.restoreViewState(viewState); } catch (e) {}
    if (old !== model) { try { old.dispose(); } catch (e) {} }

    const w = await API.writeFile({ path: p, content: model.getValue() });
    if (!w.ok) { toast('保存失败：' + w.error, 'err'); return false; }
    el.stLang.textContent = conf.name;
    updateStatusPaths(); renderTabs(); renderBreadcrumb(); pushRecent(p);
    toast('已保存到 ' + p, 'ok', 2200);
    logOut('已保存到：' + p, 'ok');
    if (state.root && p.startsWith(state.root)) renderTree();
    return true;
}

/* ═══════════════════════════════════════════
   2. 资源管理器
   ═══════════════════════════════════════════ */

async function openFolder() {
    const dir = await API.openFolderDialog();
    if (!dir) return;
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
    toast('已打开 ' + dir, 'ok', 1800);
}

async function renderTree() {
    if (!state.root) {
        el.tree.innerHTML = `<div class="empty-state"><p>尚未打开文件夹</p><button class="btn btn-primary btn-sm" id="explorer-open-2">打开文件夹</button></div>`;
        const b = $('explorer-open-2');
        if (b) b.addEventListener('click', openFolder);
        return;
    }
    const box = document.createElement('div');
    await renderTreeInto(box, state.root, 0);
    el.tree.textContent = '';
    el.tree.appendChild(box);
}

async function renderTreeInto(container, dir, depth) {
    const res = await API.readDir(dir);
    if (!res.ok) {
        const d = document.createElement('div');
        d.className = 'tree-empty';
        d.textContent = '读取失败：' + res.error;
        container.appendChild(d);
        return;
    }
    if (!res.items.length) {
        const d = document.createElement('div');
        d.className = 'tree-empty';
        d.textContent = '（空目录）';
        container.appendChild(d);
        return;
    }
    for (const item of res.items) {
        const node = document.createElement('div');
        node.className = 'tree-node';

        const row = document.createElement('div');
        row.className = 'tree-row';
        row.style.paddingLeft = (6 + depth * 12) + 'px';
        row.title = item.path;
        if (state.selectedPath === item.path) row.classList.add('selected');

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow' + (item.isDir ? '' : ' leaf');
        arrow.textContent = '▶';

        const icon = document.createElement('span');
        if (item.isDir) {
            icon.className = 'tree-icon ic-folder';
            icon.textContent = '▰';
        } else {
            const ic = iconOf(item.path);
            icon.className = 'tree-icon ' + ic.cls;
            icon.textContent = '◆';
        }

        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = item.name;

        row.appendChild(arrow); row.appendChild(icon); row.appendChild(label);
        node.appendChild(row);
        container.appendChild(node);

        const tab0 = state.tabs.find(t => t.path === item.path);
        if (tab0 && tab0.dirty) row.classList.add('dirty');

        if (item.isDir) {
            const childWrap = document.createElement('div');
            childWrap.className = 'tree-children';
            node.appendChild(childWrap);
            let loaded = false;
            const open = state.expanded.has(item.path);
            if (open) { arrow.classList.add('open'); childWrap.classList.add('open'); loaded = true; await renderTreeInto(childWrap, item.path, depth + 1); }

            row.addEventListener('click', async e => {
                e.stopPropagation();
                const isOpen = state.expanded.has(item.path);
                if (isOpen) {
                    state.expanded.delete(item.path);
                    arrow.classList.remove('open');
                    childWrap.classList.remove('open');
                } else {
                    state.expanded.add(item.path);
                    arrow.classList.add('open');
                    childWrap.classList.add('open');
                    if (!loaded) { loaded = true; await renderTreeInto(childWrap, item.path, depth + 1); }
                }
            });
            row.addEventListener('contextmenu', e => {
                e.preventDefault(); e.stopPropagation();
                state.selectedPath = item.path;
                showTreeContextMenu(e.clientX, e.clientY, item);
            });
        } else {
            row.addEventListener('click', async e => {
                e.stopPropagation();
                state.selectedPath = item.path;
                await openPath(item.path);
            });
            row.addEventListener('contextmenu', e => {
                e.preventDefault(); e.stopPropagation();
                state.selectedPath = item.path;
                showTreeContextMenu(e.clientX, e.clientY, item);
            });
        }
    }
}

async function openPath(p, opts) {
    const quiet = !!(opts && opts.quiet);
    const res = await API.readFile(p);

    if (!res.ok) {
        /* 二进制：格式问题与体积无关，改用十六进制视图打开 */
        if (res.isBinary) {
            openHexTab(p, res.size);
            if (!quiet) toast('二进制文件 ' + (res.sizeText || '') + '，已用十六进制视图打开', 'info', 3000);
            logOut('十六进制视图打开 ' + p + '（' + (res.sizeText || '') + '）', 'info');
            return { ok: true, hex: true };
        }
        if (!quiet) toast('无法打开：' + res.error, 'err', 3600);
        logOut('打开失败 ' + p + '：' + res.error, 'err');
        return { ok: false, error: res.error, tooLarge: !!res.tooLarge, size: res.size };
    }

    openTab(p, res.content, res.size);
    pluginsEmit('file:open', { path: p });        // 通知订阅了该事件的插件
    if (extOf(p) === 'py') checkPythonSyntax();
    return { ok: true };
}
