'use strict';

/* ═══════════════════════════════════════════
   文件系统工具
   体积格式化、目录忽略表、文件对话框过滤器、目录遍历。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { isProbablyText } = require('./text');

function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}

/* 目录树与全局搜索都会跳过这些目录 */
const IGNORED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
    '.cache', '__pycache__', '.venv', 'venv', '.idea', '.vscode-test'
]);

/* 打开文件 / 保存文件对话框的后缀过滤器 */
const CODE_FILTERS = [
    {
        name: '代码文件',
        extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'scss', 'json', 'md', 'yaml', 'yml', 'xml',
            'c', 'cpp', 'h', 'java', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'txt']
    },
    { name: '所有文件', extensions: ['*'] }
];

/* 递归收集文本文件；limit 到量即停，避免在大仓库里跑太久 */
function walkFiles(root, results, limit, depth) {
    if (results.length >= limit || depth > 12) return results;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return results; }
    for (const en of entries) {
        if (results.length >= limit) return results;
        const full = path.join(root, en.name);
        if (en.isDirectory()) {
            if (IGNORED_DIRS.has(en.name) || en.name.startsWith('.')) continue;
            walkFiles(full, results, limit, depth + 1);
        } else if (en.isFile() && isProbablyText(full)) {
            results.push(full);
        }
    }
    return results;
}

module.exports = { formatSize, IGNORED_DIRS, CODE_FILTERS, walkFiles };
