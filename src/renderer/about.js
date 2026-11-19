/* ═══════════════════════════════════════════
   12. 关于
   ═══════════════════════════════════════════
   由渲染层单体文件拆分而来。各模块按 index.html 里的顺序加载，
   共享同一份全局词法作用域（state / el / API / 各工具函数）。
   ═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   12. 关于
   ═══════════════════════════════════════════ */

function renderAbout() {
    const e = state.env;
    if (!e) return;
    $('about-ver').textContent = 'v' + e.appVersion;
    const rows = [
        ['开发者', 'SysbinStudio'],
        ['Electron', e.electron], ['Node.js', e.node], ['Chromium', e.chrome], ['V8', e.v8],
        ['系统', `${e.platform} / ${e.arch}`], ['版本', e.osRelease],
        ['Python', e.pythonPath], ['内核来源', e.pythonBundled ? '内置（随包自带）' : '系统'],
        ['程序目录', e.appPath], ['数据目录', e.userData], ['运行方式', e.isPackaged ? '打包运行' : '源码运行']
    ];
    const box = $('about-env');
    box.textContent = '';
    rows.forEach(([k, v]) => {
        const r = document.createElement('div');
        r.className = 'ae-row';
        r.innerHTML = `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v || '-')}</span>`;
        box.appendChild(r);
    });
}
