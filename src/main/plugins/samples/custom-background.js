/*
 * 自定义背景插件
 *
 * 给编辑器换背景：本地图片或纯色，可调「界面不透明度」与填充方式。
 * 安装：插件页 → 「从 JS 文件安装…」→ 选中本文件。
 *
 * 命令（Ctrl+Shift+P 搜索「背景」即可看到全部）：
 *   背景：选择本地图片…
 *   背景：深空蓝 / 暗紫 / 墨绿 / 护眼纸        —— 四个预设纯色
 *   背景：输入自定义颜色…                      —— #RRGGBB 或 CSS 颜色名
 *   背景：设置界面不透明度…                    —— 0–100，越小背景越明显
 *   背景：切换填充方式                         —— 铺满 / 适应 / 平铺
 *   背景：恢复默认
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

module.exports = {
    id: 'custom-background',
    name: '自定义背景',
    version: '1.0.0',
    description: '给编辑器换背景：本地图片 / 纯色，可调不透明度与填充方式',
    author: 'Sysbin Studio',

    activate(api) {
        /* ── 配置 ── */
        const cfg = Object.assign({}, DEFAULTS, api.settings.all());

        /* 图片复制到插件自己的数据目录，原图被移动或删除也不影响 */
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

        /* ── 命令 ── */

        api.registerCommand({
            id: 'pick',
            title: '背景：选择本地图片…',
            handler: async () => {
                const r = await api.dialog.openFile({ properties: ['openFile'], filters: IMG_FILTERS });
                if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return null;
                const src = r.filePaths[0];
                let dest = src;
                try {
                    fs.mkdirSync(dataDir, { recursive: true });
                    dest = path.join(dataDir, 'background' + (path.extname(src) || '.png'));
                    fs.copyFileSync(src, dest);
                } catch (e) {
                    dest = src;   // 复制失败就用原图，只是移动后会失效
                    api.warn('复制图片失败，改用原路径：' + e.message);
                }
                cfg.image = dest;
                cfg.color = '';
                apply('背景图片已更新');
                return dest;
            }
        });

        PRESETS.forEach(p => {
            api.registerCommand({
                id: 'color-' + p.key,
                title: '背景：' + p.name,
                handler: () => { cfg.color = p.value; cfg.image = ''; apply('背景已改为' + p.name); }
            });
        });

        api.registerCommand({
            id: 'ask-color',
            title: '背景：输入自定义颜色…',
            handler: () => {
                api.window.send('input:ask', {
                    commandId: 'custom-background:set-color',
                    title: '背景颜色',
                    label: '颜色值',
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
                apply('背景颜色已更新');
                return v;
            }
        });

        api.registerCommand({
            id: 'ask-dim',
            title: '背景：设置界面不透明度…',
            handler: () => {
                api.window.send('input:ask', {
                    commandId: 'custom-background:set-dim',
                    title: '界面不透明度',
                    label: '0 – 100',
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
                apply('不透明度已设为 ' + cfg.dim + '%');
                return cfg.dim;
            }
        });

        api.registerCommand({
            id: 'mode',
            title: '背景：切换填充方式（铺满 / 适应 / 平铺）',
            handler: () => {
                const i = MODES.findIndex(m => m.value === cfg.mode);
                const next = MODES[(i + 1) % MODES.length];
                cfg.mode = next.value;
                if (!cfg.image) { api.notify('当前是纯色背景，先选一张图片再切换填充方式', 'warn'); save(); return cfg.mode; }
                apply('填充方式：' + next.name);
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
                return true;
            }
        });

        /* 卸载 / 停用时把界面还原 */
        api.dispose(() => api.window.send('background:clear', {}));

        api.log('自定义背景插件已激活：Ctrl+Shift+P 搜索「背景」可用');
        pushLater(8);
    },

    deactivate() {
        // 界面还原由 api.dispose 里注册的清理动作完成
    }
};
