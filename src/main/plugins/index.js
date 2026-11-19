'use strict';

/* ═══════════════════════════════════════════
   插件子系统出口
   对外只需要 register(ctx)：初始化注册表 + 注册插件 IPC。
   ═══════════════════════════════════════════ */

const registry = require('./registry');
const market = require('./market');
const ipc = require('./ipc');

function register(ctx) {
    ipc.register(ctx);
    return registry;
}

module.exports = { register, registry, market };
