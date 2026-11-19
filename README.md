# Sysbin Studio Code

一个用 **Electron + JavaScript** 编写的轻量级代码编辑器，内置 VS Code 同款的 Monaco 编辑器内核。

## 启动

双击 **`启动 Sysbin Studio Code.bat`**。

> 不要用 `npx electron .` 或在命令行直接跑 —— 当前环境若遗留了
> `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成纯 Node 运行，主进程拿不到
> `app` 对象直接崩溃。上面那个 .bat 会先清空该变量再启动。

需要看渲染层报错时改用 **`调试启动.bat`**。

## 从外部打开文件

安装版（NSIS）已注册 `.js` `.ts` `.json` `.md` `.py` `.txt` 文件关联，可以：

- 在资源管理器里右键 → **打开方式** → Sysbin Studio Code
- 双击已关联的代码文件
- 命令行传参：`Sysbin Studio Code.exe <文件或文件夹>`（可传多个）

单实例生效：应用已开着时再次打开文件，不会新开窗口，而是把文件送进当前窗口。
文件夹参数会作为工作区根打开；不存在的路径会被跳过并提示，不影响其余文件。

> 便携版（portable）不写注册表，因此没有文件关联，需用命令行传参或
> 在应用内用 `Ctrl+O` / `Ctrl+K Ctrl+O` 打开。

## 功能

| 模块 | 说明 |
| --- | --- |
| **编辑器** | Monaco 内核，40+ 语言语法高亮、括号着色、代码折叠、查找替换、多光标 |
| **多标签页** | 未保存标记、中键关闭、右键菜单、Ctrl+Tab 切换 |
| **资源管理器** | 打开文件夹、目录树展开/折叠、新建、重命名、删除（进回收站） |
| **全局搜索** | 按内容搜索（区分大小写 / 正则），跳转定位；Ctrl+P 按文件名模糊匹配 |
| **大纲** | 当前文件的函数 / 类 / 符号列表，点击跳转 |
| **集成终端** | 常驻 PowerShell 会话，UTF-8 中文输出，命令历史（↑↓） |
| **运行代码** | F5 按语言自动拼命令，支持 JS / Python / Go / C++ / Java 等 |
| **代码工具** | JSON 格式化 / 压缩 / 排序，JSON ⇄ YAML ⇄ XML 互转，行数统计 |
| **问题面板** | Python 语法检查，错误可点击跳转 |
| **命令面板** | Ctrl+Shift+P，全部功能可搜索执行 |
| **设置** | 主题、强调色、字号、字体、缩进、自动保存等，持久化到 settings.json |
| **插件** | 侧边栏「插件」页管理已装插件（启用 / 停用 / 重载 / 卸载），「插件市场」页抓取 `https://123pen.cn/ssc/codl/` 目录并一键安装 `.js` |

## 插件

插件就是一个普通的 `.js` 文件（或一个含 `package.json` / `index.js` 的文件夹），
装到 `<用户数据目录>/plugins/` 后由主进程 `require` 加载：

```js
module.exports = {
    id: 'hello-sysbin',
    name: 'Hello 插件示例',
    version: '1.0.0',
    activate(api) {
        api.registerCommand({ id: 'hello', title: '插件：打个招呼', handler: () => api.notify('你好') });
        api.on('file:open', p => api.log('打开 ' + p.path));
    },
    deactivate() {}
};
```

`api` 提供：`log/info/warn/error`、`notify`、`registerCommand`、`on/emit`、
`window.send`、`ipc.handle`、`settings.get/set`、`editor.openFile/insertText/activeFile`、
`shell.run`、`http.get`、`fs/path/os`、`dispose`。

- 安装：插件页「从 JS 文件安装…」选一个 `.js`，或在插件市场里点「安装」
- 位置：`<userData>/plugins/`
- 配置：**编辑器设置与插件设置都保存在「数据目录」下的 `config.json`**，
  编辑器设置在 `app` 段、已装插件与其私有配置在 `plugins` 段；
  旧版的 `settings.json` / `plugins.json` 首次启动会自动迁移进来
- 命令：插件注册的命令会同步到命令面板（Ctrl+Shift+P）
- 示例：`src/main/plugins/samples/hello-sysbin.js`（命令 + 事件）、
  `src/main/plugins/samples/custom-background.js`（**自定义背景**：本地图片 / 纯色，
  可调不透明度与填充方式，重启后仍生效）

详细约定见 `docs/07-插件系统.md`，手把手教程见 `docs/08-插件开发教程.md`。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+Shift+O` | 转到符号 |
| `Ctrl+N` / `Ctrl+O` | 新建 / 打开文件 |
| `Ctrl+K Ctrl+O` | 打开文件夹 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+Shift+F` | 全局搜索 |
| `Ctrl+Shift+E` | 资源管理器 |
| `Ctrl+B` | 切换侧边栏 |
| `` Ctrl+` `` | 切换终端 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 |
| `Ctrl+G` | 转到行 |
| `Shift+Alt+F` | 格式化文档 |
| `F5` | 运行当前文件 |

## 目录结构

```
2.0.1/
├── main.js               主进程入口：只做环境开关 + 装配模块
├── preload.js            contextBridge，向渲染层暴露受控 API
├── kernel.py             Python 内核（纯标准库）
├── src/
│   ├── main/             主进程模块化实现
│   │   ├── index.js      装配入口：注册全部 service
│   │   ├── core/         应用外壳、窗口、设置、共享上下文、常量与路径
│   │   ├── util/         编码 / 文件系统等无状态工具
│   │   ├── services/     文件、工作区、搜索、命令、终端、二进制、Python、环境
│   │   └── plugins/      插件加载器 / 插件 API / 注册表 / 市场 / IPC
│   ├── renderer/         渲染层模块化实现（按加载顺序）
│   │   ├── core.js       语言定义、全局状态、DOM 引用、工具函数
│   │   ├── tabs.js hexview.js editor-io.js explorer.js
│   │   ├── search.js outline.js terminal.js palette.js menus.js
│   │   ├── views.js about.js recent.js tools.js shortcuts.js
│   │   ├── monaco.js     Monaco 加载 / 降级 / boot()
│   │   ├── plugins.js    插件页面与插件市场
│   │   └── boot.js       启动
│   ├── index.html        界面结构
│   ├── style.css         样式（深/浅色主题）
│   └── vendor/monaco     Monaco 编辑器（本地内置，无需联网）
├── python/               随包内置的嵌入式 Python 解释器
├── plugins-test.js       插件系统测试（市场解析 + 安装/命令/启停/卸载）
└── selftest.js           自动化冒烟测试
```

> 渲染层各文件按 `index.html` 里的顺序以普通 `<script>` 加载，共享同一份全局
> 词法作用域（`state` / `el` / `API` / 各工具函数）。因此**不要在顶层初始化里
> 直接引用后面文件才声明的函数**（`COMMANDS`、`MENUS` 里的 `run` / `act`
> 都写成了 `() => fn()` 惰性调用），否则会触发 TDZ 报错。

## 技术要点

- **Monaco 本地内置**：放在 `src/vendor/monaco`，不依赖 CDN。加载失败会自动
  尝试 CDN，两条路都不通时降级为简易 textarea 编辑模式，保证文件仍可编辑保存。
- **编码处理**：终端输出做 UTF-8 / GBK 智能解码；PowerShell 会话启动前切到
  65001 代码页，保证中文不乱码。
- **进程树清理**：终端用 `cmd` 包装 PowerShell，退出时按进程树 `taskkill /t`，
  避免残留进程。
- **安全删除**：删除文件走 `shell.trashItem()` 进回收站，可恢复。

## 自检

```bash
env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe selftest.js
```

会验证：preload API、Monaco 加载、编辑器实例、视图切换、菜单、以及文件读写
（含中文回读）、目录列举、全局搜索、文件名搜索、Python 内核、设置持久化、
终端会话、命令执行。全部通过才打印 `✅ 全部通过`。

插件另有专门的测试（市场目录解析 + 安装 / 命令 / 启停 / 重载 / 卸载）：

```bash
env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe plugins-test.js
```

## 打包

```bash
npm run dist
```

产物在 `dist/`，含免安装版与 NSIS 安装版。
