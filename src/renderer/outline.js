/* ═══════════════════════════════════════════
   7. 大纲
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   4. 大纲
   ═══════════════════════════════════════════ */

let outlineTimer = null;
function scheduleOutline() {
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(renderOutline, 400);
}

async function renderOutline() {
    const t = activeTab();
    if (!editor || !t) {
        el.outlineList.innerHTML = '<div class="empty-state"><p>当前文件没有可显示的符号</p></div>';
        return;
    }
    let symbols = [];
    try { symbols = await monaco.editor.getModelMarkers ? [] : []; } catch (e) {}
    try {
        const provider = await getSymbols(t.model);
        symbols = provider;
    } catch (e) { symbols = []; }

    el.outlineList.textContent = '';
    if (!symbols.length) {
        el.outlineList.innerHTML = '<div class="empty-state"><p>当前文件没有可显示的符号</p></div>';
        return;
    }
    const flat = [];
    (function walk(list, depth) { list.forEach(s => { flat.push({ s, depth }); if (s.children) walk(s.children, depth + 1); }); })(symbols, 0);

    flat.forEach(({ s, depth }) => {
        const row = document.createElement('div');
        row.className = 'outline-item';
        row.style.paddingLeft = (12 + depth * 14) + 'px';
        const kind = document.createElement('span');
        kind.className = 'oi-kind';
        kind.textContent = KIND_LABEL[s.kind] || '•';
        const name = document.createElement('span');
        name.className = 'oi-name';
        name.textContent = s.name;
        const ln = document.createElement('span');
        ln.className = 'oi-line';
        ln.textContent = s.range.startLineNumber;
        row.appendChild(kind); row.appendChild(name); row.appendChild(ln);
        row.addEventListener('click', () => {
            editor.revealLineInCenter(s.range.startLineNumber);
            editor.setPosition({ lineNumber: s.range.startLineNumber, column: s.range.startColumn });
            editor.focus();
        });
        el.outlineList.appendChild(row);
    });
}

const KIND_LABEL = {
    0: 'file', 1: 'mod', 2: 'ns', 3: 'pkg', 4: 'cls', 5: 'meth',
    6: 'prop', 7: 'fld', 8: 'ctor', 9: 'enum', 10: 'iface',
    11: 'func', 12: 'var', 13: 'const', 14: 'str', 15: 'num',
    16: 'bool', 17: 'arr', 18: 'obj', 19: 'key', 20: 'null',
    21: 'enum', 22: 'struct', 23: 'event', 24: 'op', 25: 'type'
};

function getSymbols(model) {
    return new Promise(resolve => {
        const providers = monaco.languages.getLanguages();
        const lang = model.getLanguageId();
        const ok = ['javascript', 'typescript', 'json', 'html', 'css', 'scss', 'less', 'markdown', 'python'].includes(lang);
        if (!ok) return resolve([]);
        // Monaco 自带 documentSymbolProvider（js/ts/json/css/html 有）
        monaco.editor.getModelMarkers && null;
        try {
            const reg = monaco.languages.getLanguages().filter(l => l.id === lang);
            if (!reg.length) return resolve([]);
        } catch (e) {}
        // 用内置命令取符号
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; resolve([]); } }, 1200);
        try {
            import('vs/editor/editor.main').catch(() => {});
        } catch (e) {}
        // 通过 editor action 不可行，改用轻量解析
        clearTimeout(t);
        done = true;
        resolve(lightOutline(model));
    });
}

// 轻量正则大纲：覆盖常见语言的函数/类/方法定义
function lightOutline(model) {
    const lang = model.getLanguageId();
    const text = model.getValue();
    const lines = text.split('\n');
    const out = [];
    const patterns = {
        javascript: [
            [/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'func'],
            [/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, 'cls'],
            [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, 'func'],
            [/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$]/, 'var'],
            [/^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/, 'meth']
        ],
        typescript: [
            [/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'func'],
            [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'cls'],
            [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'iface'],
            [/^\s*(?:export\s+)?(?:type|enum)\s+([A-Za-z_$][\w$]*)/, 'type'],
            [/^\s{2,}(?:public|private|protected|async|static|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, 'meth']
        ],
        python: [
            [/^class\s+([A-Za-z_]\w*)/, 'cls'],
            [/^(\s*)def\s+([A-Za-z_]\w*)/, 'func']
        ],
        css: [[/^([.#]?[A-Za-z][\w-]*)[^{]*\{/, 'rule']],
        scss: [[/^([.#]?[A-Za-z][\w-]*)[^{]*\{/, 'rule']],
        less: [[/^([.#]?[A-Za-z][\w-]*)[^{]*\{/, 'rule']],
        html: [[/^\s*<(section|div|header|footer|main|nav|article|aside|form|table)\b[^>]*(?:id|class)="([^"]+)"/, 'tag']],
        markdown: [[/^(#{1,6})\s+(.*)$/, 'head']],
        json: [[/^\s{2}"([^"]+)"\s*:/, 'key']],
        shell: [[/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/, 'func']],
        bat: [[/^\s*:([A-Za-z_]\w*)/, 'label']]
    };
    const pats = patterns[lang];
    if (pats) {
        lines.forEach((line, i) => {
            for (const [re, kind] of pats) {
                const m = re.exec(line);
                if (m) {
                    let name = m[2] !== undefined && m[1] && /^\s+$/.test(m[1]) ? m[2] : m[1];
                    if (kind === 'head') name = m[2].trim();
                    if (kind === 'tag') name = '<' + m[1] + '> ' + m[2];
                    if (!name || name.length > 60) continue;
                    out.push({ name: name.trim(), kind: KIND_REV[kind] || 12, range: { startLineNumber: i + 1, startColumn: 1 } });
                    break;
                }
            }
        });
    } else {
        // 通用兜底：按缩进层次识别
        lines.forEach((line, i) => {
            const m = /^(\s*)([A-Za-z_][\w]*)\s*\(.*\)\s*[:{]?\s*$/.exec(line);
            if (m) out.push({ name: m[2], kind: 11, range: { startLineNumber: i + 1, startColumn: 1 } });
        });
    }
    return out.slice(0, 400);
}

const KIND_REV = { func: 11, cls: 4, var: 12, meth: 5, iface: 10, type: 25, rule: 19, tag: 19, head: 4, key: 19, label: 11 };
