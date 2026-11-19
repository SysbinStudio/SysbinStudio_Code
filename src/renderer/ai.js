/* ═══════════════════════════════════════════
   18. AI 助手视图

   左侧活动栏新增「AI」视图：
     · 用户自己填写接口地址 / API Key / 模型 / 温度（保存到 config.json 的
       settings.ai，本机持久化）
     · 对话请求经主进程 ai 服务转发（绕开渲染层 CSP），支持流式输出
     · 可把「当前打开的文件」作为上下文发给模型
     · 模型返回代码块后，一键（或开启「自动写入」后自动）写回目标文件

   协议：OpenAI 兼容的 /chat/completions。
   ═══════════════════════════════════════════ */
/* ═════════════════════════════════════════
   18. AI 助手
   ═════════════════════════════════════════ */

const AI_SYS_PROMPT = '你是 Sysbin Studio Code 内置的编程助手。'
    + '请用简体中文回答。'
    + '如果需要修改或新建文件，请把完整代码放在一个代码块里返回，'
    + '并在代码块开头用「语言:相对路径」标注目标文件，例如 ```javascript:src/app.js 或 ```python:main.py；'
    + '若无法判断文件名，可在代码首行用注释写明，如 // file: utils.js。'
    + '同时简要说明改了什么。不要编造文件系统中不存在的路径。';

const aiState = {
    built: false,
    messages: [],        // [{ role:'user'|'assistant', content }]
    targetPath: '',       // 作为上下文 / 写入目标 的文件路径
    includeContext: true,
    autoApply: false,
    streaming: false,
    reqId: '',
    streamEl: null,
    blocks: []            // 识别出的代码块 [{ lang, code, file }]
};

/* settings.ai 落点，确保永远有对象可用 */
function aiCfg() {
    if (!state.settings) state.settings = {};
    if (!state.settings.ai || typeof state.settings.ai !== 'object') state.settings.ai = {};
    if (state.settings.ai.temperature === undefined) state.settings.ai.temperature = 0.7;
    return state.settings.ai;
}

function aiNextReq() { return 'ai-' + Date.now() + '-' + Math.floor(Math.random() * 1e4); }

/* ─────────── 渲染（首次建骨架，之后只刷新动态部分） ─────────── */

function renderAI() {
    const box = $('view-ai');
    if (!box) return;
    if (!aiState.built) {
        box.innerHTML = `
            <div class="ai-wrap">
                <div class="ai-cfg-note">AI 接口（地址 / Key / 模型 / 温度）请在「设置 → AI 助手」中填写，填好后直接提问，或让它帮你改写文件即可。</div>

                <div class="ai-msgs" id="ai-msgs">
                    <div class="ai-empty">在「设置 → AI 助手」填写接口后，直接问 AI 关于代码的问题，或让它帮你改写文件。</div>
                </div>

                <div class="ai-target">
                    <label class="ai-attach"><input type="checkbox" id="ai-attach" checked /> 附带当前文件内容</label>
                    <select id="ai-target-sel" title="作为上下文 / 写入目标"></select>
                    <span class="ai-ref-hint" id="ai-ref-hint"></span>
                    <label class="ai-auto"><input type="checkbox" id="ai-auto" /> 自动写入</label>
                </div>

                <div class="ai-input-row">
                    <textarea id="ai-input" placeholder="问 AI 任何关于代码的问题…（Enter 发送，Shift+Enter 换行）" spellcheck="false"></textarea>
                </div>
                <div class="ai-send-row">
                    <button class="btn btn-primary btn-sm" id="ai-send">发送</button>
                    <button class="btn btn-outline btn-sm" id="ai-stop" style="display:none">停止</button>
                    <div class="ai-flex"></div>
                    <button class="btn btn-outline btn-sm" id="ai-clear">清空对话</button>
                </div>

                <div class="ai-apply" id="ai-apply" style="display:none"></div>
            </div>`;
        aiBind(box);
        aiState.built = true;
    }
    aiRefreshTargets();
}

function aiBind(box) {
    const attach = $('ai-attach');
    attach.addEventListener('change', () => { aiState.includeContext = attach.checked; });
    $('ai-auto').addEventListener('change', e => { aiState.autoApply = e.target.checked; });
    $('ai-target-sel').addEventListener('change', e => { aiState.targetPath = e.target.value; aiUpdateRefHint(); });
    const input = $('ai-input');
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
    });
    $('ai-send').addEventListener('click', aiSend);
    $('ai-stop').addEventListener('click', aiStop);
    $('ai-clear').addEventListener('click', aiClear);
}

/* AI 配置（baseURL / apiKey / model / temperature）已迁移至「设置 → AI 助手」标签页，
   统一从 settings.ai 读取（见 aiCfg()），AI 视图不再内嵌配置表单。 */

/* 刷新「引用文件」下拉：默认选中当前活动标签；未保存文件也能引用其内容 */
function aiRefreshTargets() {
    const sel = $('ai-target-sel');
    if (!sel) return;
    const attach = $('ai-attach');
    const prev = sel.value;
    sel.textContent = '';
    const opts = [];
    for (let i = 0; i < state.tabs.length; i++) {
        const tab = state.tabs[i];
        if (!tab.model) continue;                                   // 仅引用有代码模型的文本文件（排除十六进制/插件页）
        const val = tab.path || ('__u__' + i);                      // 未保存文件用合成键，仍可引用内容
        const label = (tab.path ? baseOf(tab.path) : (tab.name || '未命名')) + (tab.path ? '' : '（未保存）');
        opts.push({ val, label });
        const o = document.createElement('option');
        o.value = val;
        o.textContent = label;
        sel.appendChild(o);
    }
    if (!opts.length) {
        sel.innerHTML = '<option value="">（未打开文件）</option>';
        aiState.targetPath = '';
        if (attach) attach.disabled = true;
        aiUpdateRefHint();
        return;
    }
    if (attach) attach.disabled = false;
    const t = activeTab();
    const activeVal = (t && t.model) ? (t.path || ('__u__' + state.tabs.indexOf(t))) : '';
    const def = (activeVal && opts.some(o => o.val === activeVal)) ? activeVal
              : (prev && opts.some(o => o.val === prev)) ? prev
              : opts[0].val;
    sel.value = def;
    aiState.targetPath = def;
    aiUpdateRefHint();
}

/* 选项值 → 被引用的标签页 */
function aiRefTab() {
    const sel = $('ai-target-sel');
    if (!sel || !sel.value) return null;
    const v = sel.value;
    if (v.indexOf('__u__') === 0) {
        const tab = state.tabs[parseInt(v.slice(5), 10)];
        return (tab && tab.model) ? tab : null;
    }
    return state.tabs.find(x => x.path === v && x.model) || null;
}

/* 取被引用文件的「名称 + 内容」：优先用已打开模型（未保存也能用），回退读盘 */
async function aiResolveRef() {
    const tab = aiRefTab();
    if (!tab) return null;
    const name = tab.path || tab.name || '未命名';
    if (tab.model) {
        const c = tab.model.getValue();
        if (c != null) return { name, content: c };
    }
    if (tab.path) {
        try { const r = await API.readFile(tab.path); if (r && r.ok) return { name, content: r.content }; } catch (e) {}
    }
    return null;
}

/* 在复选框旁显示当前引用了哪个文件，让用户一眼确认生效 */
function aiUpdateRefHint() {
    const hint = $('ai-ref-hint');
    if (!hint) return;
    const tab = aiRefTab();
    if (!tab) { hint.textContent = '（无可用文件）'; hint.style.color = 'var(--muted)'; return; }
    const nm = tab.path ? baseOf(tab.path) : (tab.name || '未命名');
    hint.textContent = '✓ 引用 ' + nm + (tab.path ? '' : '（未保存）');
    hint.style.color = 'var(--ok)';
}

/* ─────────── 对话 ─────────── */

function aiAddMsg(role, content) {
    const box = $('ai-msgs');
    const empty = box.querySelector('.ai-empty');
    if (empty) empty.remove();
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-assistant');
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    if (role === 'user') bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    else if (content) bubble.innerHTML = aiFormat(content);
    wrap.appendChild(bubble);
    box.appendChild(wrap);
    aiScroll();
    return bubble;
}

/* 把文本渲染成「自然语言段落 + 代码块」；代码块用 ``` 包裹 */
function aiFormat(text) {
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let out = '';
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
        const before = text.slice(last, m.index);
        if (before.trim()) out += `<div class="ai-text">${escapeHtml(before).replace(/\n/g, '<br>')}</div>`;
        out += `<pre class="ai-code"><code>${escapeHtml(m[2])}</code></pre>`;
        last = re.lastIndex;
    }
    const after = text.slice(last);
    if (after.trim()) out += `<div class="ai-text">${escapeHtml(after).replace(/\n/g, '<br>')}</div>`;
    return out || '<div class="ai-text"></div>';
}

async function aiSend() {
    if (aiState.streaming) return;
    const cfg = aiCfg();
    const input = $('ai-input');
    const text = input.value.trim();
    if (!text) return;
    if (!cfg.apiKey && !cfg.baseURL) {
        toast('请先在「设置 → AI 助手」填写接口地址与 API Key', 'warn', 3600);
        openSettings();
        return;
    }
    input.value = '';

    aiAddMsg('user', text);
    aiState.messages.push({ role: 'user', content: text });

    const ap0 = $('ai-apply');
    if (ap0) { ap0.style.display = 'none'; ap0.innerHTML = ''; }
    aiState.blocks = [];

    const messages = [{ role: 'system', content: AI_SYS_PROMPT }];
    if (aiState.includeContext) {
        const ref = await aiResolveRef();
        if (ref && ref.content != null) {
            messages.push({ role: 'system', content: `当前编辑文件：${ref.name}\n\n\`\`\`\n${ref.content}\n\`\`\`` });
        }
    }
    aiState.messages.forEach(mm => messages.push({ role: mm.role, content: mm.content }));
    messages.push({ role: 'user', content: text });

    const bubble = aiAddMsg('assistant', '');
    aiState.streamEl = bubble;
    aiState.streaming = true;
    aiState.reqId = aiNextReq();
    aiShowStop(true);

    API.aiChat({
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model || 'gpt-4o-mini',
        temperature: (typeof cfg.temperature === 'number') ? cfg.temperature : 0.7,
        messages,
        requestId: aiState.reqId
    }).then(res => {
        if (!res) return;
        if (res.ok && !res.streamed && res.content != null) {
            /* 服务端未走 SSE（返回普通 JSON）：主进程把完整内容经 IPC 带回，
               这里直接渲染，否则成功响应会被静默丢弃、气泡一直为空 */
            if (aiState.streamEl) {
                aiState.streamEl.innerHTML = aiFormat(res.content);
                aiState.streamEl.classList.remove('ai-err');
            }
            aiState.messages.push({ role: 'assistant', content: res.content });
            aiUpdateApply(res.content);
            aiScroll();
        } else if (!res.ok && !res.aborted) {
            const elx = aiState.streamEl;
            if (elx) { elx.textContent = '⚠ ' + (res.error || '请求失败'); elx.classList.add('ai-err'); }
        }
    }).catch(e => {
        const elx = aiState.streamEl;
        if (elx) { elx.textContent = '⚠ ' + String((e && e.message) || e); elx.classList.add('ai-err'); }
    }).finally(() => {
        aiState.streaming = false;
        aiShowStop(false);
    });
}

function aiStop() {
    if (aiState.reqId) API.aiAbort(aiState.reqId);
    aiState.streaming = false;
    aiShowStop(false);
    if (aiState.streamEl) {
        const cur = aiState.streamEl.textContent;
        aiState.streamEl.innerHTML = aiFormat(cur + '\n\n[已停止]');
    }
}

function aiClear() {
    aiState.messages = [];
    aiState.blocks = [];
    $('ai-msgs').innerHTML = '<div class="ai-empty">对话已清空。</div>';
    const ap = $('ai-apply'); if (ap) { ap.style.display = 'none'; ap.innerHTML = ''; }
}

/* ─────────── 流式事件 ─────────── */

function aiHandleToken(d) {
    if (!d || d.requestId !== aiState.reqId) return;
    if (aiState.streamEl) aiState.streamEl.textContent += d.delta;
    aiScroll();
}

function aiHandleDone(d) {
    if (!d || d.requestId !== aiState.reqId) return;
    if (aiState.streamEl) {
        aiState.streamEl.innerHTML = aiFormat(d.content || '');
        aiState.streamEl.classList.remove('ai-err');
    }
    aiState.streaming = false;
    aiShowStop(false);
    aiState.messages.push({ role: 'assistant', content: d.content || '' });
    aiUpdateApply(d.content || '');
    aiScroll();
}

/* ─────────── 代码块识别 ───────────
   解析 AI 回复里的「所有」代码块，并从围栏信息串 / 首行注释里尽量猜出文件名，
   每个代码块都给出独立的写入入口（可写回已打开文件，也可新建文件）。 */

const AI_FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;

function aiParseBlocks(content) {
    const out = [];
    if (!content) return out;
    AI_FENCE.lastIndex = 0;
    let m;
    while ((m = AI_FENCE.exec(content)) !== null) {
        const info = (m[1] || '').trim();
        const code = m[2].replace(/\n$/, '');
        if (!code.trim()) continue;
        out.push({ lang: info, code });
    }
    return out;
}

/* 路径判定与拼接（渲染层无 Node path，自带最小实现） */
function isAbsPath(s) {
    return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\');
}
function joinPath(a, b) {
    if (!a) return b;
    const sep = /\\/.test(a) ? '\\' : '/';
    return a.replace(/[\\/]+$/, '') + sep + String(b).replace(/^[\\/]+/, '');
}
/* 看起来像个文件（含分隔符，或以常见扩展名结尾） */
function looksLikePath(s) {
    if (!s) return false;
    s = s.trim().replace(/^['"]|['"]$/g, '');
    return /[\\/]/.test(s) || /\.[a-zA-Z0-9]{1,8}$/.test(s);
}

/* 从围栏信息串或代码首行注释猜文件名；返回 '' 表示猜不到 */
function aiGuessFile(lang, code) {
    const info = (lang || '').trim();
    const idx = info.indexOf(':');
    if (idx >= 0) {
        const cand = info.slice(idx + 1).trim();
        if (looksLikePath(cand)) return cand;
    }
    const head = code.split('\n').slice(0, 6).join('\n');
    const cm = /(?:\/\/|#|<!--|\/\*)\s*(?:file|filename|文件名|文件|path|路径|模块)?\s*[:：]?\s*([^\s*<>|"']+\.[A-Za-z0-9]+)/i.exec(head);
    if (cm && looksLikePath(cm[1])) return cm[1].trim();
    const ln = /(?:文件名|文件|file|path|模块)\s*[:：]?\s*([^\s*<>|"']+\.[A-Za-z0-9]+)/i.exec(head);
    if (ln && looksLikePath(ln[1])) return ln[1].trim();
    return '';
}

/* 相对/新建文件名 → 绝对路径（相对工作区根或上下文文件目录） */
function aiResolveNewPath(name) {
    const s = (name || '').trim().replace(/^['"]|['"]$/g, '');
    if (!s) return '';
    if (isAbsPath(s)) return s;
    if (state.root) return joinPath(state.root, s);
    if (aiState.targetPath && /[\\/]/.test(aiState.targetPath)) return joinPath(dirOf(aiState.targetPath), s);
    return s;
}

/* 根据 AI 回复构建「代码块 → 可写入」面板 */
function aiUpdateApply(content) {
    const ap = $('ai-apply');
    if (!ap) return;
    aiState.blocks = aiParseBlocks(content);

    if (!aiState.blocks.length) { ap.style.display = 'none'; ap.innerHTML = ''; return; }

    ap.style.display = 'flex';
    ap.innerHTML = '<div class="ai-apply-head">AI 返回了 ' + aiState.blocks.length + ' 段代码，可逐段写入：</div>';

    let autoFired = false;
    aiState.blocks.forEach((blk, i) => {
        const guessed = aiGuessFile(blk.lang, blk.code);
        const card = document.createElement('div');
        card.className = 'ai-apply-card';

        const defName = guessed || (aiState.targetPath ? baseOf(aiState.targetPath) : 'newfile.txt');
        let selOpts = '';
        if (guessed && looksLikePath(guessed)) {
            selOpts += '<option value="__new__">写入 ' + escapeHtml(guessed) + '（新建/覆盖）</option>';
        }
        for (const t of state.tabs) {
            if (t.path) selOpts += '<option value="' + escapeHtml(t.path) + '">' + escapeHtml(baseOf(t.path)) + '（已打开）</option>';
        }
        if (aiState.targetPath && /[\\/]/.test(aiState.targetPath)
            && !state.tabs.some(t => t.path === aiState.targetPath)) {
            selOpts += '<option value="' + escapeHtml(aiState.targetPath) + '">' + escapeHtml(baseOf(aiState.targetPath)) + '（当前文件）</option>';
        }

        const langLabel = blk.lang ? blk.lang : 'text';
        card.innerHTML =
            '<div class="ai-apply-row">'
            + '<span class="ai-apply-lang">' + escapeHtml(langLabel) + '</span>'
            + '<input class="ai-apply-fname" value="' + escapeHtml(defName) + '" spellcheck="false" title="文件名（可改；相对路径落在工作区内）" />'
            + '<select class="ai-apply-sel">' + selOpts + '</select>'
            + '<button class="btn btn-primary btn-sm ai-apply-btn">写入</button>'
            + '</div>';
        ap.appendChild(card);

        const sel = card.querySelector('.ai-apply-sel');
        const fname = card.querySelector('.ai-apply-fname');
        // 默认选中：猜到路径→新建；否则优先上下文文件或首个已打开标签
        let defVal = '__new__';
        if (!(guessed && looksLikePath(guessed))) {
            if (aiState.targetPath && state.tabs.some(t => t.path === aiState.targetPath)) defVal = aiState.targetPath;
            else defVal = sel.value; // 第一个 option（通常是已打开标签）
        }
        if ([...sel.options].some(o => o.value === defVal)) sel.value = defVal;

        const syncFname = () => {
            if (sel.value === '__new__') { fname.disabled = false; }
            else {
                fname.disabled = true;
                const t = state.tabs.find(x => x.path === sel.value);
                fname.value = t ? baseOf(t.path) : baseOf(sel.value);
            }
        };
        sel.addEventListener('change', syncFname);
        syncFname();

        card.querySelector('.ai-apply-btn').addEventListener('click', () => {
            const target = sel.value === '__new__' ? aiResolveNewPath(fname.value) : sel.value;
            aiApplyBlock(blk, target);
        });

        /* 自动写入：每块若能落到明确目标则自动写（已打开标签 / 猜到的路径 / 唯一块落到上下文文件） */
        if (aiState.autoApply) {
            let target = '';
            if (guessed && looksLikePath(guessed)) target = aiResolveNewPath(guessed);
            else {
                const hit = state.tabs.find(t => t.path && guessed && baseOf(t.path).toLowerCase() === String(guessed).toLowerCase());
                if (hit) target = hit.path;
            }
            if (!target && aiState.blocks.length === 1 && aiState.targetPath) target = aiState.targetPath;
            if (target) { aiApplyBlock(blk, target); autoFired = true; }
        }
    });

    if (aiState.autoApply && !autoFired) {
        toast('自动写入：未找到明确目标，请在下方手动选择', 'info', 3200);
    }
}

/* 把单个代码块写入指定路径（已存在则更新编辑器模型） */
async function aiApplyBlock(blk, target) {
    if (!target || !/[\\/]/.test(target)) {
        toast('请选择或填写一个有效的写入路径', 'warn', 3200);
        return;
    }
    const res = await API.aiWriteFile({ path: target, content: blk.code });
    if (!res.ok) { toast('写入失败：' + res.error, 'err', 3600); return; }
    const t = state.tabs.find(x => x.path === target);
    if (t && t.model) { t.model.setValue(blk.code); t.dirty = true; renderTabs(); renderTree(); }
    else if (state.root) renderTree();
    pluginsEmit('file:save', { path: target });
    toast('已写入 ' + baseOf(target), 'ok', 2000);
    logOut('AI 已将代码写入：' + target, 'info');
}

function aiShowStop(on) {
    const s = $('ai-stop'); if (s) s.style.display = on ? '' : 'none';
    const send = $('ai-send'); if (send) send.disabled = on;
}

function aiScroll() {
    const box = $('ai-msgs');
    if (box) box.scrollTop = box.scrollHeight;
}

/* 命令面板入口：用 AI 改写当前文件（把当前文件作为上下文，预填指令） */
function aiRewriteCurrent() {
    showView('ai');
    const t = activeTab();
    if (!t) { toast('请先打开一个文件', 'warn'); return; }
    if (!t.path) { toast('请先保存当前文件，再让它改写', 'warn'); return; }
    aiState.targetPath = t.path;
    const sel = $('ai-target-sel');
    if (sel) sel.value = t.path;
    const attach = $('ai-attach');
    if (attach) { attach.checked = true; aiState.includeContext = true; }
    const input = $('ai-input');
    if (input) {
        input.value = '请改进并补全这个文件，修复明显问题，然后把完整代码放在一个代码块里返回。';
        setTimeout(() => input.focus(), 60);
    }
    toast('已载入当前文件作为上下文，发送即可让 AI 改写', 'info', 2600);
}

/* 流式事件在脚本加载时就注册，保证 token 不会丢 */
API.onAiToken(d => aiHandleToken(d));
API.onAiDone(d => aiHandleDone(d));

