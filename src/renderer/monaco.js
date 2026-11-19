/* ═══════════════════════════════════════════
   16. Monaco 加载、降级模式与 boot()
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   启动
   ═══════════════════════════════════════════ */

/* Monaco 加载：本地优先，失败自动降级 CDN。
   两条路都走不通时也必须把界面启动起来，避免出现「窗口能开但点什么都没反应」。 */
const MONACO_LOCAL = 'vendor/monaco';
const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

function loadMonaco(paths, onFail) {
    try {
        require.config({ paths: { vs: paths } });
        require(['vs/editor/editor.main'],
            () => onFail ? onFail(false) : null,
            err => { if (onFail) onFail(true, err); });
    } catch (e) {
        if (onFail) onFail(true, e);
    }
}

function startMonaco() {
    if (typeof require === 'undefined' || typeof require.config !== 'function') {
        // 本地 loader 没起来，改用 CDN 的 loader
        const s = document.createElement('script');
        s.src = MONACO_CDN + '/loader.js';
        s.onload = () => loadMonaco(MONACO_CDN, (failed) => {
            if (failed) startDegraded();
            else setupEditor();
        });
        s.onerror = startDegraded;
        document.head.appendChild(s);
        return;
    }
    loadMonaco(MONACO_LOCAL, (failed) => {
        if (!failed) { setupEditor(); return; }
        // 本地失败 → 试 CDN
        loadMonaco(MONACO_CDN, (failed2) => {
            if (failed2) startDegraded();
            else setupEditor();
        });
    });
}

/* 降级模式：Monaco 完全不可用时，用一个纯 textarea 顶上，
   保证文件依然能打开、编辑、保存、运行。 */
function startDegraded() {
    const host = document.getElementById('editor');
    if (!host) return;
    host.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.id = 'fallback-textarea';
    ta.spellcheck = false;
    ta.style.cssText = 'width:100%;height:100%;background:#0d0d13;color:#d7d7e2;border:none;outline:none;padding:14px 18px;'
        + 'font-family:var(--mono);font-size:13px;line-height:1.65;resize:none;';
    host.appendChild(ta);

    // 用最小适配层模拟 monaco 实例，让上层逻辑无需分支
    editor = {
        __fallback: true,
        _model: null,
        getModel: () => editor._model,
        setModel(m) {
            editor._model = m;
            ta.value = m ? m.getValue() : '';
        },
        getValue: () => ta.value,
        setValue(v) { ta.value = v; },
        updateOptions() {}, layout() {}, focus() { ta.focus(); },
        saveViewState: () => null,
        restoreViewState() {},
        getPosition: () => ({ lineNumber: 1, column: 1 }),
        setPosition() {}, revealLineInCenter() {},
        hasTextFocus: () => document.activeElement === ta,
        getAction: () => ({ run: () => {} }),
        onDidChangeCursorPosition: () => ({ dispose() {} }),
        onDidChangeModelContent: () => ({ dispose() {} }),
        onDidChangeModelLanguage: () => ({ dispose() {} }),
        onDidFocusEditorText: () => ({ dispose() {} }),
        trigger() {}
    };
    // 全局 monaco 桩，供标签页创建模型
    window.monaco = {
        Uri: { parse: s => ({ toString: () => s, __s: s }) },
        editor: {
            createModel: (value, languageId, uri) => ({
                getValue: () => value,
                setValue(v) { value = v; },
                getLanguageId: () => languageId || 'plaintext',
                uri,
                onDidChangeContent(cb) { this._cb = cb; },
                _fire() { this._cb && this._cb(); },
                dispose() {}
            }),
            getModel: () => null,
            defineTheme() {}, setTheme() {}, create: () => editor
        },
        languages: { getLanguages: () => [] }
    };
    // textarea 输入同步回“模型”
    ta.addEventListener('input', () => {
        const t = state.tabs[state.active];
        if (t && t.model) { t.model.setValue(ta.value); if (t.model._fire) t.model._fire(); }
    });

    boot(true);
}

function setupEditor() {
    monaco.editor.defineTheme('sysbin-dark', {
        base: 'vs-dark', inherit: true, rules: [],
        colors: {
            'editor.background': '#0d0d13',
            'editor.foreground': '#d7d7e2',
            'editor.lineHighlightBackground': '#16161f',
            'editorCursor.foreground': '#6c9ef8',
            'editor.selectionBackground': '#2a3550',
            'editorLineNumber.foreground': '#3d3d4d',
            'editorLineNumber.activeForeground': '#8a8a9c',
            'editorIndentGuide.background1': '#21212c',
            'editorGutter.background': '#0d0d13'
        }
    });
    monaco.editor.defineTheme('sysbin-light', {
        base: 'vs', inherit: true, rules: [],
        colors: {
            'editor.background': '#ffffff',
            'editor.lineHighlightBackground': '#f4f4f8',
            'editorCursor.foreground': '#4a7ad6',
            'editor.selectionBackground': '#d3e2ff'
        }
    });

    editor = monaco.editor.create($('editor'), {
        value: '',
        language: 'plaintext',
        theme: 'sysbin-dark',
        automaticLayout: true,
        minimap: { enabled: true, renderCharacters: false },
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        lineNumbers: 'on',
        folding: true,
        renderLineHighlight: 'all',
        bracketPairColorization: { enabled: true },
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
        wordBasedSuggestions: 'currentDocument',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        mouseWheelZoom: true,
        scrollBeyondLastLine: false,
        padding: { top: 10 },
        tabSize: 4,
        insertSpaces: true,
        renderWhitespace: 'selection',
        scrollbar: { verticalScrollbarSize: 11, horizontalScrollbarSize: 11, useShadows: false },
        stickyScroll: { enabled: false }
    });

    installLocalKeywordCompletion();
    boot(false);
}

/* ─────────── 本地关键字/片段补全（纯本地，零网络，绝不调用 AI） ───────────
   覆盖各语言「全部关键字」+ 常用结构片段，强化 Monaco 原生语法补全。
   触发：输入前缀或按 Ctrl+Space；Tab 接受。 */

const LOCAL_COMPLETIONS = {
    javascript: {
        keywords: ['break','case','catch','class','const','continue','debugger','default','delete','do','else','export','extends','finally','for','function','if','import','in','instanceof','new','return','super','switch','this','throw','try','typeof','var','void','while','with','yield','let','static','get','set','async','await','of'],
        snippets: [
            { label: 'fn', doc: '函数声明', body: 'function ${1:name}(${2:args}) {\n\t$0\n}' },
            { label: 'afn', doc: '箭头函数', body: 'const ${1:name} = (${2:args}) => {\n\t$0\n};' },
            { label: 'meth', doc: '类方法', body: '${1:name}(${2:args}) {\n\t$0\n}' },
            { label: 'cls', doc: '类', body: 'class ${1:Name} {\n\tconstructor(${2:args}) {\n\t\t$0\n\t}\n}' },
            { label: 'try', doc: 'try/catch', body: 'try {\n\t$0\n} catch (${1:err}) {\n\t${2:// handle}\n}' },
            { label: 'for', doc: 'for 循环', body: 'for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}' },
            { label: 'if', doc: 'if/else', body: 'if (${1:cond}) {\n\t$0\n} else {\n\t\n}' },
            { label: 'log', doc: 'console.log', body: 'console.log(${1:});' },
            { label: 'async', doc: '异步函数', body: 'async function ${1:name}(${2:args}) {\n\t$0\n}' }
        ]
    },
    typescript: {
        keywords: ['break','case','catch','class','const','continue','debugger','default','delete','do','else','export','extends','finally','for','function','if','import','in','instanceof','new','return','super','switch','this','throw','try','typeof','var','void','while','with','yield','let','static','get','set','async','await','of','enum','implements','interface','type','public','private','protected','readonly','abstract','as','from','namespace','declare','constructor','unknown','never','any','string','number','boolean','symbol','bigint','keyof','infer','is','satisfies','override'],
        snippets: [
            { label: 'fn', doc: '函数', body: 'function ${1:name}(${2:args}): ${3:void} {\n\t$0\n}' },
            { label: 'afn', doc: '箭头函数', body: 'const ${1:name} = (${2:args}): ${3:void} => {\n\t$0\n};' },
            { label: 'iface', doc: '接口', body: 'interface ${1:Name} {\n\t${2:key}: ${3:type};\n}' },
            { label: 'cls', doc: '类', body: 'class ${1:Name} {\n\tconstructor(${2:args}) {\n\t\t$0\n\t}\n}' },
            { label: 'try', doc: 'try/catch', body: 'try {\n\t$0\n} catch (${1:err}) {\n\t${2:// handle}\n}' }
        ]
    },
    python: {
        keywords: ['False','None','True','and','as','assert','async','await','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield','match','case'],
        snippets: [
            { label: 'def', doc: '函数', body: 'def ${1:name}(${2:args}):\n\t$0' },
            { label: 'cls', doc: '类', body: 'class ${1:Name}:\n\tdef __init__(self, ${2:args}):\n\t\t$0' },
            { label: 'meth', doc: '方法', body: 'def ${1:name}(self, ${2:args}):\n\t$0' },
            { label: 'try', doc: 'try/except', body: 'try:\n\t$0\nexcept ${1:Exception} as e:\n\t${2:pass}' },
            { label: 'for', doc: 'for 循环', body: 'for ${1:item} in ${2:iterable}:\n\t$0' },
            { label: 'if', doc: 'if/else', body: 'if ${1:cond}:\n\t$0\nelse:\n\t' },
            { label: 'main', doc: '主入口', body: "if __name__ == '__main__':\n\t$0" }
        ]
    },
    java: {
        keywords: ['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','exports','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','module','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','var','void','volatile','while'],
        snippets: [
            { label: 'fn', doc: '方法', body: 'public ${1:void} ${2:name}(${3:args}) {\n\t$0\n}' },
            { label: 'cls', doc: '类', body: 'public class ${1:Name} {\n\t$0\n}' },
            { label: 'try', doc: 'try/catch', body: 'try {\n\t$0\n} catch (${1:Exception} e) {\n\t${2:// handle}\n}' },
            { label: 'for', doc: 'for 循环', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}' }
        ]
    },
    cpp: {
        keywords: ['alignas','alignof','and','and_eq','asm','atomic_cancel','atomic_commit','atomic_noexcept','auto','bitand','bitor','bool','break','case','catch','char','char8_t','char16_t','char32_t','class','co_await','co_return','co_yield','compl','concept','const','consteval','constexpr','constinit','const_cast','continue','decltype','default','delete','do','double','dynamic_cast','else','enum','explicit','export','extern','false','float','for','friend','goto','if','inline','int','long','mutable','namespace','new','noexcept','not','not_eq','nullptr','operator','or','or_eq','private','protected','public','reflexpr','register','reinterpret_cast','requires','return','short','signed','sizeof','static','static_assert','static_cast','struct','switch','template','this','thread_local','throw','true','try','typedef','typeid','typename','union','unsigned','using','virtual','void','volatile','wchar_t','while','xor','xor_eq'],
        snippets: [
            { label: 'fn', doc: '函数', body: '${1:void} ${2:name}(${3:args}) {\n\t$0\n}' },
            { label: 'cls', doc: '类', body: 'class ${1:Name} {\npublic:\n\t$0\n};' },
            { label: 'try', doc: 'try/catch', body: 'try {\n\t$0\n} catch (${1:std::exception}& e) {\n\t${2:// handle}\n}' },
            { label: 'for', doc: 'for 循环', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}' },
            { label: 'main', doc: 'main', body: 'int main() {\n\t$0\n\treturn 0;\n}' }
        ]
    },
    c: {
        keywords: ['auto','break','case','char','const','continue','default','do','double','else','enum','extern','float','for','goto','if','inline','int','long','register','restrict','return','short','signed','sizeof','static','struct','switch','typedef','union','unsigned','void','volatile','while','_Alignas','_Alignof','_Atomic','_Bool','_Complex','_Generic','_Imaginary','_Noreturn','_Static_assert','_Thread_local'],
        snippets: [
            { label: 'fn', doc: '函数', body: '${1:void} ${2:name}(${3:args}) {\n\t$0\n}' },
            { label: 'main', doc: 'main', body: 'int main() {\n\t$0\n\treturn 0;\n}' },
            { label: 'for', doc: 'for 循环', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}' },
            { label: 'struct', doc: '结构体', body: 'struct ${1:Name} {\n\t$0\n};' }
        ]
    },
    csharp: {
        keywords: ['abstract','as','base','bool','break','byte','case','catch','char','checked','class','const','continue','decimal','default','delegate','do','double','else','enum','event','explicit','extern','false','finally','fixed','float','for','foreach','goto','if','implicit','in','int','interface','internal','is','lock','long','namespace','new','null','object','operator','out','override','params','private','protected','public','readonly','ref','return','sbyte','sealed','short','sizeof','stackalloc','static','string','struct','switch','this','throw','true','try','typeof','uint','ulong','unchecked','unsafe','ushort','using','virtual','void','volatile','while','yield'],
        snippets: [
            { label: 'fn', doc: '方法', body: 'public ${1:void} ${2:Name}(${3:args})\n{\n\t$0\n}' },
            { label: 'cls', doc: '类', body: 'public class ${1:Name}\n{\n\t$0\n}' },
            { label: 'try', doc: 'try/catch', body: 'try\n{\n\t$0\n}\ncatch (${1:Exception} e)\n{\n\t${2:// handle}\n}' }
        ]
    },
    go: {
        keywords: ['break','case','chan','const','continue','default','defer','else','fallthrough','for','func','go','goto','if','import','interface','map','package','range','return','select','struct','switch','type','var'],
        snippets: [
            { label: 'fn', doc: '函数', body: 'func ${1:name}(${2:args}) ${3:error} {\n\t$0\n}' },
            { label: 'meth', doc: '方法', body: 'func (${1:r} *${2:Type}) ${3:Name}(${4:args}) ${5:error} {\n\t$0\n}' },
            { label: 'main', doc: 'main', body: 'func main() {\n\t$0\n}' },
            { label: 'if', doc: 'if', body: 'if ${1:cond} {\n\t$0\n}' }
        ]
    },
    rust: {
        keywords: ['as','break','const','continue','crate','dyn','else','enum','extern','false','fn','for','if','impl','in','let','loop','match','mod','move','mut','pub','ref','return','self','Self','static','struct','super','trait','true','type','unsafe','use','where','while','async','await'],
        snippets: [
            { label: 'fn', doc: '函数', body: 'fn ${1:name}(${2:args}) -> ${3:()} {\n\t$0\n}' },
            { label: 'struct', doc: '结构体', body: 'struct ${1:Name} {\n\t$0\n}' },
            { label: 'impl', doc: 'impl', body: 'impl ${1:Name} {\n\t$0\n}' },
            { label: 'match', doc: 'match', body: 'match ${1:expr} {\n\t${2:_} => ${3:},\n}' }
        ]
    },
    php: {
        keywords: ['abstract','and','array','as','break','callable','case','catch','class','clone','const','continue','declare','default','die','do','echo','else','elseif','empty','enddeclare','endfor','endforeach','endif','endswitch','endwhile','eval','exit','extends','final','finally','for','foreach','function','global','goto','if','implements','include','include_once','instanceof','insteadof','interface','isset','list','namespace','new','or','print','private','protected','public','require','require_once','return','static','switch','throw','trait','try','unset','use','var','while','xor','yield','fn','match'],
        snippets: [
            { label: 'fn', doc: '函数', body: 'function ${1:name}(${2:args}) {\n\t$0\n}' },
            { label: 'cls', doc: '类', body: 'class ${1:Name} {\n\t$0\n}' },
            { label: 'try', doc: 'try/catch', body: 'try {\n\t$0\n} catch (${1:Exception} $e) {\n\t${2:// handle}\n}' }
        ]
    },
    ruby: {
        keywords: ['__ENCODING__','__LINE__','__FILE__','BEGIN','END','alias','and','begin','break','case','class','def','defined?','do','else','elsif','end','ensure','false','for','if','in','module','next','nil','not','or','redo','rescue','retry','return','self','super','then','true','undef','unless','until','when','while','yield'],
        snippets: [
            { label: 'def', doc: '方法', body: 'def ${1:name}(${2:args})\n\t$0\nend' },
            { label: 'cls', doc: '类', body: 'class ${1:Name}\n\t$0\nend' },
            { label: 'if', doc: 'if', body: 'if ${1:cond}\n\t$0\nend' }
        ]
    },
    sql: {
        keywords: ['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','DROP','ALTER','INDEX','VIEW','JOIN','INNER','LEFT','RIGHT','FULL','OUTER','ON','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','DISTINCT','AS','AND','OR','NOT','NULL','IS','IN','LIKE','BETWEEN','EXISTS','UNION','ALL','CASE','WHEN','THEN','ELSE','END','PRIMARY','KEY','FOREIGN','REFERENCES','UNIQUE','DEFAULT','CONSTRAINT','CHECK','AUTO_INCREMENT','COUNT','SUM','AVG','MIN','MAX'],
        snippets: [
            { label: 'sel', doc: 'SELECT', body: 'SELECT ${1:*} FROM ${2:table} WHERE ${3:cond};' },
            { label: 'ins', doc: 'INSERT', body: 'INSERT INTO ${1:table} (${2:cols}) VALUES (${3:vals});' },
            { label: 'upd', doc: 'UPDATE', body: 'UPDATE ${1:table} SET ${2:col} = ${3:val} WHERE ${4:cond};' },
            { label: 'del', doc: 'DELETE', body: 'DELETE FROM ${1:table} WHERE ${2:cond};' },
            { label: 'cre', doc: 'CREATE TABLE', body: 'CREATE TABLE ${1:name} (\n\t${2:id} ${3:INT} PRIMARY KEY\n);' }
        ]
    },
    html: {
        keywords: [],
        snippets: [
            { label: 'div', doc: 'div', body: '<div class="${1:}">\n\t$0\n</div>' },
            { label: 'span', doc: 'span', body: '<span class="${1:}">$0</span>' },
            { label: 'a', doc: '链接', body: '<a href="${1:}">$0</a>' },
            { label: 'img', doc: '图片', body: '<img src="${1:}" alt="${2:}" />' },
            { label: 'ul', doc: '无序列表', body: '<ul>\n\t<li>$0</li>\n</ul>' },
            { label: 'table', doc: '表格', body: '<table>\n\t<tr>\n\t\t<td>$0</td>\n\t</tr>\n</table>' },
            { label: 'form', doc: '表单', body: '<form action="${1:}" method="${2:post}">\n\t$0\n</form>' },
            { label: 'input', doc: '输入', body: '<input type="${1:text}" name="${2:}" />' },
            { label: 'button', doc: '按钮', body: '<button type="${1:button}">$0</button>' },
            { label: 'script', doc: 'script', body: '<script src="${1:}"></script>' },
            { label: 'link', doc: 'link', body: '<link rel="stylesheet" href="${1:}" />' },
            { label: 'section', doc: 'section', body: '<section>\n\t$0\n</section>' }
        ]
    },
    css: {
        keywords: ['color','background','background-color','margin','padding','border','border-radius','font-size','font-family','font-weight','width','height','display','position','top','right','bottom','left','flex','flex-direction','justify-content','align-items','grid','grid-template-columns','gap','opacity','transition','transform','box-shadow','text-align','line-height','overflow','z-index','cursor','outline','visibility','content'],
        snippets: [
            { label: 'mqa', doc: '媒体查询', body: '@media (${1:max-width: 768px}) {\n\t$0\n}' },
            { label: 'key', doc: 'keyframes', body: '@keyframes ${1:name} {\n\tfrom { $0 }\n\tto { }\n}' },
            { label: 'cls', doc: '类选择器', body: '.${1:name} {\n\t$0\n}' },
            { label: 'id', doc: 'ID 选择器', body: '#${1:name} {\n\t$0\n}' }
        ]
    },
    json: {
        keywords: [],
        snippets: [
            { label: 'kv', doc: '键值对', body: '"${1:key}": "${2:value}"' },
            { label: 'obj', doc: '对象', body: '{\n\t"${1:key}": "${2:value}"\n}' },
            { label: 'arr', doc: '数组', body: '[\n\t${1:}\n]' }
        ]
    },
    markdown: {
        keywords: [],
        snippets: [
            { label: 'link', doc: '链接', body: '[${1:text}](${2:url})' },
            { label: 'code', doc: '代码块', body: '```${1:lang}\n$0\n```' },
            { label: 'h1', doc: '标题', body: '# ${1:}' },
            { label: 'h2', doc: '标题', body: '## ${1:}' },
            { label: 'list', doc: '列表', body: '- ${1:}' },
            { label: 'quote', doc: '引用', body: '> ${1:}' },
            { label: 'table', doc: '表格', body: '| ${1:列1} | ${2:列2} |\n| --- | --- |\n| ${3:a} | ${4:b} |' }
        ]
    },
    shell: {
        keywords: ['if','then','else','elif','fi','for','while','do','done','case','esac','function','select','until','in','return','export','local','source','echo','printf','read','cd','exit','set','unset','alias'],
        snippets: [
            { label: 'fn', doc: '函数', body: '${1:name}() {\n\t$0\n}' },
            { label: 'if', doc: 'if', body: 'if [ ${1:cond} ]; then\n\t$0\nfi' },
            { label: 'for', doc: 'for', body: 'for ${1:i} in ${2:list}; do\n\t$0\ndone' },
            { label: 'case', doc: 'case', body: 'case ${1:var} in\n\t${2:pattern}) $0 ;;\nesac' }
        ]
    },
    _default: {
        keywords: ['break','case','catch','class','const','continue','default','do','else','for','function','if','import','new','return','switch','this','throw','try','var','void','while'],
        snippets: [
            { label: 'fn', doc: '函数', body: 'function ${1:name}(${2:args}) {\n\t$0\n}' },
            { label: 'if', doc: 'if', body: 'if (${1:cond}) {\n\t$0\n}' },
            { label: 'for', doc: 'for 循环', body: 'for (${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}' },
            { label: 'try', doc: 'try/catch', body: 'try {\n\t$0\n} catch (${1:e}) {\n\t\n}' }
        ]
    }
};

const LANG_NAME = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java',
    cpp: 'C++', c: 'C', csharp: 'C#', go: 'Go', rust: 'Rust', php: 'PHP', ruby: 'Ruby',
    sql: 'SQL', html: 'HTML', css: 'CSS', json: 'JSON', markdown: 'Markdown', shell: 'Shell',
    _default: '通用'
};

function installLocalKeywordCompletion() {
    if (!monaco || !monaco.languages || !monaco.languages.registerCompletionItemProvider) return;
    const langs = (monaco.languages.getLanguages() || []).map(l => l.id);
    if (!langs.length) return;
    const KW = monaco.languages.CompletionItemKind.Keyword;
    const SNIP = monaco.languages.CompletionItemKind.Snippet;
    const SNIP_RULE = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    langs.forEach(lid => {
        if (lid === 'plaintext') return;
        const conf = LOCAL_COMPLETIONS[lid] || LOCAL_COMPLETIONS._default;
        const langName = LANG_NAME[lid] || lid;
        monaco.languages.registerCompletionItemProvider(lid, {
            provideCompletionItems(model, position) {
                const word = model.getWordUntilPosition(position);
                const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
                const items = [];
                (conf.keywords || []).forEach(k => {
                    items.push({ label: k, kind: KW, insertText: k, detail: langName + '关键字', range: range });
                });
                (conf.snippets || []).forEach(s => {
                    items.push({
                        label: s.label,
                        kind: SNIP,
                        insertText: s.body,
                        insertTextRules: SNIP_RULE,
                        detail: 'Sysbin娘的奇思妙想',
                        documentation: s.doc,
                        range: range
                    });
                });
                return { suggestions: items };
            }
        });
    });
}

async function boot(degraded) {
    bindEditorEvents();
    bindHex();
    bindMenus();
    bindPalette();
    bindTerminal();
    bindShortcuts();
    bindResizers();
    bindPanels();
    bindActivityBar();
    bindTitlebar();
    bindWelcome();
    bindExplorer();
    bindTools();
    bindAbout();
    bindSettings();
    bindSearch();
    bindPlugins();          // 插件页面与市场（renderer/plugins.js）
    showView('explorer');
    refreshPlugins();       // 后台拉一次插件清单，顺带把插件命令塞进命令面板

    // 载入设置
    try {
        const loaded = await API.loadSettings();
        state.settings = Object.assign({}, DEFAULT_SETTINGS);
        if (loaded && loaded.ok && loaded.data && typeof loaded.data === 'object') {
            Object.keys(DEFAULT_SETTINGS).forEach(k => { if (loaded.data[k] !== undefined) state.settings[k] = loaded.data[k]; });
        }
        if (loaded && loaded.path) { state.env = { settingsPath: loaded.path }; }
    } catch (e) {
        state.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
    state.suppress = true; applyAll(); state.suppress = false;
    renderRecent();
    restoreBackdrop();      // 恢复上次设置的背景（要等设置载入完，applyTheme 才不会拿到空的 state.settings）

    // 环境信息
    try {
        const info = await API.envInfo();
        state.env = Object.assign(state.env || {}, info);
        $('about-ver').textContent = 'v' + info.appVersion;
        showPyCurrent(info.pythonPath);
        $('set-file-path').textContent = info.settingsPath || '（未知）';
        $('set-file-path').title = info.settingsPath || '';
        if (state.settings.pythonPath) {
            const r = await API.setPythonPath(state.settings.pythonPath);
            showPyCurrent(r.pythonPath);
        }
    } catch (e) {}

    // 初始文档
    if (state.tabs.length === 0) {
        untitledSeq = 0;
        const t = newUntitled('js');
        t.model.setValue(
`// 欢迎使用 Sysbin Studio Code
// Ctrl+Shift+P 打开命令面板 · Ctrl+P 快速打开文件

function greet(name) {
    return \`你好，\${name}！\`;
}

console.log(greet('Sysbin'));

// F5 运行当前文件，结果会显示在下方终端
`);
        t.dirty = false;
        renderTabs();
    }

    updateStatusPaths();
    logOut('Sysbin Studio Code 已就绪', 'info');

    /* 接收外部打开请求。
       先注册增量监听，再取走冷启动攒下的路径，顺序不能反：
       反了的话，take 与首批 push 之间存在空窗，那批文件会被丢掉。*/
    try {
        API.onOpenTargets((list) => { openTargets(list); });
        const initial = await API.takeOpenTargets();
        if (initial && initial.length) await openTargets(initial);
    } catch (e) {
        logOut('外部打开通道异常：' + ((e && e.message) || e), 'err');
    }

    if (degraded) {
        logOut('⚠ Monaco 内核未能加载，已切换到简易编辑模式（仍可编辑 / 保存 / 运行）', 'warn');
        toast('Monaco 未加载，已进入简易编辑模式', 'warn', 5000);
    } else {
        logOut('Monaco Editor 已加载（本地资源）', 'info');
    }
    if (state.env) {
        logOut('Electron ' + state.env.electron + ' · Node ' + state.env.node + ' · Chromium ' + state.env.chrome, 'info');
        logOut('Python 内核: ' + (state.env.pythonPath || '未探测到'), state.env.pythonPath ? 'info' : 'warn');
    }
    el.stPos.textContent = '行 1，列 1';
}

function updateStatusPaths() {
    el.stFolder.textContent = state.root ? baseOf(state.root) : '无文件夹';
    el.stFolder.title = state.root || '';
}
