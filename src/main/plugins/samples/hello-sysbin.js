/*
 * 示例插件 —— Hello Sysbin Plugin
 *
 * 用法：
 *   插件页面 → 「从 JS 文件安装…」→ 选中本文件即可。
 *   文件会被复制到 <用户数据目录>/plugins/ 下并立即激活。
 *
 * 一个插件就是一个 CommonJS 模块，导出 { activate, deactivate } 即可。
 * 也可以直接导出一个函数：module.exports = function (api) { ... }
 */

module.exports = {
    id: 'hello-sysbin',
    name: 'Hello 插件示例',
    version: '1.0.0',
    description: '演示插件接口：注册命令、写输出面板、订阅文件打开事件',
    author: 'Sysbin Studio',

    activate(api) {
        api.log('Hello 插件已激活');

        /* 注册命令：出现在命令面板（Ctrl+Shift+P）里 */
        api.registerCommand({
            id: 'hello',
            title: '插件：打个招呼',
            handler: () => {
                api.notify('你好，来自插件的问候 👋', 'ok');
                api.log('命令被执行了');
                return 'done';
            }
        });

        api.registerCommand({
            id: 'whereami',
            title: '插件：显示当前文件路径',
            handler: () => {
                const f = api.editor.activeFile();
                api.notify(f ? '当前文件：' + f : '还没有打开过文件', 'info');
                return f;
            }
        });

        /* 订阅编辑器事件 */
        api.on('file:open', payload => {
            api.log('打开文件：' + ((payload && payload.path) || '?'));
        });

        /* 停用时的清理 */
        api.dispose(() => api.log('Hello 插件即将停用'));
    },

    deactivate() {
        // 命令与事件订阅会自动摘掉，这里只放插件自己的收尾逻辑
    }
};
