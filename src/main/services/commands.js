'use strict';

/* ═══════════════════════════════════════════
   单次命令执行
   运行 / 编译用户代码用：起一个 shell 跑完就结束，可超时终止。
   插件的 api.shell.run 也复用这里的 execOnce。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const { decodeOut } = require('../util/text');

let runningProc = null;

function execOnce(command, cwd, timeout) {
    return new Promise(resolve => {
        let settled = false, proc;
        try {
            proc = spawn(command, {
                shell: process.platform === 'win32' ? true : '/bin/bash',
                cwd: cwd || undefined,
                windowsHide: true,
                env: process.env
            });
        } catch (e) {
            return resolve({ code: null, stdout: '', stderr: String((e && e.message) || e), spawnError: true });
        }
        runningProc = proc;
        const out = [], err = [];
        const timer = setTimeout(() => {
            if (settled) return;
            try { proc.kill(); } catch (e) {}
            resolve({
                code: null,
                stdout: decodeOut(Buffer.concat(out)),
                stderr: decodeOut(Buffer.concat(err)) + '\n[执行超时，已终止]',
                timeout: true
            });
        }, timeout);
        const done = r => {
            if (settled) return;
            settled = true; clearTimeout(timer); runningProc = null;
            resolve(r);
        };
        proc.stdout.on('data', d => out.push(Buffer.from(d)));
        proc.stderr.on('data', d => err.push(Buffer.from(d)));
        proc.on('close', code => done({ code, stdout: decodeOut(Buffer.concat(out)), stderr: decodeOut(Buffer.concat(err)) }));
        proc.on('error', e => done({
            code: null,
            stdout: decodeOut(Buffer.concat(out)),
            stderr: String((e && e.message) || e),
            spawnError: true
        }));
    });
}

function register() {
    ipcMain.handle('run-command', async (e, payload) => {
        const cmd = ((payload && payload.cmd) || '').trim();
        if (!cmd) return { code: null, stdout: '', stderr: '命令为空' };
        if (runningProc) return { code: null, stdout: '', stderr: '已有命令正在运行，请先停止' };
        const finalCmd = process.platform === 'win32' ? `chcp 65001 >nul && ${cmd}` : cmd;
        const cwd = payload.cwd && fs.existsSync(payload.cwd) ? payload.cwd : null;
        let result = await execOnce(finalCmd, cwd, payload.timeout || 60000);
        if (result.spawnError && cwd) {
            const altBase = process.platform === 'win32' ? `cd /d "${cwd}" && ${cmd}` : `cd "${cwd}" && ${cmd}`;
            result = await execOnce(process.platform === 'win32' ? `chcp 65001 >nul && ${altBase}` : altBase, null, payload.timeout || 60000);
        }
        return result;
    });

    ipcMain.handle('stop-command', async () => {
        if (!runningProc) return false;
        try { runningProc.kill(); } catch (e) {}
        runningProc = null;
        return true;
    });
}

/* 供插件 API 使用：跑一条命令并返回结果 */
function run(cmd, cwd, timeout) {
    if (runningProc) return Promise.resolve({ code: null, stdout: '', stderr: '已有命令正在运行' });
    return execOnce(cmd, cwd, timeout || 60000);
}

module.exports = { register, execOnce, run };
