/* 示例插件：在代码区标签页里开一个「设置 / 工具」页面，并演示 api.exec。
   安装后在左侧活动栏出现 ⚙ 图标，点击即在代码区打开本页面；
   也可在「插件」侧边栏卡片点「页面：设置面板」打开。

   演示点：
     1) api.registerPage —— 注册页面 + 活动栏图标
     2) api.onPageEvent —— 接收页面内 data-action / data-bind 的交互
     3) api.settings —— 私有配置持久化
     4) api.exec —— 执行 shell 命令（市场已审核，本机信任级别）
*/
module.exports = {
    id: 'plugin-panel',
    name: '插件面板示例',
    version: '1.0.0',
    description: '演示插件页面（设置/工具）与 api.exec 命令执行',
    author: 'Sysbin',
    activate(api) {
        api.log('插件面板示例已激活');

        /* ── 读取已保存的私有配置 ── */
        const cfg = {
            name: api.settings.get('name', ''),
            remind: api.settings.get('remind', true)
        };

        /* ── 注册页面：活动栏会出现一个 ⚙ 图标 ── */
        api.registerPage({
            id: 'panel',
            title: '面板示例 · 设置',
            icon: '⚙',
            html: `
<div class="plug-page">
  <h2>插件面板示例</h2>
  <p>这个页面以「代码区标签页」形式呈现，点左侧 ⚙ 图标即可打开。改动会写入本机 config.json 的 plugins.plugin-panel.config。</p>

  <div class="row">
    <label>你的名字</label>
    <input type="text" data-bind="name" value="${String(cfg.name).replace(/"/g, '&quot;')}" placeholder="随便填" />
  </div>
  <div class="row">
    <label>开启提醒</label>
    <input type="checkbox" data-bind="remind" ${cfg.remind ? 'checked' : ''} />
  </div>

  <div class="row">
    <button class="pg-btn" data-action="save">保存设置</button>
    <button class="pg-btn ghost" data-action="run">运行 git --version</button>
    <button class="pg-btn ghost" data-action="reset">恢复默认</button>
  </div>

  <div class="hint" id="pg-hint">提示会出现在这里。</div>
</div>`
        });

        /* ── 处理页面内的交互事件 ── */
        api.onPageEvent(p => {
            if (p.action === '__bind__') {
                /* data-bind 输入变化：实时存配置 */
                if (p.name === 'name') cfg.name = p.value;
                else if (p.name === 'remind') cfg.remind = (p.value === 'on' || p.value === true || p.value === 'true');
                api.settings.set(p.name, (p.name === 'remind') ? cfg.remind : p.value);
                return;
            }
            if (p.action === 'save') {
                api.settings.set('name', cfg.name);
                api.settings.set('remind', cfg.remind);
                api.notify('设置已保存', 'ok');
            } else if (p.action === 'reset') {
                cfg.name = ''; cfg.remind = true;
                api.settings.set('name', '');
                api.settings.set('remind', true);
                api.notify('已恢复默认', 'info');
            } else if (p.action === 'run') {
                /* api.exec：直接跑一条 shell 命令（市场已审核，本机信任级别） */
                api.notify('正在执行 git --version …', 'info');
                api.exec('git --version').then(r => {
                    if (r.ok) api.notify('git: ' + r.stdout.trim(), 'ok');
                    else api.error('执行失败：' + (r.stderr || r.spawnError));
                });
            }
        });

        /* ── 顺手注册一个命令，命令面板里也能打开页面 ── */
        api.registerCommand({
            id: 'open-panel',
            title: '面板示例：打开设置页面',
            handler: () => api.openPage('panel')
        });

        api.dispose(() => api.log('插件面板示例即将停用'));
    }
};
