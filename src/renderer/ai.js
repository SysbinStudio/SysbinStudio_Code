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

/* Agent 模式系统提示：强调工具用法与「写/执行需用户确认」 */
const AI_AGENT_SYS_PROMPT = '你是 Sysbin Studio Code 内置的编程 Agent，具备读写文件与执行命令的能力。'
    + '请用简体中文回答，并善用提供的工具而不是凭空猜测：'
    + '1. 需要查看文件内容时用 read_file，需要了解项目结构用 list_dir；'
    + '2. 需要修改或新建文件时用 write_file 直接写入完整内容（用户会在界面上看到 diff 并确认）；'
    + '3. 需要运行测试、构建、查看版本时用 run_command；'
    + '4. 只读查询与常见构建命令会自动放行，其它命令需用户确认，请据此合理安排；'
    + '5. 路径可写绝对路径或相对工作区根目录；不要编造不存在的文件；'
    + '6. 任务完成后用简短中文说明你做了什么、改了哪些文件。';

const aiState = {
    built: false,
    messages: [],        // [{ role:'user'|'assistant', content }]
    targetPath: '',       // 作为上下文 / 写入目标 的文件路径
    includeContext: true,
    autoApply: false,
    streaming: false,
    reqId: '',
    streamEl: null,
    blocks: [],           // 识别出的代码块 [{ lang, code, file }]
    toolCards: new Map(), // 当前工具卡片（只保留最新一个）
    activeToolCallId: '',  // 当前显示的工具调用 id；旧事件被忽略
    allowFullAccess: false // 完全访问：跳过写入/命令的二次确认（仍有绝对命令黑名单兜底）
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

                <div class="ai-full-access" id="ai-full-access">
                    <button type="button" class="ai-fa-toggle" id="ai-fa-toggle">🔓 允许完全访问 (Allow Full Access)</button>
                    <span class="ai-fa-hint" id="ai-fa-hint"></span>
                </div>

                <div class="ai-msgs" id="ai-msgs">
                    <div class="ai-empty">在「设置 → AI 助手」填写接口后，直接问 AI 关于代码的问题，或让它帮你改写文件。</div>
                </div>

                <div class="ai-target">
                    <label class="ai-attach"><input type="checkbox" id="ai-attach" checked /> 附带当前文件内容</label>
                    <select id="ai-target-sel" title="作为上下文 / 写入目标"></select>
                    <span class="ai-ref-hint" id="ai-ref-hint"></span>
                    <label class="ai-auto"><input type="checkbox" id="ai-auto" /> 自动写入</label>
                </div>

                <div class="ai-tool-slot" id="ai-tool-slot"></div>

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
    aiSyncFullAccessUI();
    aiRefreshTargets();
}

/* 同步「允许完全访问」开关的视觉状态与危险提示 */
function aiSyncFullAccessUI() {
    const btn = $('ai-fa-toggle');
    const hint = $('ai-fa-hint');
    if (!btn) return;
    btn.classList.toggle('on', aiState.allowFullAccess);
    btn.textContent = aiState.allowFullAccess
        ? '🔴 完全访问已开启 (Full Access ON)' : '🔓 允许完全访问 (Allow Full Access)';
    if (hint) {
        hint.textContent = aiState.allowFullAccess
            ? '已开启免确认模式，AI 将自动执行写入和命令' : '';
    }
}

function aiBind(box) {
    const fa = $('ai-fa-toggle');
    if (fa) fa.addEventListener('click', () => {
        aiState.allowFullAccess = !aiState.allowFullAccess;
        aiSyncFullAccessUI();
        toast(aiState.allowFullAccess
            ? '⚠ 已开启完全访问：AI 写入与命令不再弹窗确认'
            : '已关闭完全访问：恢复二次确认',
            aiState.allowFullAccess ? 'warn' : 'info', 3000);
    });
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

    const isAgent = cfg.agent !== false;
    const messages = [{ role: 'system', content: isAgent ? AI_AGENT_SYS_PROMPT : AI_SYS_PROMPT }];
    if (isAgent && state.root) {
        messages.push({ role: 'system', content: '工作区根目录：' + state.root });
    }
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
    aiState.toolCards.clear();
    aiState.activeToolCallId = '';
    const slot0 = $('ai-tool-slot');
    if (slot0) slot0.textContent = '';
    aiShowStop(true);

    const basePayload = {
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model || 'gpt-4o-mini',
        temperature: (typeof cfg.temperature === 'number') ? cfg.temperature : 0.7,
        messages,
        requestId: aiState.reqId
    };
    const call = isAgent
        ? API.aiAgent(Object.assign({}, basePayload, {
            root: state.root || '',
            maxRounds: cfg.rounds || 8,
            allowFullAccess: aiState.allowFullAccess
        }))
        : API.aiChat(basePayload);

    call.then(res => {
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

/* ─────────── Agent 工具卡片 ───────────
   主进程每步工具调用发来 ai-tool 事件，这里把过程渲染成卡片；
   遇到 confirm 阶段渲染「允许 / 拒绝」，把用户决定回传给主进程。 */

const AI_TOOL_LABEL = {
    read_file: '📖 读取文件',
    list_dir: '📁 列出目录',
    write_file: '✍️ 写入文件',
    run_command: '⌨️ 执行命令'
};

function aiToolArgSummary(name, args) {
    if (name === 'read_file' || name === 'list_dir') return args && args.path ? args.path : '（工作区根）';
    if (name === 'write_file') return args && args.path ? args.path : '（未指定路径）';
    if (name === 'run_command') return args && args.command ? args.command : '（空命令）';
    return '';
}

function aiMakeToolCard(d) {
    /* 工具卡片只在固定的「工具槽」里显示，且永远只保留最新一个：
       每次新建都清空旧卡片（不可恢复），不往对话流里堆。 */
    const box = $('ai-tool-slot');
    if (!box) return null;
    box.textContent = '';
    aiState.toolCards.clear();
    const card = document.createElement('div');
    card.className = 'ai-tool-card';
    card.dataset.state = 'running';
    const head = document.createElement('div');
    head.className = 'ai-tool-head';
    const title = document.createElement('span');
    title.className = 'ai-tool-title';
    title.textContent = AI_TOOL_LABEL[d.name] || ('🔧 ' + d.name);
    const status = document.createElement('span');
    status.className = 'ai-tool-status';
    status.textContent = '执行中…';
    head.appendChild(title); head.appendChild(status);
    const body = document.createElement('div');
    body.className = 'ai-tool-body';
    const arg = document.createElement('div');
    arg.className = 'ai-tool-arg';
    arg.textContent = aiToolArgSummary(d.name, d.args);
    body.appendChild(arg);
    card.appendChild(head); card.appendChild(body);
    box.appendChild(card);
    aiScroll();
    return card;
}

function aiSetToolStatus(card, text, state) {
    if (!card) return;
    const s = card.querySelector('.ai-tool-status');
    if (s) s.textContent = text;
    if (state) { card.dataset.state = state; }
}

function aiToolShowConfirm(card, d) {
    if (!card) return;
    const body = card.querySelector('.ai-tool-body');
    if (!body) return;
    body.textContent = '';
    const pv = d.preview || {};

    if (d.name === 'write_file') {
        const meta = document.createElement('div');
        meta.className = 'ai-tool-meta';
        meta.textContent = (pv.exists ? '将覆盖：' : '将新建：') + (pv.path || '');
        body.appendChild(meta);
        const pre = document.createElement('pre');
        pre.className = 'ai-tool-diff';
        pre.textContent = pv.diff || '';
        body.appendChild(pre);
    } else if (d.name === 'run_command') {
        const meta = document.createElement('div');
        meta.className = 'ai-tool-meta';
        meta.textContent = '工作目录：' + (pv.cwd || '（工作区根）');
        body.appendChild(meta);
        const label = document.createElement('div');
        label.className = 'ai-tool-cmdlabel';
        label.textContent = '命令（可直接修改后运行）：';
        body.appendChild(label);
        const cmd = document.createElement('input');
        cmd.type = 'text';
        cmd.className = 'ai-tool-cmd';
        cmd.value = pv.command || (d.args && d.args.command) || '';
        cmd.spellcheck = false;
        body.appendChild(cmd);
        card.__cmdInput = cmd;
    }

    const actions = document.createElement('div');
    actions.className = 'ai-tool-actions';
    const approve = document.createElement('button');
    approve.className = 'btn btn-primary btn-sm';
    approve.textContent = (d.name === 'run_command') ? '运行 Run' : '允许写入 Accept';
    const deny = document.createElement('button');
    deny.className = 'btn btn-outline btn-sm';
    deny.textContent = '拒绝';
    actions.appendChild(approve); actions.appendChild(deny);
    body.appendChild(actions);

    const decide = (ok) => {
        if (card.dataset.state !== 'confirm') return;
        const edited = (d.name === 'run_command' && card.__cmdInput) ? card.__cmdInput.value : '';
        API.aiToolDecision({ confirmId: d.confirmId, approve: ok, edited: edited });
        aiSetToolStatus(card, ok ? '已允许' : '已拒绝', ok ? 'approved' : 'denied');
        actions.remove();
        if (card.__cmdInput) card.__cmdInput.disabled = true;
    };
    approve.addEventListener('click', () => decide(true));
    deny.addEventListener('click', () => decide(false));

    aiSetToolStatus(card, '待确认', 'confirm');
    aiScroll();
}

function aiToolShowResult(card, d) {
    if (!card) return;
    const body = card.querySelector('.ai-tool-body');
    const r = d.result || {};
    if (d.phase === 'denied') {
        aiSetToolStatus(card, '已拒绝', 'denied');
        return;
    }
    const ok = d.ok !== false && r.ok !== false;
    let detail = '';
    if (d.name === 'read_file') detail = '读取 ' + (r.size || 0) + ' 字节' + (r.truncated ? '（已截断）' : '');
    else if (d.name === 'list_dir') detail = '列出 ' + ((r.items || []).length) + ' 项' + (r.truncated ? '（已截断）' : '');
    else if (d.name === 'write_file') detail = ok ? ('已写入 ' + (r.bytes || 0) + ' 字节') : (r.error || '写入失败');
    else if (d.name === 'run_command') detail = '退出码 ' + r.code + (r.timeout ? '（超时）' : '');
    aiSetToolStatus(card, (ok ? '✓ ' : '✗ ') + detail, ok ? 'ok' : 'err');

    /* 命令输出摘要（成功时显示 stdout / stderr 前若干行） */
    if (d.name === 'run_command' && body) {
        const out = (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '');
        if (out.trim()) {
            const pre = document.createElement('pre');
            pre.className = 'ai-tool-out';
            pre.textContent = out.length > 2000 ? out.slice(0, 2000) + '\n…(已截断)' : out;
            body.appendChild(pre);
            aiScroll();
        }
    }
}

function aiHandleTool(d) {
    if (!d || d.requestId !== aiState.reqId) return;
    if (d.phase === 'done') return;   // 最终答案走 ai-done
    /* 新的工具调用：切换「当前卡片」并清掉上一张（不可恢复） */
    if (d.phase === 'call') {
        aiState.activeToolCallId = d.callId;
        const card = aiMakeToolCard(d);
        if (card) aiState.toolCards.set(d.callId, card);
        return;
    }
    /* confirm / result / denied：只更新当前卡片；已被新调用顶掉的旧事件直接忽略 */
    if (d.callId !== aiState.activeToolCallId) return;
    const card = aiState.toolCards.get(d.callId);
    if (!card) return;
    if (d.phase === 'confirm') aiToolShowConfirm(card, d);
    else if (d.phase === 'result' || d.phase === 'denied') aiToolShowResult(card, d);
}

/* Agent 写文件后：刷新已打开的标签模型，避免编辑器显示旧内容 */
function aiHandleFileWritten(d) {
    if (!d || !d.path) return;
    const t = state.tabs.find(x => x.path === d.path);
    if (t && t.model) {
        API.readFile(d.path).then(r => {
            if (r && r.ok && t.model.getValue() !== r.content) {
                t.model.setValue(r.content);
                renderTabs();
            }
        }).catch(() => {});
    } else if (state.root) {
        renderTree();
    }
}

/* 绝对安全黑名单命中：主进程硬拒绝后推来的警告 */
function aiHandleBlocked(d) {
    if (!d || d.requestId !== aiState.reqId) return;
    const label = {
        catastrophic: '危险命令被拦截',
        traversal: '路径穿越风险被拦截',
        'not-allowed': '命令不在白名单内，已拒绝'
    }[d.kind] || '命令被安全策略拦截';
    const why = d.why || '违反安全策略';
    toast('⛔ ' + label + '：' + why + '\n' + (d.command || ''), 'err', 6500);
    try { logOut('[AI 安全] ' + label + '：' + (d.command || '') + ' —— ' + why, 'err'); } catch (e) {}
}

/* 流式事件与工具事件在脚本加载时就注册，保证不丢 */
API.onAiToken(d => aiHandleToken(d));
API.onAiDone(d => aiHandleDone(d));
API.onAiTool(d => aiHandleTool(d));
API.onAiFileWritten(d => aiHandleFileWritten(d));
API.onAiBlocked(d => aiHandleBlocked(d));

