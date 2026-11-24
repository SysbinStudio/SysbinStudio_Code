/*
 * 自定义背景插件
 *
 * 给编辑器换背景：本地图片或纯色，可调「界面不透明度」与填充方式。
 * 安装：插件页 → 「从 JS 文件安装…」→ 选中本文件。
 *
 * 设置方式（两种，任选）：
 *   1) 可视化设置页 —— 左侧活动栏 🖼 图标，或「插件」卡片点「页面：背景设置」
 *   2) 命令面板 —— Ctrl+Shift+P 搜索「背景」（保留作快捷操作）
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = { image: '', color: '', mode: 'cover', dim: 72 };

const PRESETS = [
    { key: 'blue', name: '深空蓝', value: '#0b1a2e' },
    { key: 'purple', name: '暗紫', value: '#1b1230' },
    { key: 'green', name: '墨绿', value: '#0f1f1a' },
    { key: 'paper', name: '护眼纸', value: '#e8dfc8' }
];

const MODES = [
    { value: 'cover', name: '铺满' },
    { value: 'contain', name: '适应' },
    { value: 'repeat', name: '平铺' }
];

const IMG_FILTERS = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }];

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
    id: 'custom-background',
    name: '自定义背景',
    version: '1.1.0',
    description: '给编辑器换背景：本地图片 / 纯色，可视化设置页 + 命令',
    author: 'Sysbin Studio',

    activate(api) {
        const cfg = Object.assign({}, DEFAULTS, api.settings.all());
        const dataDir = path.join(api.pluginDir || __dirname, 'custom-background-data');

        const save = () => {
            api.settings.set('image', cfg.image);
            api.settings.set('color', cfg.color);
            api.settings.set('mode', cfg.mode);
            api.settings.set('dim', cfg.dim);
        };

        const push = () => api.window.send('background:set', {
            image: cfg.image || '',
            color: cfg.color || '',
            mode: cfg.mode || 'cover',
            dim: cfg.dim
        });

        /* 窗口可能还没就绪（开机自启时插件先于界面激活），失败就重试几次 */
        const pushLater = (tries) => {
            if (push()) return;
            if (tries > 0) setTimeout(() => pushLater(tries - 1), 800);
        };

        const apply = (msg) => {
            save();
            push();
            if (msg) api.notify(msg, 'ok');
        };

        /* 改完配置后刷新设置页，让面板控件反映最新值 */
        const refreshPage = () => {
            try { api.updatePage({ id: 'settings', html: renderPage() }); } catch (e) {}
        };

        /* 选图片的内部动作（设置页与命令共用） */
        const pickImage = async () => {
            const r = await api.dialog.openFile({ properties: ['openFile'], filters: IMG_FILTERS });
            if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return null;
            const src = r.filePaths[0];
            let dest = src;
            try {
                fs.mkdirSync(dataDir, { recursive: true });
                dest = path.join(dataDir, 'background' + (path.extname(src) || '.png'));
                fs.copyFileSync(src, dest);
            } catch (e) {
                dest = src;
                api.warn('复制图片失败，改用原路径：' + e.message);
            }
            cfg.image = dest;
            cfg.color = '';
            apply('背景图片已更新');
            refreshPage();
            return dest;
        };

        /* 生成设置页 HTML */
        function renderPage() {
            const isImage = !!cfg.image;
            const current = isImage
                ? '图片：' + esc(cfg.image)
                : (cfg.color ? ('纯色：' + esc(cfg.color)) : '未设置（跟随主题）');
            const swatches = PRESETS.map(p =>
                `<button class="pg-btn ghost" data-action="preset" data-key="${p.key}" ` +
                `style="background:${p.value};color:#fff;border:1px solid var(--border);min-width:96px;margin:3px 4px 3px 0">${p.name}</button>`
            ).join('');
            const modeBtns = MODES.map(m =>
                `<button class="pg-btn ${cfg.mode === m.value ? '' : 'ghost'}" data-action="mode" data-mode="${m.value}" ` +
                `style="min-width:64px;margin-right:6px">${m.name}${cfg.mode === m.value ? ' ✓' : ''}</button>`
            ).join('');

            return `
<div class="plug-page">
  <h2>🖼 自定义背景设置</h2>
  <p>所有改动即时生效并自动保存。背景图片会被复制到插件数据目录，原图移动或删除也不影响。</p>

  <div class="row" style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:8px 12px">
    <span style="color:var(--fg-2);font-size:12px">当前背景</span>
    <span style="color:var(--fg-0);font-size:13px;word-break:break-all">${current}</span>
  </div>

  <h3>背景图片</h3>
  <div class="row">
    <button class="pg-btn" data-action="pick">选择本地图片…</button>
    <button class="pg-btn ghost" data-action="clear-image">移除图片</button>
    <span class="hint">支持 PNG / JPG / WEBP / SVG 等</span>
  </div>

  <h3>纯色预设</h3>
  <div class="row">${swatches}</div>

  <h3>自定义颜色</h3>
  <div class="row">
    <input type="text" data-bind="color" value="${esc(cfg.color)}" placeholder="#RRGGBB 或 CSS 颜色名（如 navy）" />
    <button class="pg-btn ghost" data-action="clear-color">清除纯色</button>
  </div>
  <div class="hint">留空且无图片时恢复默认背景。</div>

  <h3>界面不透明度 <span data-val-for="dim" style="color:var(--accent)">${cfg.dim}</span>%</h3>
  <div class="row">
    <input type="range" data-bind="dim" min="0" max="100" step="1" value="${cfg.dim}" style="min-width:260px;max-width:420px;padding:0;border:none" />
    <span class="hint">数值越小界面越透、背景越明显；100 为完全不透明</span>
  </div>

  <h3>图片填充方式</h3>
  <div class="row">${modeBtns}</div>

  <div class="row" style="margin-top:16px">
    <button class="pg-btn ghost" data-action="reset">恢复默认</button>
  </div>
</div>`;
        }

        /* ── 注册可视化设置页（活动栏 🖼 图标 + 插件卡片入口） ── */
        api.registerPage({ id: 'settings', title: '背景设置', icon: '🖼', html: renderPage() });

        /* ── 设置页交互 ── */
        api.onPageEvent(p => {
            if (!p) return;
            /* data-bind：输入类（文本框 / 滑块） */
            if (p.action === '__bind__') {
                if (p.name === 'color') {
                    cfg.color = String(p.value == null ? '' : p.value).trim();
                    if (cfg.color) cfg.image = '';
                    apply();
                } else if (p.name === 'dim') {
                    const n = Number(p.value);
                    cfg.dim = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULTS.dim;
                    apply();
                }
                return;
            }
            /* data-action：按钮点击，参数在 p.data 里 */
            const d = p.data || {};
            const a = p.action;
            if (a === 'pick') {
                pickImage();
            } else if (a === 'clear-image') {
                cfg.image = ''; apply('已移除图片'); refreshPage();
            } else if (a === 'preset') {
                const preset = PRESETS.find(x => x.key === d.key);
                if (preset) { cfg.color = preset.value; cfg.image = ''; apply('背景已改为' + preset.name); refreshPage(); }
            } else if (a === 'clear-color') {
                cfg.color = ''; apply('已清除纯色'); refreshPage();
            } else if (a === 'mode') {
                cfg.mode = d.mode || 'cover';
                if (!cfg.image) api.notify('当前是纯色背景，先选一张图片再切换填充方式', 'warn');
                else { apply('填充方式已更新'); }
                refreshPage();
            } else if (a === 'reset') {
                Object.assign(cfg, DEFAULTS);
                apply('已恢复默认背景');
                api.window.send('background:clear', {});
                refreshPage();
            }
        });

        /* ── 命令面板（保留兼容） ── */
        api.registerCommand({ id: 'open-settings', title: '背景：打开设置面板', handler: () => api.openPage('settings') });
        api.registerCommand({ id: 'pick', title: '背景：选择本地图片…', handler: () => pickImage() });

        PRESETS.forEach(preset => {
            api.registerCommand({
                id: 'color-' + preset.key,
                title: '背景：' + preset.name,
                handler: () => { cfg.color = preset.value; cfg.image = ''; apply('背景已改为' + preset.name); refreshPage(); }
            });
        });

        api.registerCommand({
            id: 'ask-color',
            title: '背景：输入自定义颜色…',
            handler: () => {
                api.window.send('input:ask', {
                    commandId: 'custom-background:set-color',
                    title: '背景颜色', label: '颜色值',
                    desc: '支持 #RRGGBB（如 #123456）或 CSS 颜色名（如 navy），留空则清除纯色',
                    value: cfg.color || ''
                });
            }
        });
        api.registerCommand({
            id: 'set-color',
            title: '（内部）应用颜色',
            handler: (args) => {
                const v = String((args && args.value) || '').trim();
                cfg.color = v;
                if (v) cfg.image = '';
                if (!cfg.image && !cfg.color) { api.window.send('background:clear', {}); save(); return null; }
                apply('背景颜色已更新'); refreshPage();
                return v;
            }
        });
        api.registerCommand({
            id: 'ask-dim',
            title: '背景：设置界面不透明度…',
            handler: () => {
                api.window.send('input:ask', {
                    commandId: 'custom-background:set-dim',
                    title: '界面不透明度', label: '0 – 100',
                    desc: '数值越小界面越透、背景越明显；100 为完全不透明',
                    value: String(cfg.dim)
                });
            }
        });
        api.registerCommand({
            id: 'set-dim',
            title: '（内部）应用不透明度',
            handler: (args) => {
                const n = Number((args && args.value) !== undefined ? args.value : cfg.dim);
                cfg.dim = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULTS.dim;
                apply('不透明度已设为 ' + cfg.dim + '%'); refreshPage();
                return cfg.dim;
            }
        });
        api.registerCommand({
            id: 'mode',
            title: '背景：切换填充方式（铺满 / 适应 / 平铺）',
            handler: () => {
                const i = MODES.findIndex(m => m.value === cfg.mode);
                cfg.mode = MODES[(i + 1) % MODES.length].value;
                if (!cfg.image) { api.notify('当前是纯色背景，先选一张图片再切换填充方式', 'warn'); save(); return cfg.mode; }
                apply('填充方式已更新'); refreshPage();
                return cfg.mode;
            }
        });
        api.registerCommand({
            id: 'clear',
            title: '背景：恢复默认',
            handler: () => {
                Object.assign(cfg, DEFAULTS);
                save();
                api.window.send('background:clear', {});
                api.notify('已恢复默认背景', 'ok');
                refreshPage();
                return true;
            }
        });

        api.dispose(() => api.window.send('background:clear', {}));
        api.log('自定义背景插件已激活：点左侧 🖼 图标打开设置面板，或 Ctrl+Shift+P 搜索「背景」');
        pushLater(8);
    },

    deactivate() {}
};
