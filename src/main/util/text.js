'use strict';

/* ═══════════════════════════════════════════
   文本 / 编码工具
   无状态函数集合，谁都能 require，不依赖上下文。
   ═══════════════════════════════════════════ */

const fs = require('fs');

/* 终端输出可能是 UTF-8，也可能是 cmd 的 GBK 提示，做智能解码 */
function decodeOut(buf) {
    if (!buf || !buf.length) return '';
    const utf8 = buf.toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8;
    try { return new TextDecoder('gbk').decode(buf); } catch (e) { return utf8; }
}

/* 按扩展名判断为文本的后缀集合（用于目录遍历与二进制探测） */
const TEXT_EXT = new Set([
    'txt', 'md', 'markdown', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'log',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte',
    'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
    'py', 'pyw', 'ipynb', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'groovy',
    'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs', 'swift', 'm', 'mm',
    'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'vbs',
    'sql', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile', 'cmake', 'gradle',
    'lua', 'pl', 'r', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'jl', 'nim', 'zig', 'asm', 's', 'diff', 'patch'
]);

/* 先看扩展名，扩展名不认识就嗅探前 4 KB：含 NUL 视为二进制 */
function isProbablyText(p) {
    const ext = (String(p).split('.').pop() || '').toLowerCase();
    if (TEXT_EXT.has(ext)) return true;
    try {
        const fd = fs.openSync(p, 'r');
        const buf = Buffer.alloc(4096);
        const n = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = { decodeOut, TEXT_EXT, isProbablyText };
