/*
 * Sysbin Studio Code — preload
 * 通过 contextBridge 暴露受控的主进程能力，渲染层不直接接触 Node API。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sysbin', {
    appName: 'Sysbin Studio Code',

    /* Python 内核 */
    invoke: (args) => ipcRenderer.invoke('run-kernel', args),

    /* 文件 */
    openFileDialog: () => ipcRenderer.invoke('dialog-open-file'),
    saveFileDialog: (payload) => ipcRenderer.invoke('dialog-save-file', payload),
    readFile: (p) => ipcRenderer.invoke('file-read', p),
    writeFile: (payload) => ipcRenderer.invoke('file-write', payload),
    fileExists: (p) => ipcRenderer.invoke('file-exists', p),
    fileStat: (p) => ipcRenderer.invoke('file-stat', p),
    tempSave: (payload) => ipcRenderer.invoke('temp-save', payload),

    /* 目录 */
    openFolderDialog: () => ipcRenderer.invoke('dialog-open-folder'),
    readDir: (dir) => ipcRenderer.invoke('read-dir', dir),

    /* 文件操作 */
    createFile: (p) => ipcRenderer.invoke('fs-create-file', p),
    createDir: (p) => ipcRenderer.invoke('fs-create-dir', p),
    renamePath: (payload) => ipcRenderer.invoke('fs-rename', payload),
    deletePath: (p) => ipcRenderer.invoke('fs-delete', p),
    revealPath: (p) => ipcRenderer.invoke('fs-reveal', p),
    openPath: (p) => ipcRenderer.invoke('open-path', p),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    /* 外部打开：take 取走冷启动攒下的路径；
       on 负责后续热启动（二次打开文件、open-file）的增量下发。*/
    takeOpenTargets: () => ipcRenderer.invoke('open-targets-take'),
    onOpenTargets: (cb) => ipcRenderer.on('open-targets', (e, list) => cb(list || [])),

    /* 搜索 */
    searchText: (payload) => ipcRenderer.invoke('search-text', payload),
    searchFiles: (payload) => ipcRenderer.invoke('search-files', payload),

    /* 二进制 / 大文件 */
    hexRead: (payload) => ipcRenderer.invoke('hex-read', payload),
    binStrings: (payload) => ipcRenderer.invoke('bin-strings', payload),
    binSearch: (payload) => ipcRenderer.invoke('bin-search', payload),
    peInfo: (p) => ipcRenderer.invoke('pe-info', p),

    /* 命令执行 */
    runCommand: (payload) => ipcRenderer.invoke('run-command', payload),
    stopCommand: () => ipcRenderer.invoke('stop-command'),

    /* 集成终端 */
    shellStart: (payload) => ipcRenderer.invoke('shell-start', payload),
    shellRestart: (payload) => ipcRenderer.invoke('shell-restart', payload),
    shellStop: () => ipcRenderer.invoke('shell-stop'),
    shellStatus: () => ipcRenderer.invoke('shell-status-now'),
    shellInput: (line) => ipcRenderer.send('shell-input', line),
    onShellOutput: (cb) => ipcRenderer.on('shell-output', (e, text) => cb(text)),
    onShellStatus: (cb) => ipcRenderer.on('shell-status', (e, payload) => cb(payload)),

    /* 插件 */
    pluginsList: () => ipcRenderer.invoke('plugins-list'),
    pluginsCommands: () => ipcRenderer.invoke('plugins-commands'),
    pluginsRunCommand: (payload) => ipcRenderer.invoke('plugins-run-command', payload),
    pluginsInstallLocal: () => ipcRenderer.invoke('plugins-install-local'),
    pluginsInstallPath: (p) => ipcRenderer.invoke('plugins-install-path', p),
    pluginsInstallUrl: (url) => ipcRenderer.invoke('plugins-install-url', url),
    pluginsUninstall: (id) => ipcRenderer.invoke('plugins-uninstall', id),
    pluginsToggle: (payload) => ipcRenderer.invoke('plugins-toggle', payload),
    pluginsReload: (id) => ipcRenderer.invoke('plugins-reload', id),
    pluginsOpenDir: () => ipcRenderer.invoke('plugins-open-dir'),

    /* 插件市场 */
    pluginsMarketFetch: (payload) => ipcRenderer.invoke('plugins-market-fetch', payload),
    pluginsMarketInstall: (payload) => ipcRenderer.invoke('plugins-market-install', payload),
    pluginsOpenUrl: (url) => ipcRenderer.invoke('plugins-open-url', url),

    /* 渲染层 → 插件的事件（file:open / file:save …） */
    pluginsEvent: (name, payload) => ipcRenderer.send('plugins-event', { event: name, payload }),

    /* 插件 → 渲染层 */
    onPluginNotify: (cb) => ipcRenderer.on('plugin-notify', (e, d) => cb(d)),
    onPluginLog: (cb) => ipcRenderer.on('plugin-log', (e, d) => cb(d)),
    onPluginMessage: (cb) => ipcRenderer.on('plugin-message', (e, d) => cb(d)),
    onPluginOpenFile: (cb) => ipcRenderer.on('plugin-open-file', (e, d) => cb(d)),
    onPluginEdit: (cb) => ipcRenderer.on('plugin-edit', (e, d) => cb(d)),
    /* 插件页面内 [data-action]/[data-bind] 的交互事件 → 主进程路由到插件 onPageEvent */
    pluginPageEvent: (d) => ipcRenderer.send('plugin:page-event', d),

    /* 设置与环境 */
    envInfo: () => ipcRenderer.invoke('env-info'),
    setPythonPath: (p) => ipcRenderer.invoke('set-python-path', p),
    testPython: (p) => ipcRenderer.invoke('test-python', p),
    loadSettings: () => ipcRenderer.invoke('settings-load'),
    saveSettings: (data) => ipcRenderer.invoke('settings-save', data),
    resetSettings: () => ipcRenderer.invoke('settings-reset'),

    /* AI 助手：把对话请求转发到主进程（绕开 CSP），支持流式回传 */
    aiChat: (payload) => ipcRenderer.invoke('ai-chat', payload),
    aiAbort: (requestId) => ipcRenderer.send('ai-chat-abort', requestId),
    aiWriteFile: (payload) => ipcRenderer.invoke('ai-write-file', payload),
    onAiToken: (cb) => ipcRenderer.on('ai-token', (e, d) => cb(d)),
    onAiDone: (cb) => ipcRenderer.on('ai-done', (e, d) => cb(d))
});
