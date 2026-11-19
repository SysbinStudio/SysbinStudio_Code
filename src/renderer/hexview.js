/* ═══════════════════════════════════════════
   3. 十六进制视图
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   十六进制视图（二进制文件）
   按需分块读取 + 虚拟滚动：
   无论文件是 1 MB 还是 172 MB，都只把当前可见的那几十 KB 读进内存。
   ═══════════════════════════════════════════ */

const HEX = {
    path: null,
    size: 0,
    rowH: 19,
    perRow: 16,
    chunk: 65536,          // 与主进程 HEX_CHUNK 保持一致
    chunks: new Map(),     // 块序号 -> hex 字符串
    hitSet: null,          // 搜索命中的字节偏移集合
    hits: [],              // 搜索命中的偏移（有序）
    hitIdx: -1,
    renderQueued: false
};

/* 主区域视图切换：文本走 Monaco，二进制走十六进制视图，插件页面走 #plugin-view。
   注意：侧边栏切换已占用 showView 这个名字，故此处用 showMainView。 */
function showMainView(kind) {
    const isHex = kind === 'hex';
    const isPlugin = kind === 'plugin';
    const isSettings = kind === 'settings';
    el.hexview.classList.toggle('show', isHex);
    const ed = $('editor');
    if (ed) ed.style.display = (isHex || isPlugin || isSettings) ? 'none' : '';
    const pv = $('plugin-view');
    if (pv) pv.classList.toggle('show', isPlugin);
    const sv = $('settings-view');
    if (sv) sv.classList.toggle('show', isSettings);
    if (!isHex && !isPlugin && !isSettings && editor) setTimeout(() => { try { editor.layout(); } catch (e) {} }, 0);
}

/* 浏览器对 scrollHeight 有约 2^25 (33,554,432) px 的硬上限。
   168 MB 文件展开后需要 2.1 亿 px，远超上限 —— 若直接用真实高度，
   滚动条只能覆盖文件前 15%。因此把撑高元素限制在上限内，
   并按比例把 scrollTop 映射回真实行号，这样整个文件都可达。 */
const HEX_MAX_SCROLL_H = 30000000;

function hexScrollMetrics() {
    const rows = Math.ceil(HEX.size / HEX.perRow);
    const needH = rows * HEX.rowH;
    const h = Math.min(needH, HEX_MAX_SCROLL_H);
    return { rows, needH, h, scale: needH > h ? (needH / h) : 1 };
}

/* scrollTop -> 真实起始行（超出上限时按比例换算） */
function hexStartRow() {
    const m = hexScrollMetrics();
    const virtualTop = el.hexBody.scrollTop * m.scale;
    return Math.max(0, Math.floor(virtualTop / HEX.rowH));
}

function hexOpen(p, size) {
    HEX.path = p;
    HEX.size = size || 0;
    HEX.chunks.clear();
    HEX.hits = [];
    HEX.hitSet = null;
    HEX.hitIdx = -1;

    el.hexFile.textContent = baseOf(p);
    el.hexFile.title = p;
    el.hexHits.textContent = '';
    el.hexStatRight.textContent = HEX.size ? fmtSize(HEX.size) + ' · 只读' : '只读';

    el.hexTotal.style.height = hexScrollMetrics().h + 'px';
    el.hexRows.innerHTML = '';
    el.hexBody.scrollTop = 0;

    if (!HEX.size) {
        el.hexStatLeft.textContent = '空文件';
        return;
    }
    // 等一帧让布局稳定，再归零并渲染第 0 行；否则滚动位置会残留上一文件的偏移
    requestAnimationFrame(() => {
        el.hexBody.scrollTop = 0;
        hexRender(0);
    });
}

async function hexEnsureChunk(ci) {
    if (HEX.chunks.has(ci)) return;
    const res = await API.hexRead({ path: HEX.path, offset: ci * HEX.chunk, length: HEX.chunk });
    if (!res || !res.ok) return;
    HEX.chunks.set(ci, res.hex || '');
    if (typeof res.size === 'number' && res.size) HEX.size = res.size;
}

/* 从已缓存的块中取 [off, off+len) 的 hex 串；遇到未加载的块就返回已拥有的部分 */
function hexSlice(off, len) {
    let out = '';
    let cur = off;
    let remain = len;
    while (remain > 0) {
        const ci = Math.floor(cur / HEX.chunk);
        const ch = HEX.chunks.get(ci);
        if (ch === undefined) break;
        const inChunk = cur - ci * HEX.chunk;
        const avail = Math.floor(ch.length / 2) - inChunk;
        if (avail <= 0) break;
        const take = Math.min(remain, avail);
        out += ch.substr(inChunk * 2, take * 2);
        cur += take;
        remain -= take;
    }
    return out;
}

function hexRowHtml(off, hexStr, n) {
    let bytes = '';
    let ascii = '';
    for (let i = 0; i < n; i++) {
        const pair = hexStr.substr(i * 2, 2);
        const b = parseInt(pair, 16);
        let cls = 'hex-b';
        if (b === 0) cls += ' z';
        else if (b >= 32 && b < 127) cls += ' p';
        if (HEX.hitSet && HEX.hitSet.has(off + i)) cls += ' hl';
        bytes += '<span class="' + cls + '">' + pair.toUpperCase() + '</span>';
        ascii += (b >= 32 && b < 127) ? escapeHtml(String.fromCharCode(b)) : '.';
    }
    const offStr = off.toString(16).toUpperCase().padStart(8, '0');
    return '<div class="hex-row"><span class="hex-off">' + offStr + '</span>' +
        '<span class="hex-bytes">' + bytes + '</span>' +
        '<span class="hex-ascii">' + ascii + '</span></div>';
}

async function hexRender(forceRow) {
    if (!HEX.path || !HEX.size) return;
    const body = el.hexBody;
    // forceRow 用于「打开文件」和「偏移跳转」：scrollTop 存在取整/钳制误差，
    // 直接按精确行号渲染可避免首行漂移到文件开头之外。
    const startRow = (forceRow !== undefined && forceRow !== null) ? forceRow : hexStartRow();
    const visible = Math.ceil(body.clientHeight / HEX.rowH) + 2;
    const totalRows = Math.ceil(HEX.size / HEX.perRow);
    const endRow = Math.min(totalRows, startRow + visible);

    // 预取视口覆盖的块，并多取前后各一块，滚动更顺
    const c0 = Math.floor((startRow * HEX.perRow) / HEX.chunk);
    const c1 = Math.floor(Math.max(0, endRow * HEX.perRow - 1) / HEX.chunk);
    for (let c = Math.max(0, c0 - 1); c <= c1 + 1; c++) {
        if (!HEX.chunks.has(c)) await hexEnsureChunk(c);
    }

    let html = '';
    for (let r = startRow; r < endRow; r++) {
        const off = r * HEX.perRow;
        const n = Math.min(HEX.perRow, HEX.size - off);
        if (n <= 0) break;
        const h = hexSlice(off, n);
        if (h.length < n * 2) continue;    // 该块未就绪，跳过
        html += hexRowHtml(off, h, n);
    }

    /* 行内容必须跟随「滚动条位置」而不是真实行号。
       大文件时 scale > 1，真实行号换算出的像素远超滚动条总高，
       用它定位会把内容整体推到可视区之外，表现为往下翻一片空白。 */
    /* 行内容必须跟随「滚动条位置」而不是真实行号。
       大文件时 scale > 1，真实行号换算出的像素远超滚动条总高，
       用它定位会把内容整体推到可视区之外，表现为往下翻一片空白。 */
    el.hexRows.style.transform = 'translateY(' + body.scrollTop + 'px)';
    el.hexRows.innerHTML = html;

    const curByte = startRow * HEX.perRow;
    el.hexStatLeft.textContent = '偏移 0x' + curByte.toString(16).toUpperCase() +
        ' / 0x' + HEX.size.toString(16).toUpperCase() + '  ·  ' + fmtSize(HEX.size);
}

function hexScheduleRender() {
    if (HEX.renderQueued) return;
    HEX.renderQueued = true;
    requestAnimationFrame(() => {
        HEX.renderQueued = false;
        hexRender();
    });
}

function hexGotoOffset(off) {
    if (!HEX.size) return;
    const o = Math.max(0, Math.min(HEX.size - 1, off));
    const row = Math.floor(o / HEX.perRow);
    const m = hexScrollMetrics();
    // 反算 scrollTop：超出滚动上限时按同一比例压缩
    el.hexBody.scrollTop = (row * HEX.rowH) / m.scale;
    // 按精确行渲染，避免 scrollTop 取整导致行号漂移
    hexRender(row);
}

/* 偏移输入：支持十进制、0x 前缀十六进制、纯十六进制 */
function hexParseOffset(s) {
    const t = String(s || '').trim().replace(/[,_\s]/g, '');
    if (!t) return NaN;
    if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
    if (/^[0-9a-fA-F]+$/.test(t) && /[a-fA-F]/.test(t)) return parseInt(t, 16);
    if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
    return NaN;
}

async function hexDoSearch() {
    if (!HEX.path) return;
    const q = el.hexSearch.value.trim();
    if (!q) { toast('请输入要搜索的内容', 'warn'); return; }
    const mode = el.hexSearchMode.value === 'hex' ? 'hex' : 'text';
    el.hexHits.textContent = '搜索中…';

    const res = await API.binSearch({ path: HEX.path, query: q, mode, maxHits: 5000 });
    if (!res || !res.ok) {
        el.hexHits.textContent = '';
        toast('搜索失败：' + (res && res.error ? res.error : '未知错误'), 'err');
        return;
    }

    HEX.hits = res.hits || [];
    HEX.hitSet = new Set();
    const plen = Math.max(1, res.patternLen || 1);
    for (const off of HEX.hits) for (let i = 0; i < plen; i++) HEX.hitSet.add(off + i);
    HEX.hitIdx = HEX.hits.length ? 0 : -1;

    el.hexHits.textContent = HEX.hits.length
        ? HEX.hits.length + ' 处' + (res.truncated ? '（已达上限）' : '')
        : '无匹配';

    if (HEX.hitIdx >= 0) {
        hexGotoOffset(HEX.hits[0]);
        toast('找到 ' + HEX.hits.length + ' 处匹配，已跳转到第一处', 'ok', 2200);
    } else {
        hexScheduleRender();
        toast('未找到匹配内容', 'warn', 2200);
    }
}

function hexDoGoto() {
    const v = hexParseOffset(el.hexGoto.value);
    if (isNaN(v)) { toast('偏移无效，可用十进制或 0x 开头的十六进制', 'warn'); return; }
    if (v >= HEX.size) { toast('偏移超出文件大小（最大 0x' + HEX.size.toString(16).toUpperCase() + '）', 'warn'); return; }
    hexGotoOffset(v);
}

/* ── 提取可读字符串，结果放进一个只读标签页 ── */
async function hexExtractStrings() {
    if (!HEX.path) return;
    const minLen = 4;
    toast('正在扫描字符串…', 'info', 1600);

    const res = await API.binStrings({ path: HEX.path, minLen, maxResults: 20000 });
    if (!res || !res.ok) { toast('提取失败：' + (res && res.error ? res.error : '未知错误'), 'err'); return; }
    if (!res.total) { toast('未找到可读字符串', 'warn', 2400); return; }

    let text = '';
    text += '# 字符串提取结果\n';
    text += '# 文件: ' + HEX.path + '\n';
    text += '# 大小: ' + res.sizeText + '\n';
    text += '# 最小长度: ' + minLen + '\n';
    text += '# 共 ' + res.total + ' 条' + (res.truncated ? '，此处列出前 ' + res.shown + ' 条' : '') + '\n\n';
    for (const h of res.hits) {
        text += '0x' + h.offset.toString(16).toUpperCase().padStart(8, '0') + '  ' + h.text + '\n';
    }

    openResultTab('字符串-' + baseOf(HEX.path) + '.txt', text);
    toast('提取到 ' + res.total + ' 条字符串', 'ok', 2600);
}

/* ── PE 结构解析，结果放进一个只读标签页 ── */
async function hexPeInfo() {
    if (!HEX.path) return;
    const res = await API.peInfo(HEX.path);
    if (!res || !res.ok) {
        toast(res && res.error ? res.error : '无法解析为 PE 文件', 'warn', 2800);
        return;
    }

    let t = '';
    t += '文件        ' + HEX.path + '\n';
    t += '大小        ' + res.sizeText + '\n';
    t += '类型        ' + (res.isDll ? '动态库 (DLL)' : (res.isExe ? '可执行程序 (EXE)' : '映像文件')) + '\n';
    t += '架构        ' + res.bits + ' · ' + res.machine + '\n';
    t += '子系统      ' + res.subsystem + '\n';
    t += '入口点      ' + res.entry + '\n';
    t += '映像基址    ' + res.imageBase + '\n';
    t += '编译时间    ' + res.timeStamp + '\n';
    if (res.exportName) t += '导出名      ' + res.exportName + '\n';

    t += '\n──── 节区 (' + res.sections.length + ') ────\n';
    t += '名称          虚拟地址    虚拟大小    文件偏移    原始大小\n';
    for (const s of res.sections) {
        t += s.name.padEnd(12) + '  ' + s.vaddr.padEnd(11) + '  ' +
            String(s.vsize).padEnd(11) + '  ' + s.rawOff.padEnd(11) + '  ' + s.rawSizeText + '\n';
    }

    t += '\n──── 导入库 (' + res.imports.length + ') ────\n';
    for (const d of res.imports) t += '  ' + d + '\n';

    openResultTab('PE信息-' + baseOf(HEX.path) + '.txt', t);
    toast('PE 信息已生成', 'ok', 2200);
}

/* 只读结果标签页：用于承载字符串 / PE 信息等分析结果 */
function openResultTab(name, content) {
    const uri = monaco.Uri.parse('inmemory://sysbin/result-' + encodeURIComponent(name) + '-' + Date.now());
    const model = monaco.editor.createModel(content, 'plaintext', uri);
    const tab = { path: null, name, lang: 'txt', model, dirty: false, state: null, readonly: true, result: true };
    state.tabs.push(tab);
    activateTab(state.tabs.length - 1);
    return tab;
}

function openHexTab(p, size) {
    const exist = state.tabs.findIndex(t => t.path === p && t.kind === 'hex');
    if (exist >= 0) { activateTab(exist); return exist; }
    const tab = { path: p, name: null, kind: 'hex', size: size || 0, dirty: false, lang: 'bin' };
    state.tabs.push(tab);
    activateTab(state.tabs.length - 1);
    pushRecent(p);
    return state.tabs.length - 1;
}

function bindHex() {
    el.hexBody.addEventListener('scroll', hexScheduleRender);
    window.addEventListener('resize', () => {
        if (el.hexview.classList.contains('show')) hexScheduleRender();
    });
    el.hexBtnSearch.addEventListener('click', hexDoSearch);
    el.hexSearch.addEventListener('keydown', e => { if (e.key === 'Enter') hexDoSearch(); });
    el.hexBtnGoto.addEventListener('click', hexDoGoto);
    el.hexGoto.addEventListener('keydown', e => { if (e.key === 'Enter') hexDoGoto(); });
    el.hexBtnStrings.addEventListener('click', hexExtractStrings);
    el.hexBtnPe.addEventListener('click', hexPeInfo);
}

let untitledSeq = 0;
const UNTITLED_TITLES = {};
