/* ═══════════════════════════════════════════
   5. 资源管理器：目录树、上下文菜单
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
function collapseAll() {
    if (state.root) state.expanded = new Set([state.root]);
    renderTree();
}

/* 右键菜单 */
function showTreeContextMenu(x, y, item) {
    const items = [];
    if (item.isDir) {
        items.push({ label: '新建文件', act: () => createInDir(item.path, false) });
        items.push({ label: '新建文件夹', act: () => createInDir(item.path, true) });
        items.push({ sep: true });
    }
    items.push({ label: '重命名', act: () => renameItem(item) });
    items.push({ label: '删除（移入回收站）', act: () => deleteItem(item) });
    items.push({ sep: true });
    items.push({ label: '在资源管理器中显示', act: () => API.revealPath(item.path) });
    if (!item.isDir) items.push({ label: '复制完整路径', act: () => copyText(item.path) });
    showContextMenu(x, y, items);
}

function showTabContextMenu(x, y, i) {
    const t = state.tabs[i];
    showContextMenu(x, y, [
        { label: '关闭', act: () => closeTab(i) },
        { label: '关闭其他', act: () => closeOthers(i) },
        { label: '关闭右侧', act: () => closeToRight(i) },
        { label: '关闭全部', act: () => closeAll() },
        { sep: true },
        { label: '复制文件路径', disabled: !t.path, act: () => copyText(t.path) },
        { label: '在资源管理器中显示', disabled: !t.path, act: () => API.revealPath(t.path) }
    ]);
}

async function closeOthers(keep) {
    for (let i = state.tabs.length - 1; i >= 0; i--) if (i !== keep) await closeTab(i);
}
async function closeToRight(idx) {
    for (let i = state.tabs.length - 1; i > idx; i--) await closeTab(i);
}
async function closeAll() {
    for (let i = state.tabs.length - 1; i >= 0; i--) await closeTab(i);
}

/* 文件操作 */
async function createInDir(dir, isFolder) {
    const name = await promptInput({
        title: isFolder ? '新建文件夹' : '新建文件',
        label: '名称',
        desc: '将创建于 ' + dir,
        placeholder: isFolder ? '新建文件夹' : 'untitled.js',
        value: isFolder ? '新建文件夹' : ''
    });
    if (!name) return;
    const target = dir + (dir.endsWith('\\') || dir.endsWith('/') ? '' : sep()) + name;
    const res = isFolder ? await API.createDir(target) : await API.createFile(target);
    if (!res.ok) { toast(res.error, 'err'); return; }
    state.expanded.add(dir);
    await renderTree();
    if (!isFolder) await openPath(target);
    toast('已创建 ' + name, 'ok', 1600);
}

function sep() { return state.root && state.root.includes('\\') ? '\\' : '/'; }

async function renameItem(item) {
    const name = await promptInput({ title: '重命名', label: '新名称', value: item.name, desc: item.path });
    if (!name || name === item.name) return;
    const to = dirOf(item.path) + sep() + name;
    const res = await API.renamePath({ from: item.path, to });
    if (!res.ok) { toast(res.error, 'err'); return; }
    // 同步已打开的标签页
    const t = state.tabs.find(t => t.path === item.path);
    if (t) {
        t.path = to;
        t.model = t.model; // 保留内容
        el.stLang.textContent = langOf(to).name;
    }
    await renderTree();
    renderTabs(); renderBreadcrumb();
    toast('已重命名为 ' + name, 'ok', 1600);
}

async function deleteItem(item) {
    const yes = await confirmBox('删除', `确定把「${item.name}」移入回收站吗？\n\n${item.path}`);
    if (!yes) return;
    const res = await API.deletePath(item.path);
    if (!res.ok) { toast(res.error, 'err', 3200); return; }
    // 关闭相关标签
    for (let i = state.tabs.length - 1; i >= 0; i--) {
        const p = state.tabs[i].path;
        if (p && (p === item.path || p.startsWith(item.path + '\\') || p.startsWith(item.path + '/'))) {
            state.tabs[i].dirty = false;
            state.tabs.splice(i, 1);
        }
    }
    if (state.active >= state.tabs.length) state.active = state.tabs.length - 1;
    if (state.active >= 0 && state.tabs[state.active]) activateTab(state.active);
    else { state.active = -1; updateWelcome(); renderTabs(); renderBreadcrumb(); renderOutline(); }
    await renderTree();
    toast('已移入回收站', 'ok', 1800);
}
