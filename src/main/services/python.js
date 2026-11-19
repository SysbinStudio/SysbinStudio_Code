'use strict';

/* ═══════════════════════════════════════════
   Python 内核服务
   解释器探测（内置 → 系统 PATH）+ kernel.py 调用。

   直接 spawn，不用 python-shell：后者未设置 windowsHide，会弹出黑窗。
   ═══════════════════════════════════════════ */

const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const { spawn, spawnSync } = require('child_process');
const paths = require('../core/paths');
const { decodeOut } = require('../util/text');

let customPython = null;
let _pythonPath = null;

/* 打包成 asar 后 Python 读不到包内文件，需指向解包目录 */
function kernelDir() {
    const unpacked = paths.unpackedRoot();
    try {
        return fs.existsSync(path.join(unpacked, 'kernel.py')) ? unpacked : paths.appRoot();
    } catch (e) {
        return paths.appRoot();
    }
}

function bundledPython() {
    try {
        const p = path.join(kernelDir(), 'python', 'python.exe');
        return fs.existsSync(p) ? p : null;
    } catch (e) {
        return null;
    }
}

function pythonWorks(p, needYaml) {
    try {
        const r = spawnSync(p, ['-c', needYaml ? 'import yaml' : 'import sys'], { timeout: 8000, windowsHide: true });
        return r.status === 0;
    } catch (e) {
        return false;
    }
}

function findPython() {
    if (customPython) return customPython;
    const bundled = bundledPython();
    if (bundled) { _pythonPath = bundled; return bundled; }
    if (_pythonPath) return _pythonPath;
    let fallback = null;
    for (const p of ['python', 'python3', 'py']) {
        if (!pythonWorks(p, false)) continue;
        if (pythonWorks(p, true)) { _pythonPath = p; return p; }
        if (!fallback) fallback = p;
    }
    _pythonPath = fallback || 'python';
    return _pythonPath;
}

/* 设置里手动指定解释器时调用；传 null 表示恢复自动探测 */
function setCustomPath(p) {
    customPython = (p && String(p).trim()) || null;
    _pythonPath = null;
    return findPython();
}

function runKernel(argsJson, timeout) {
    return new Promise(resolve => {
        const py = findPython();
        const dir = kernelDir();
        let proc;
        try {
            proc = spawn(py, [path.join(dir, 'kernel.py'), argsJson], {
                cwd: dir, windowsHide: true, env: process.env
            });
        } catch (e) {
            return resolve(JSON.stringify({ error: `Kernel Error: ${(e && e.message) || e}` }));
        }
        const out = [], err = [];
        const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} }, timeout || 30000);
        proc.stdout.on('data', d => out.push(Buffer.from(d)));
        proc.stderr.on('data', d => err.push(Buffer.from(d)));
        proc.on('error', e => {
            clearTimeout(timer);
            resolve(JSON.stringify({ error: `Python execution failed: ${(e && e.message) || e}` }));
        });
        proc.on('close', code => {
            clearTimeout(timer);
            const lines = decodeOut(Buffer.concat(out)).split(/\r?\n/).filter(l => l.trim());
            if (code !== 0 && !lines.length) {
                const t = decodeOut(Buffer.concat(err)).trim();
                return resolve(JSON.stringify({ error: t || `Python 退出码 ${code}` }));
            }
            resolve(lines.length ? lines[lines.length - 1] : '');
        });
    });
}

function register() {
    ipcMain.handle('run-kernel', async (e, args) => {
        try { return await runKernel(JSON.stringify(args), 30000); }
        catch (error) { return JSON.stringify({ error: `Kernel Error: ${error.message}` }); }
    });
}

module.exports = { register, kernelDir, bundledPython, findPython, setCustomPath, runKernel };
