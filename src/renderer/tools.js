/* ═══════════════════════════════════════════
   14. 代码工具动作
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   14. 代码工具动作
   ═══════════════════════════════════════════ */

async function doJson(mode) {
    const t = activeTab();
    if (!t) { toast('请先打开一个文件', 'warn'); return; }
    await kernelAction({ action: 'json_fmt', raw: t.model.getValue(), mode }, (text) => {
        t.model.setValue(text);
        toast('JSON 已' + (mode === 'minify' ? '压缩' : mode === 'sort' ? '排序' : '格式化'), 'ok', 1600);
    });
}

async function doConvert(src, dst) {
    const t = activeTab();
    if (!t) { toast('请先打开一个文件', 'warn'); return; }
    await kernelAction({ action: 'convert', src, dst, raw: t.model.getValue() }, (text) => {
        const name = t.path ? baseOf(t.path) : t.name;
        const base = name.replace(/\.[^.]+$/, '');
        const newName = base + '.' + (dst === 'yaml' ? 'yaml' : dst);
        const nt = newUntitled(dst === 'yaml' ? 'yaml' : 'json');
        nt.model.setValue(text);
        nt.name = newName;
        renderTabs();
        toast('已转换为 ' + dst.toUpperCase(), 'ok', 1800);
    });
}

async function doStats() {
    const t = activeTab();
    if (!t) { toast('请先打开一个文件', 'warn'); return; }
    const res = await API.invoke({ action: 'stats', raw: t.model.getValue() });
    let p;
    try { p = JSON.parse(res); } catch (e) { toast('统计失败', 'err'); return; }
    if (!p || !p.result) { toast((p && p.error) || '统计失败', 'err'); return; }
    const r = p.result;
    switchPanelView('output');
    togglePanel(true);
    logOut(`── 统计 ${t.path || t.name} ──`, 'info');
    logOut(`总行数：${r.lines}`, null);
    logOut(`代码行：${r.code}`, 'ok');
    logOut(`空行　：${r.blank}`, null);
    logOut(`注释行：${r.comment}`, null);
    logOut(`字符数：${r.chars}`, null);
    logOut(`词数　：${r.words}`, null);
    toast('统计完成，见输出面板', 'ok', 1800);
}
