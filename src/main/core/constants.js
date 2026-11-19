'use strict';

/* ═══════════════════════════════════════════
   全局常量
   集中放一份，避免同一个地址 / 名字散落在各个模块里，
   改一处忘一处。
   ═══════════════════════════════════════════ */

/* 应用显示名：窗口标题、关于页、env-info 都用它 */
const APP_NAME = 'Sysbin Studio Code';

/* 在线文档。渲染层不能指定任意 URL 让主进程打开，
   只允许白名单里的这一个（见 services/workspace.js）。 */
const DOC_URL = 'https://www.123pen.cn/ssc/docs/';

/* 插件市场：一个静态目录列表页，主进程抓取后解析出可安装的 JS 文件。
   目录不存在（404）时市场页会给出提示而不是崩溃。 */
const MARKET_URL = 'https://123pen.cn/ssc/codl/';

/* 插件加载器只认这些扩展名。
   注意不含 .mjs —— Node 的 require() 无法加载 ESM，会直接抛错。 */
const PLUGIN_EXTENSIONS = ['.js', '.cjs'];

/* 单个插件文件的下载 / 安装体积上限（5 MB）。
   插件是本机可执行文件，限制体积可避免误装巨型文件。 */
const PLUGIN_MAX_BYTES = 5 * 1024 * 1024;

module.exports = {
    APP_NAME,
    DOC_URL,
    MARKET_URL,
    PLUGIN_EXTENSIONS,
    PLUGIN_MAX_BYTES
};
