'use strict';

/* ═══════════════════════════════════════════
   常驻 PowerShell 集成终端
   一条长期存活的 powershell 进程，逐行把输出推给渲染层；
   空闲时用一条标记命令回问当前目录，用于刷新提示符。
   ═══════════════════════════════════════════ */

const { ipcMain } = require('electron');
const { spawn, spawnSync } = require('child_process');
const { decodeOut } = require('../util/text');

let psProc = null;
let psBuf = Buffer.alloc(0);
let psIdle = null;
let psCwd = null;
let ctxRef = null;

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

function emitShell(text) { if (ctxRef) ctxRef.send('shell-output', text); }
function emitShellStatus(payload) { if (ctxRef) ctxRef.send('shell-status', payload); }

function askCwd() {
    if (!psProc) return;
    try { psProc.stdin.write('Write-Output "__PWD__$((Get-Location).Path)"\n'); } catch (e) {}
}
function scheduleIdle() {
    if (psIdle) clearTimeout(psIdle);
    psIdle = setTimeout(askCwd, 400);
}
function flushPsLines() {
    let idx;
    while ((idx = psBuf.indexOf(0x0A)) >= 0) {
        const lineBuf = psBuf.slice(0, idx);
        psBuf = psBuf.slice(idx + 1);
        let line = decodeOut(lineBuf).replace(/\r$/, '').replace(ANSI_RE, '');
        const m = /^__PWD__(.*)$/.exec(line.trim());
        if (m) { psCwd = m[1].trim(); emitShellStatus({ idle: true, cwd: psCwd }); continue; }
        emitShell(line);
    }
}
function handlePsChunk(chunk) {
    psBuf = Buffer.concat([psBuf, Buffer.from(chunk)]);
    flushPsLines();
    scheduleIdle();
}

// PS 5.1 启动时按控制台代码页初始化编码，故先用 cmd 切到 65001 再启动，
// 这样中英文与子进程（node / python）输出都是 UTF-8。
const PS_ENCODING_SETUP = [
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
    'try { [Console]::InputEncoding  = [System.Text.Encoding]::UTF8 } catch {}',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$PSDefaultParameterValues["*:Encoding"] = "utf8"',
    'chcp 65001 | Out-Null',
    ''
].join('\n');

function startShell(cwd) {
    if (psProc) return { ok: true, reused: true, cwd: psCwd };
    psBuf = Buffer.alloc(0);
    const isWin = process.platform === 'win32';
    const argv = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'];
    try {
        psProc = isWin
            ? spawn('cmd.exe', ['/c', 'chcp 65001 >nul && powershell.exe ' + argv.join(' ')], {
                windowsHide: true, env: process.env, stdio: ['pipe', 'pipe', 'pipe']
            })
            : spawn('powershell', argv, { windowsHide: true, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        psProc = null;
        return { ok: false, error: String((e && e.message) || e) };
    }

    psProc.stdout.on('data', d => handlePsChunk(Buffer.from(d)));
    psProc.stderr.on('data', d => handlePsChunk(Buffer.from(d)));
    psProc.on('error', err => emitShell('[会话错误] ' + String((err && err.message) || err)));
    psProc.on('close', code => {
        flushPsLines();
        if (psBuf.length) { emitShell(decodeOut(psBuf)); psBuf = Buffer.alloc(0); }
        psProc = null;
        emitShell(`[会话已结束，退出码 ${code}]`);
        emitShellStatus({ stopped: true });
    });

    try { psProc.stdin.write(PS_ENCODING_SETUP); } catch (e) {}
    if (cwd) { try { psProc.stdin.write(`Set-Location -LiteralPath "${cwd}"\n`); } catch (e) {} }
    setTimeout(askCwd, 300);
    return { ok: true, cwd: cwd || null };
}

function killShell() {
    if (psIdle) { clearTimeout(psIdle); psIdle = null; }
    if (psProc) {
        const pid = psProc.pid;
        try { psProc.kill(); } catch (e) {}
        // cmd 包装下 powershell 是子进程，必须按进程树结束，否则残留
        if (pid && process.platform === 'win32') {
            try { spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }); } catch (e) {}
        }
        psProc = null;
    }
}

function register(ctx) {
    ctxRef = ctx;

    ipcMain.handle('shell-start', async (e, payload) => startShell(payload && payload.cwd));
    ipcMain.handle('shell-restart', async (e, payload) => { killShell(); return startShell(payload && payload.cwd); });
    ipcMain.handle('shell-stop', async () => { killShell(); emitShellStatus({ stopped: true }); return true; });
    ipcMain.handle('shell-status-now', async () => ({ running: !!psProc, cwd: psCwd }));

    ipcMain.on('shell-input', (e, line) => {
        if (!psProc) startShell(psCwd);
        if (!psProc) { emitShell('[无法启动终端会话]'); return; }
        try { psProc.stdin.write(String(line) + '\n'); } catch (err) { emitShell('[写入失败] ' + err.message); }
        scheduleIdle();
    });
}

/* 退出前收干净，避免 powershell 变孤儿进程 */
function shutdown() { killShell(); }

module.exports = { register, shutdown, startShell, killShell, isRunning: () => !!psProc, cwd: () => psCwd };
