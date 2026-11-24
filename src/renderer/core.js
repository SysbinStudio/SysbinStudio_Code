/* ═══════════════════════════════════════════
   1. 基础：语言定义、全局状态、DOM 引用、工具函数
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   Sysbin Studio Code — 渲染层
   编辑器内核、多标签页、资源管理器、搜索、大纲、命令面板、终端。
   ═══════════════════════════════════════════════════════════════ */

const API = window.sysbin;

/* ─────────── 语言定义 ─────────── */

const LANGS = [
    { ext: 'js',   name: 'JavaScript',  monaco: 'javascript', run: 'node "{file}"',                       icon: 'ic-js' },
    { ext: 'mjs',  name: 'JavaScript',  monaco: 'javascript', run: 'node "{file}"',                       icon: 'ic-js' },
    { ext: 'cjs',  name: 'JavaScript',  monaco: 'javascript', run: 'node "{file}"',                       icon: 'ic-js' },
    { ext: 'jsx',  name: 'JSX',         monaco: 'javascript', run: 'node "{file}"',                       icon: 'ic-js' },
    { ext: 'ts',   name: 'TypeScript',  monaco: 'typescript', run: 'npx ts-node "{file}"',                icon: 'ic-ts' },
    { ext: 'tsx',  name: 'TSX',         monaco: 'typescript', run: 'npx ts-node "{file}"',                icon: 'ic-ts' },
    { ext: 'py',   name: 'Python',      monaco: 'python',     run: 'python "{file}"',                     icon: 'ic-py' },
    { ext: 'pyw',  name: 'Python',      monaco: 'python',     run: 'pythonw "{file}"',                    icon: 'ic-py' },
    { ext: 'html', name: 'HTML',        monaco: 'html',       run: 'start "" "{file}"',                   icon: 'ic-html' },
    { ext: 'htm',  name: 'HTML',        monaco: 'html',       run: 'start "" "{file}"',                   icon: 'ic-html' },
    { ext: 'vue',  name: 'Vue',         monaco: 'html',       run: 'start "" "{file}"',                   icon: 'ic-html' },
    { ext: 'css',  name: 'CSS',         monaco: 'css',        run: 'type "{file}"',                       icon: 'ic-css' },
    { ext: 'scss', name: 'SCSS',        monaco: 'scss',       run: 'type "{file}"',                       icon: 'ic-css' },
    { ext: 'less', name: 'Less',        monaco: 'less',       run: 'type "{file}"',                       icon: 'ic-css' },
    { ext: 'json', name: 'JSON',        monaco: 'json',       run: 'type "{file}"',                       icon: 'ic-json' },
    { ext: 'jsonc',name: 'JSON',        monaco: 'json',       run: 'type "{file}"',                       icon: 'ic-json' },
    { ext: 'md',   name: 'Markdown',    monaco: 'markdown',   run: 'type "{file}"',                       icon: 'ic-md' },
    { ext: 'yaml', name: 'YAML',        monaco: 'yaml',       run: 'type "{file}"',                       icon: 'ic-json' },
    { ext: 'yml',  name: 'YAML',        monaco: 'yaml',       run: 'type "{file}"',                       icon: 'ic-json' },
    { ext: 'xml',  name: 'XML',         monaco: 'xml',        run: 'type "{file}"',                       icon: 'ic-html' },
    { ext: 'sql',  name: 'SQL',         monaco: 'sql',        run: 'type "{file}"',                       icon: 'ic-json' },
    { ext: 'sh',   name: 'Shell',       monaco: 'shell',      run: 'bash "{file}"',                       icon: 'ic-py' },
    { ext: 'bat',  name: '批处理',       monaco: 'bat',        run: '"{file}"',                            icon: 'ic-py' },
    { ext: 'cmd',  name: '批处理',       monaco: 'bat',        run: '"{file}"',                            icon: 'ic-py' },
    { ext: 'ps1',  name: 'PowerShell',  monaco: 'powershell', run: 'powershell -ExecutionPolicy Bypass -File "{file}"', icon: 'ic-py' },
    { ext: 'c',    name: 'C',           monaco: 'c',          run: 'gcc "{file}" -o "{dir}\\a.exe" && "{dir}\\a.exe"',   icon: 'ic-ts' },
    { ext: 'h',    name: 'C 头文件',     monaco: 'c',          run: 'type "{file}"',                       icon: 'ic-ts' },
    { ext: 'cpp',  name: 'C++',         monaco: 'cpp',        run: 'g++ "{file}" -o "{dir}\\a.exe" && "{dir}\\a.exe"',  icon: 'ic-ts' },
    { ext: 'cc',   name: 'C++',         monaco: 'cpp',        run: 'g++ "{file}" -o "{dir}\\a.exe" && "{dir}\\a.exe"',  icon: 'ic-ts' },
    { ext: 'java', name: 'Java',        monaco: 'java',       run: 'java "{file}"',                       icon: 'ic-html' },
    { ext: 'go',   name: 'Go',          monaco: 'go',         run: 'go run "{file}"',                     icon: 'ic-css' },
    { ext: 'rs',   name: 'Rust',        monaco: 'rust',       run: 'rustc "{file}" -o "{dir}\\a.exe" && "{dir}\\a.exe"', icon: 'ic-json' },
    { ext: 'php',  name: 'PHP',         monaco: 'php',        run: 'php "{file}"',                        icon: 'ic-ts' },
    { ext: 'rb',   name: 'Ruby',        monaco: 'ruby',       run: 'ruby "{file}"',                       icon: 'ic-html' },
    { ext: 'lua',  name: 'Lua',         monaco: 'lua',        run: 'lua "{file}"',                        icon: 'ic-json' },
    { ext: 'cs',   name: 'C#',          monaco: 'csharp',     run: 'dotnet run --project "{dir}"',        icon: 'ic-ts' },
    { ext: 'kt',   name: 'Kotlin',      monaco: 'kotlin',     run: 'type "{file}"',                       icon: 'ic-ts' },
    { ext: 'swift',name: 'Swift',       monaco: 'swift',      run: 'type "{file}"',                       icon: 'ic-html' },
    { ext: 'txt',  name: '纯文本',       monaco: 'plaintext',  run: 'type "{file}"',                       icon: 'ic-default' }
];
const LANG_BY_EXT = {};
LANGS.forEach(l => { LANG_BY_EXT[l.ext] = l; });
const PLAIN = LANG_BY_EXT.txt;

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'ico', 'webp', 'avif'];

function extOf(p) { const m = /\.([^./\\]+)$/.exec(p || ''); return m ? m[1].toLowerCase() : ''; }
function baseOf(p) { const m = /[^/\\]+$/.exec(p || ''); return m ? m[0] : p; }
function dirOf(p) { const m = /^(.*)[/\\][^/\\]*$/.exec(p || ''); return m ? m[1] : ''; }
function langOf(p) { return LANG_BY_EXT[extOf(p)] || PLAIN; }
function iconOf(p) {
    const e = extOf(p);
    if (IMG_EXTS.includes(e)) return { cls: 'ic-img', ch: '🖼' };
    const l = LANG_BY_EXT[e];
    return { cls: l ? l.icon : 'ic-default', ch: '◆' };
}

/* ─────────── 全局状态 ─────────── */

const state = {
    tabs: [],
    active: -1,
    root: null,
    expanded: new Set(),
    selectedPath: null,
    settings: null,
    env: null,
    recent: [],
    problems: [],
    shell: { started: false, cwd: null, history: [], histIdx: -1 },
    suppress: false,
    largeMode: false          // 编辑器是否处于「大文件精简模式」
};

const DEFAULT_SETTINGS = {
    theme: 'dark',
    accent: '#6c9ef8',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    tabSize: 4,
    lineNumbers: true,
    wordWrap: false,
    minimap: true,
    autoSave: false,
    bracketColor: true,
    shellCwd: '',
    pythonPath: '',
    recent: [],
    ai: { baseURL: '', apiKey: '', model: '', temperature: 0.7, agent: true, rounds: 8 }
};

/* ─────────── DOM 引用 ─────────── */

const $ = id => document.getElementById(id);
const el = {
    sidebar: $('sidebar'), sbTitle: $('sb-title'), sbActions: $('sb-actions'),
    tree: $('file-tree'), folderName: $('folder-name'),
    tabs: $('tabs'), breadcrumb: $('breadcrumb'), welcome: $('welcome'),
    panel: $('panel'), terminal: $('terminal'), termInput: $('terminal-input'),
    termPrompt: $('term-prompt'), outputLog: $('output-log'),
    problemsList: $('problems-list'), badgeProblems: $('badge-problems'),
    overlay: $('overlay'), paletteInput: $('palette-input'), paletteList: $('palette-list'),
    paletteHint: $('palette-hint'), palettePrefix: $('palette-prefix'),
    menuPop: $('menu-pop'), ctxMenu: $('ctx-menu'), toasts: $('toasts'),
    searchInput: $('search-input'), searchResults: $('search-results'), searchMeta: $('search-meta'),
    outlineList: $('outline-list'),
    inputMask: $('input-mask'), inputValue: $('input-value'),
    stFolder: $('st-folder'), stPos: $('st-pos'), stLang: $('st-lang'),
    stIndent: $('st-indent'), stProblems: $('st-problems'), stTerminal: $('st-terminal'),
    tbSearchLabel: $('tb-search-label'),

    /* 十六进制视图 */
    hexview: $('hexview'), hexBody: $('hex-body'), hexRows: $('hex-rows'), hexTotal: $('hex-total'),
    hexFile: $('hex-file'), hexSearch: $('hex-search'), hexSearchMode: $('hex-search-mode'),
    hexHits: $('hex-hits'), hexGoto: $('hex-goto'),
    hexStatLeft: $('hex-stat-left'), hexStatRight: $('hex-stat-right'),
    hexBtnStrings: $('hex-strings'), hexBtnPe: $('hex-pe'),
    hexBtnSearch: $('hex-do-search'), hexBtnGoto: $('hex-do-goto')
};

let editor = null;   // Monaco 实例

/* ─────────── 工具函数 ─────────── */

/* 提示去重：同一条消息存活期内不重复堆叠，只累加计数并刷新倒计时。
   批量操作（如一次打开多个文件）失败时不会再刷屏。 */
const _toastLive = new Map();   // key -> { node, count, timer }

function toast(msg, kind, ms) {
    const key = (kind || '') + '|' + msg;
    const live = _toastLive.get(key);

    if (live) {
        live.count++;
        live.node.textContent = msg + '  ×' + live.count;
        clearTimeout(live.timer);
        live.timer = scheduleToastExit(key, live, ms || 2600);
        return;
    }

    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    el.toasts.appendChild(d);

    const entry = { node: d, count: 1, timer: null };
    _toastLive.set(key, entry);
    entry.timer = scheduleToastExit(key, entry, ms || 2600);
}

function scheduleToastExit(key, entry, ms) {
    return setTimeout(() => {
        _toastLive.delete(key);
        const d = entry.node;
        d.style.transition = 'opacity .25s, transform .25s';
        d.style.opacity = '0';
        d.style.transform = 'translateX(20px)';
        setTimeout(() => d.remove(), 250);
    }, ms);
}

function logOut(text, kind) {
    const d = document.createElement('div');
    d.className = 'term-line' + (kind ? ' ' + kind : '');
    d.textContent = text;
    el.outputLog.appendChild(d);
    while (el.outputLog.childNodes.length > 1500) el.outputLog.removeChild(el.outputLog.firstChild);
    el.outputLog.scrollTop = el.outputLog.scrollHeight;
}

function termLine(text, kind) {
    const d = document.createElement('div');
    d.className = 'term-line' + (kind ? ' ' + kind : '');
    d.textContent = text;
    el.terminal.appendChild(d);
    while (el.terminal.childNodes.length > 3000) el.terminal.removeChild(el.terminal.firstChild);
    el.terminal.scrollTop = el.terminal.scrollHeight;
}

function ktextOf(res) {
    let p;
    try { p = JSON.parse(res); } catch (e) { return { text: String(res) }; }
    if (p && typeof p === 'object' && p.error) return { text: '错误：' + p.error, error: true };
    if (p && typeof p === 'object' && typeof p.result === 'string') return { text: p.result };
    if (p && typeof p === 'object') return { text: JSON.stringify(p, null, 2) };
    return { text: String(p) };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isMac() { return navigator.platform.toUpperCase().includes('MAC'); }
function modKey() { return isMac() ? '⌘' : 'Ctrl'; }
