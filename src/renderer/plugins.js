/* ═══════════════════════════════════════════
   插件页面 / 插件市场

   左侧活动栏新增「插件」视图，两个页签：
     已安装  —— 列出 plugins 目录下的插件，可启用 / 停用 / 重载 / 卸载
     插件市场 —— 抓取 https://123pen.cn/ssc/codl/ 的目录列表，可一键安装 .js

   插件注册的命令会同步进命令面板（Ctrl+Shift+P）。
   ═══════════════════════════════════════════ */

const pluginState = {
    tab: 'installed',
    plugins: [],
    commands: [],
    market: { items: [], error: '', loading: false, url: '', source: '' },
    filter: ''
};

/* 插件页注册表：key = "pluginId:pageId" -> 页面定义。
   既是侧边栏图标的来源，也是打开页面时取 html 的来源。 */
const pluginPages = new Map();

/* 插件页面的 DOM 引用挂在统一的 el 上 */
Object.assign(el, {
    plugList: $('plug-list'),
    plugCount: $('plug-count'),
    plugMarketList: $('plug-market-list'),
    plugMarketUrl: $('plug-market-url'),
    plugMarketFilter: $('plug-market-filter')
});

const PLUGIN_PALETTE = [];   // 注入命令面板的插件命令（刷新时整体替换）

function pluginPage(name) { return $('plug-page-' + name); }

function switchPluginTab(name) {
    pluginState.tab = name;
    document.querySelectorAll('.plug-tab').forEach(b => b.classList.toggle('active', b.dataset.plugtab === name));
    pluginPage('installed').classList.toggle('active', name === 'installed');
    pluginPage('market').classList.toggle('active', name === 'market');
    if (name === 'market' && !pluginState.market.items.length && !pluginState.market.loading) fetchMarket();
}

/* ══════ 已安装 ══════ */

async function refreshPlugins() {
    try {
        const r = await API.pluginsList();
        pluginState.plugins = (r && r.plugins) || [];
    } catch (e) {
        pluginState.plugins = [];
        logOut('读取插件列表失败：' + String((e && e.message) || e), 'err');
    }
    try {
        const c = await API.pluginsCommands();
        pluginState.commands = (c && c.commands) || [];
    } catch (e) {
        pluginState.commands = [];
    }
    renderPluginList();
    syncPluginCommands();
}

function renderPluginList() {
    const box = el.plugList;
    box.textContent = '';
    syncPluginPages();
    rebuildPluginIcons();

    const list = pluginState.plugins;
    if (el.plugCount) el.plugCount.textContent = list.length ? String(list.length) : '';

    if (!list.length) {
        box.innerHTML = '<div class="empty-state small"><p>还没有安装插件</p>'
            + '<p class="plug-hint">点上面的「从 JS 文件安装…」，或去「插件市场」逛逛</p></div>';
        return;
    }

    for (const p of list) renderPluginCard(box, p);
}

function renderPluginCard(box, p) {
    const card = document.createElement('div');
    card.className = 'plug-card' + (p.state === 'error' || p.state === 'missing' ? ' is-bad' : '')
        + (p.enabled && p.state === 'active' ? ' is-on' : '');

    /* ── 头部 ── */
    const head = document.createElement('div');
    head.className = 'plug-card-head';

    const title = document.createElement('div');
    title.className = 'plug-name';
    title.textContent = p.name || p.id;

    const ver = document.createElement('span');
    ver.className = 'plug-ver';
    ver.textContent = 'v' + (p.version || '0.0.0');
    title.appendChild(ver);

    if (p.source && p.source !== 'local') {
        const badge = document.createElement('span');
        badge.className = 'plug-badge';
        badge.textContent = p.source === 'market' ? '市场' : p.source;
        title.appendChild(badge);
    }

    const toggle = document.createElement('label');
    toggle.className = 'switch';
    toggle.title = p.enabled ? '点击停用' : '点击启用';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!p.enabled;
    cb.addEventListener('change', () => togglePlugin(p.id, cb.checked));
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggle.appendChild(cb);
    toggle.appendChild(slider);

    head.appendChild(title);
    head.appendChild(toggle);
    card.appendChild(head);

    /* ── 描述 ── */
    if (p.description) {
        const d = document.createElement('div');
        d.className = 'plug-desc';
        d.textContent = p.description;
        card.appendChild(d);
    }

    /* ── 元信息 ── */
    const meta = document.createElement('div');
    meta.className = 'plug-meta';
    meta.textContent = [
        p.author ? '作者：' + p.author : '',
        'ID：' + p.id,
        stateText(p)
    ].filter(Boolean).join('　·　');
    card.appendChild(meta);

    if (p.error) {
        const err = document.createElement('div');
        err.className = 'plug-error';
        err.textContent = p.error;
        card.appendChild(err);
    }

    /* ── 命令 ── */
    if (p.commands && p.commands.length) {
        const cmds = document.createElement('div');
        cmds.className = 'plug-cmds';
        for (const c of p.commands) {
            const b = document.createElement('button');
            b.className = 'plug-cmd';
            b.textContent = c.title || c.id;
            b.title = c.id;
            b.addEventListener('click', () => runPluginCommand(c.id));
            cmds.appendChild(b);
        }
        card.appendChild(cmds);
    }

    /* ── 页面入口（插件通过 api.registerPage 注册的页面） ── */
    if (p.pages && p.pages.length) {
        const pg = document.createElement('div');
        pg.className = 'plug-pages';
        for (const page of p.pages) {
            pg.appendChild(plugButton('页面：' + (page.title || page.id), () => openPluginPage(p.id, page.id), '在代码区打开该插件的页面'));
        }
        card.appendChild(pg);
    }

    /* ── 操作 ── */
    const acts = document.createElement('div');
    acts.className = 'plug-acts';
    acts.appendChild(plugButton('重载', () => reloadPlugin(p.id), '改完代码不用重启编辑器'));
    acts.appendChild(plugButton('打开目录', () => openPluginDir(p), '在资源管理器中显示插件文件'));
    acts.appendChild(plugButton('卸载', () => uninstallPlugin(p), '', true));
    card.appendChild(acts);

    box.appendChild(card);
}

function stateText(p) {
    if (p.state === 'missing') return '文件已丢失';
    if (p.state === 'error') return '加载失败';
    return p.enabled ? (p.state === 'active' ? '已启用' : '待启用') : '已停用';
}

function plugButton(text, onClick, title, danger) {
    const b = document.createElement('button');
    b.className = 'plug-act' + (danger ? ' danger' : '');
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
}

async function togglePlugin(id, enabled) {
    const r = await API.pluginsToggle({ id, enabled });
    if (r && !r.ok) toast(r.error || '操作失败', 'err', 3000);
    else toast((enabled ? '已启用 ' : '已停用 ') + id, 'ok', 1600);
    refreshPlugins();
}

async function reloadPlugin(id) {
    const r = await API.pluginsReload(id);
    if (r && !r.ok) toast(r.error || '重载失败', 'err', 3200);
    else toast('已重载 ' + id, 'ok', 1600);
    refreshPlugins();
}

async function uninstallPlugin(p) {
    const ok = await confirmBox('卸载插件', `确定卸载「${p.name}」吗？\n插件文件会从插件目录删除。`);
    if (!ok) return;
    const r = await API.pluginsUninstall(p.id);
    if (r && !r.ok) toast(r.error || '卸载失败', 'err', 3000);
    else toast('已卸载 ' + p.name, 'ok', 1800);
    refreshPlugins();
}

async function openPluginDir(p) {
    try {
        const e = await API.envInfo();
        const dir = (p && p.dir) || (e && e.pluginsDir);
        if (dir) await API.openPath(dir);
    } catch (err) { toast('打开失败', 'err'); }
}

async function installPluginLocal() {
    const r = await API.pluginsInstallLocal();
    if (!r) return;
    if (r.canceled) return;
    if (!r.ok) toast(r.error || '安装失败', 'err', 3600);
    else toast(`已安装「${r.name}」`, 'ok', 2200);
    refreshPlugins();
}

async function runPluginCommand(id) {
    const r = await API.pluginsRunCommand({ id });
    if (r && !r.ok) toast('命令执行失败：' + (r.error || ''), 'err', 3200);
}

/* ══════ 插件页面 / 侧边栏图标 ══════
   插件通过 api.registerPage({id,title,icon,html}) 注册页面。
   渲染层据此在活动栏注入图标，点击图标 → 在代码区开一个标签页承载 html。
   页面里的 [data-action] 点击、[data-bind] 输入都会转发给插件的 onPageEvent。 */

/* 以「已安装插件列表」为权威源，重建 pluginPages（绕过主进程消息时序问题） */
function syncPluginPages() {
    pluginPages.clear();
    for (const p of pluginState.plugins) {
        if (!p.enabled || p.state !== 'active') continue;
        for (const pg of (p.pages || [])) {
            pluginPages.set(p.id + ':' + pg.id, {
                pluginId: p.id, pageId: pg.id,
                title: pg.title || pg.id, icon: pg.icon || '◈', html: pg.html || ''
            });
        }
    }
}

/* 根据 pluginPages 重建活动栏里的插件图标 */
function rebuildPluginIcons() {
    const box = $('ab-plugins');
    if (!box) return;
    box.textContent = '';
    for (const def of pluginPages.values()) {
        const b = document.createElement('button');
        b.className = 'ab-item ab-plugin';
        b.title = def.title;
        b.dataset.plugin = def.pluginId;
        b.dataset.page = def.pageId;
        b.textContent = def.icon || '◈';
        b.addEventListener('click', () => openPluginPage(def.pluginId, def.pageId));
        box.appendChild(b);
    }
}

function openPluginPage(pluginId, pageId) {
    const def = pluginPages.get(pluginId + ':' + pageId);
    if (!def) { toast('该插件页面不可用（插件未启用？）', 'warn', 2800); return; }
    openPluginTab(pluginId, pageId, def);
}

function registerPluginPage(payload) {
    const def = payload || {};
    if (!def.id || !def.pluginId) return;
    pluginPages.set(def.pluginId + ':' + def.id, {
        pluginId: def.pluginId, pageId: def.id,
        title: def.title || def.id, icon: def.icon || '◈', html: def.html || ''
    });
    rebuildPluginIcons();
}

/* 插件改了页面内容（如设置面板的值变化）后推送更新：
   同步已注册定义（下次打开用新 HTML），并刷新当前已打开的该插件标签。 */
function updatePluginPage(payload) {
    const def = payload || {};
    if (!def.id || !def.pluginId) return;
    const key = def.pluginId + ':' + def.id;
    const prev = pluginPages.get(key);
    pluginPages.set(key, {
        pluginId: def.pluginId, pageId: def.id,
        title: def.title || (prev && prev.title) || def.id,
        icon: def.icon || (prev && prev.icon) || '◈',
        html: def.html || ''
    });
    const tab = state.tabs.find(t => t.kind === 'plugin' && t.pluginKey === key);
    if (tab) {
        tab.html = def.html || '';
        tab.name = def.title || tab.name;
        if (activeTab() === tab) {
            const pv = $('plugin-view');
            if (pv) pv.innerHTML = tab.html;
            el.stPos.textContent = tab.name || '';
            renderTabs();
        }
    }
}

function unregisterPluginPages(pluginId) {
    if (!pluginId) return;
    const prefix = pluginId + ':';
    for (const k of Array.from(pluginPages.keys())) {
        if (k.indexOf(prefix) === 0) pluginPages.delete(k);
    }
    rebuildPluginIcons();
}

function findActivePluginTab() {
    const t = activeTab();
    return (t && t.kind === 'plugin') ? t : null;
}

/* 让活动栏插件图标高亮匹配当前打开的插件页面（切走时自动取消） */
function syncPluginIconActive() {
    const t = activeTab();
    const onKind = !!(t && t.kind === 'plugin');
    document.querySelectorAll('#ab-plugins .ab-plugin').forEach(b => {
        const on = onKind && b.dataset.plugin === t.pluginId && b.dataset.page === t.pageId;
        b.classList.toggle('active', on);
    });
}

/* 插件命令同步进命令面板 */
function syncPluginCommands() {
    for (const item of PLUGIN_PALETTE) {
        const i = COMMANDS.indexOf(item);
        if (i >= 0) COMMANDS.splice(i, 1);
    }
    PLUGIN_PALETTE.length = 0;
    for (const c of pluginState.commands) {
        const item = {
            label: c.title || c.id,
            detail: '插件 · ' + c.pluginId,
            run: () => runPluginCommand(c.id)
        };
        PLUGIN_PALETTE.push(item);
        COMMANDS.push(item);
    }
}

/* ══════ 插件市场 ══════ */

/* 市场请求序号：连点刷新或切换地址时，只有最后一次请求的结果会被采用，
   否则先发的慢请求回来后会覆盖掉新结果 */
let marketSeq = 0;

async function fetchMarket(url) {
    const seq = ++marketSeq;
    const m = pluginState.market;
    const target = url || marketBaseUrl();
    m.loading = true;
    m.error = '';
    renderMarket();

    let r = null;
    try {
        r = await API.pluginsMarketFetch({ url: url || '' });
    } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
    }
    if (seq !== marketSeq) return;   // 已经有更新的请求了，丢弃这次结果
    m.loading = false;
    m.items = (r && r.items) || [];
    m.error = (r && r.error) || '';
    m.url = (r && r.url) || target || '';
    m.source = (r && r.source) || '';
    renderMarket();
}

/* 市场地址可自定义（自建市场 / 本地调试）：marketBaseUrl() 为空则用官方默认地址。
   要换成自己的市场，改这里即可。 */
function marketBaseUrl() { return ''; }

function renderMarket() {
    const m = pluginState.market;
    const box = el.plugMarketList;
    box.textContent = '';

    if (el.plugMarketUrl) {
        el.plugMarketUrl.textContent = m.url ? '目录：' + m.url : '';
        el.plugMarketUrl.title = m.url || '';
    }

    if (m.loading) {
        box.innerHTML = '<div class="empty-state small"><p>正在获取市场目录…</p></div>';
        return;
    }

    const kw = pluginState.filter.trim().toLowerCase();
    const items = m.items.filter(it => !kw || it.name.toLowerCase().includes(kw));

    if (m.error) {
        const d = document.createElement('div');
        d.className = 'plug-error';
        d.textContent = m.error;
        box.appendChild(d);
        /* 403 八成是目录浏览被关了，给一句能照做的提示，别让用户干瞪眼 */
        if (/403/.test(m.error)) {
            const tip = document.createElement('div');
            tip.className = 'plug-hint';
            tip.textContent = '多半是服务器关闭了目录浏览：把 index.php 传到该目录，'
                + '再访问 index.php?format=json 就能出清单。';
            box.appendChild(tip);
        }
    }

    if (!items.length) {
        const e = document.createElement('div');
        e.className = 'empty-state small';
        e.innerHTML = '<p>' + (m.error ? '没有可显示的条目' : (kw ? '没有匹配「' + escapeHtml(kw) + '」的文件' : '点「刷新市场」获取列表')) + '</p>';
        box.appendChild(e);
        return;
    }

    for (const it of items) renderMarketRow(box, it);
}

function renderMarketRow(box, it) {
    const row = document.createElement('div');
    row.className = 'plug-market-item' + (it.installable ? '' : ' is-muted');

    const icon = document.createElement('span');
    icon.className = 'plug-mk-icon';
    icon.textContent = it.isDir ? '📁' : (it.installable ? '🧩' : '📄');

    const main = document.createElement('div');
    main.className = 'plug-mk-main';

    const nm = document.createElement('div');
    nm.className = 'plug-mk-name' + (it.isDir ? ' is-dir' : '');
    nm.textContent = it.name;
    nm.title = it.url;
    /* 目录可以再往下钻一层 */
    if (it.isDir) nm.addEventListener('click', () => fetchMarket(it.url));
    main.appendChild(nm);

    const sub = document.createElement('div');
    sub.className = 'plug-mk-sub';
    sub.textContent = [
        it.sizeText || '',
        it.modified ? formatMarketDate(it.modified) : '',
        it.version ? 'v' + it.version : '',
        it.downloads ? it.downloads + ' 次下载' : '',
        it.isDir ? '目录' : ''
    ].filter(Boolean).join('　·　');
    main.appendChild(sub);

    if (it.description) {
        const d = document.createElement('div');
        d.className = 'plug-mk-desc';
        d.textContent = it.description;
        main.appendChild(d);
    }

    row.appendChild(icon);
    row.appendChild(main);

    const acts = document.createElement('div');
    acts.className = 'plug-mk-acts';
    if (it.installable) {
        acts.appendChild(plugButton('安装', () => installMarketItem(it)));
    }
    acts.appendChild(plugButton('打开', () => openMarketItem(it), '在浏览器中打开'));
    row.appendChild(acts);

    box.appendChild(row);
}

function formatMarketDate(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch (e) { return ''; }
}

function openMarketItem(it) {
    if (!it || !it.url) return;
    /* 市场地址不在 open-external 白名单里，走主进程的插件通道（限 123pen.cn） */
    API.pluginsOpenUrl(it.url).then(r => {
        if (r && !r.ok) toast(r.error || '打开失败', 'err');
    }).catch(() => toast('打开失败', 'err'));
}

async function installMarketItem(it) {
    toast('正在安装 ' + it.name + ' …', 'info', 2000);
    const r = await API.pluginsMarketInstall({ url: it.url });
    if (!r || !r.ok) toast((r && r.error) || '安装失败', 'err', 3600);
    else toast(`已安装「${r.name || it.name}」`, 'ok', 2400);
    switchPluginTab('installed');
    refreshPlugins();
}

/* ══════ 绑定 ══════ */

function bindPlugins() {
    document.querySelectorAll('.plug-tab').forEach(b => {
        b.addEventListener('click', () => switchPluginTab(b.dataset.plugtab));
    });
    $('plug-refresh').addEventListener('click', () => {
        if (pluginState.tab === 'market') fetchMarket();
        else refreshPlugins();
    });
    $('plug-install-local').addEventListener('click', installPluginLocal);
    $('plug-open-dir').addEventListener('click', async () => {
        const r = await API.pluginsOpenDir();
        if (r && !r.ok) toast(r.error || '打开失败', 'err');
    });
    $('plug-market-fetch').addEventListener('click', () => fetchMarket());
    el.plugMarketFilter.addEventListener('input', () => {
        pluginState.filter = el.plugMarketFilter.value || '';
        renderMarket();
    });

    /* 插件主动推过来的消息 */
    API.onPluginNotify(d => { if (d) toast(d.text, d.kind || 'info', 2600); });
    API.onPluginLog(d => {
        if (!d) return;
        logOut('[' + d.pluginId + '] ' + d.text, d.level === 'err' ? 'err' : (d.level === 'warn' ? 'warn' : null));
    });
    API.onPluginOpenFile(d => { if (d && d.path) openPath(d.path); });
    API.onPluginEdit(d => { if (d && d.action === 'insert') pluginInsertText(d.text); });
    API.onPluginMessage(handlePluginMessage);

    /* 插件页面的交互事件：把页面里的点击 / 输入转发给插件的 onPageEvent 处理器。
       - 任何带 data-action 的元素被点击 → 发送 { action, ...其余 data-* 属性 }
       - 任何带 data-bind 的表单控件变化 → 发送 { action:'__bind__', name, value } */
    const pv = $('plugin-view');
    if (pv) {
        pv.addEventListener('click', e => {
            const node = e.target.closest && e.target.closest('[data-action]');
            if (!node) return;
            const tab = findActivePluginTab();
            if (!tab) return;
            const data = {};
            for (const a of Array.from(node.attributes)) {
                if (a.name.indexOf('data-') === 0 && a.name !== 'data-action') data[a.name.slice(5)] = a.value;
            }
            API.pluginPageEvent({ pluginId: tab.pluginId, pageId: tab.pageId, action: node.dataset.action, data });
        });
        pv.addEventListener('input', e => {
            const node = e.target.closest && e.target.closest('[data-bind]');
            if (!node) return;
            /* 通用增强：同一行里带 data-val-for 的显示元素跟随更新（滑块数值等） */
            const row = node.closest('.row');
            if (row) {
                const disp = row.querySelector('[data-val-for]');
                if (disp && disp.dataset.valFor === node.dataset.bind) {
                    disp.textContent = (node.type === 'checkbox' || node.type === 'radio')
                        ? (node.checked ? '开' : '关') : node.value;
                }
            }
            const tab = findActivePluginTab();
            if (!tab) return;
            /* 复选框用 checked，其余用 value */
            const val = (node.type === 'checkbox' || node.type === 'radio') ? node.checked : node.value;
            API.pluginPageEvent({ pluginId: tab.pluginId, pageId: tab.pageId, action: '__bind__', name: node.dataset.bind, value: val });
        });
    }
}

/* ═══════════════════════════════════════════
   界面外观通道（供插件调用）

   插件通过 api.window.send(channel, payload) 下发：
     background:set   应用背景：{ image?, color?, mode?, dim? }
     background:clear 恢复默认外观
     input:ask        让编辑器弹一个输入框，结果回传给插件命令
                      { commandId, title, label, desc, value, placeholder }
   ═══════════════════════════════════════════ */

const BACKDROP_KEY = 'sysbin.backdrop';

state.backdrop = { on: false, dim: 1 };

function fileUrlOf(p) {
    const s = String(p || '').replace(/\\/g, '/');
    return 'file:///' + encodeURI(s.replace(/^\/+/, ''));
}

function clampDim(v) {
    const n = Number(v);
    return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 72));
}

function backdropCss(cfg) {
    const a = (clampDim(cfg.dim) / 100).toFixed(3);
    let img = '';
    if (cfg.image) {
        const mode = cfg.mode === 'contain' ? 'contain' : (cfg.mode === 'repeat' ? 'auto' : 'cover');
        img = `background-image:url("${fileUrlOf(cfg.image)}");`
            + `background-repeat:${cfg.mode === 'repeat' ? 'repeat' : 'no-repeat'};`
            + `background-position:center;background-attachment:fixed;background-size:${mode};`;
    }
    const color = cfg.color ? `background-color:${cfg.color};` : '';

    /* Monaco 自带一层不透明底色（.monaco-editor / .monaco-editor-background），
       不处理的话它会整块盖住背景图 —— 侧栏能看见、编辑区看不见就是这个原因。
       这里用 #editor 前缀提高优先级，强制把它打穿，
       让下面 .editor-host 的半透明 --bg-0 来体现不透明度。 */
    const monacoFix = `#editor .monaco-editor,#editor .monaco-editor .monaco-editor-background,`
        + `#editor .monaco-editor .margin-view-overlays,#editor .monaco-editor .overflow-guard,`
        + `#editor .monaco-editor .monaco-scrollable-element,#editor .monaco-editor .view-lines{`
        + `background-color:transparent !important;}`
        + `#editor .monaco-editor{--vscode-editor-background:transparent !important;}`;

    return `html,body{${img}${color}}`
        + monacoFix
        + `body.theme-dark{--bg-0:rgba(13,13,19,${a});--bg-1:rgba(20,20,28,${a});--bg-2:rgba(26,26,36,${a});--bg-3:rgba(32,32,44,${a});--bg-4:rgba(38,38,51,${a});}`
        + `body.theme-light{--bg-0:rgba(245,245,248,${a});--bg-1:rgba(255,255,255,${a});--bg-2:rgba(240,240,244,${a});--bg-3:rgba(230,230,236,${a});--bg-4:rgba(220,220,228,${a});}`;
}

/* cfg: { image, color, mode, dim }；persist=false 时只应用不写入本地存储 */
function applyBackdrop(cfg, persist) {
    cfg = cfg || {};
    let style = document.getElementById('plugin-backdrop-style');

    if (!cfg.image && !cfg.color) { clearBackdrop(persist); return; }

    state.backdrop = { on: true, dim: clampDim(cfg.dim) / 100 };
    if (!style) {
        style = document.createElement('style');
        style.id = 'plugin-backdrop-style';
        document.head.appendChild(style);
    }
    style.textContent = backdropCss({
        image: cfg.image || '',
        color: cfg.color || '',
        mode: cfg.mode || 'cover',
        dim: cfg.dim
    });
    if (persist !== false) {
        try { localStorage.setItem(BACKDROP_KEY, JSON.stringify(cfg)); } catch (e) {}
    }
    if (typeof applyTheme === 'function') applyTheme();   // 让编辑器底色跟着变半透明
}

function clearBackdrop(persist) {
    state.backdrop = { on: false, dim: 1 };
    const style = document.getElementById('plugin-backdrop-style');
    if (style) style.remove();
    if (persist !== false) {
        try { localStorage.removeItem(BACKDROP_KEY); } catch (e) {}
    }
    if (typeof applyTheme === 'function') applyTheme();
}

/* 启动时恢复上次设置的背景（插件此时可能还没来得及下发） */
function restoreBackdrop() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(BACKDROP_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && (saved.image || saved.color)) applyBackdrop(saved, false);
}

/* 插件请求弹输入框，结果回传给插件自己的命令 */
async function handleInputAsk(payload) {
    const p = payload || {};
    const value = await promptInput({
        title: p.title || '输入',
        label: p.label || '值',
        desc: p.desc || '',
        value: p.value || '',
        placeholder: p.placeholder || ''
    });
    if (value === null || !p.commandId) return;
    const r = await API.pluginsRunCommand({ id: p.commandId, args: { value } });
    if (r && !r.ok) toast('插件处理输入失败：' + (r.error || ''), 'err', 3000);
}

/* 插件主动推过来的消息 */
function handlePluginMessage(d) {
    if (!d) return;
    const ch = d.channel || '';
    const payload = d.payload || {};
    if (ch === 'background:set') applyBackdrop(payload, true);
    else if (ch === 'background:clear') clearBackdrop(true);
    else if (ch === 'input:ask') handleInputAsk(payload);
    /* 插件页面：注册 / 打开 / 注销 */
    else if (ch === 'page:register') registerPluginPage(payload);
    else if (ch === 'page:update') updatePluginPage(payload);
    else if (ch === 'page:open') {
        const pid = payload.pluginId, pgid = payload.pageId || payload.id;
        if (pid && pgid) openPluginPage(pid, pgid);
    }
    else if (ch === 'page:unregister') unregisterPluginPages(payload.pluginId);
}

/* 插件让编辑器插入文本 */
function pluginInsertText(text) {
    if (!text) return;
    try {
        const sel = editor && editor.getSelection ? editor.getSelection() : null;
        if (editor && typeof editor.executeEdits === 'function' && sel) {
            editor.executeEdits('plugin', [{ range: sel, text: String(text), forceMoveMarkers: true }]);
        } else {
            const t = activeTab();
            if (t && t.model) t.model.setValue(t.model.getValue() + String(text));
        }
    } catch (e) {
        toast('插件插入文本失败', 'err');
    }
}

/* 编辑器事件回传给插件（file:open / file:save） */
function pluginsEmit(event, payload) {
    try { API.pluginsEvent(event, payload || {}); } catch (e) {}
}
