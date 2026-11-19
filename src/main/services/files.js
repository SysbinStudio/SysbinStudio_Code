'use strict';

/* ═══════════════════════════════════════════
   文件读写服务
   打开 / 保存对话框、文本读写、存在性、体积上限控制。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain, dialog } = require('electron');
const settings = require('../core/settings');
const { isProbablyText } = require('../util/text');
const { formatSize, CODE_FILTERS } = require('../util/fs-util');

const DEFAULT_MAX_FILE_MB = 50;    // 文本文件的默认打开上限
const HARD_MAX_FILE_MB = 1024;     // 硬上限，避免把内存吃爆

/* 上限来自设置；设置里的值再离谱也不会超过硬上限 */
function maxOpenBytes() {
    const s = settings.read();
    const n = Number(s && s.maxFileMB);
    const mb = Number.isFinite(n) && n > 0 ? Math.min(n, HARD_MAX_FILE_MB) : DEFAULT_MAX_FILE_MB;
    return { mb, bytes: Math.round(mb * 1024 * 1024) };
}

function register(ctx) {
    ipcMain.handle('dialog-open-file', async () => {
        const res = await dialog.showOpenDialog(ctx.getWindow(), {
            properties: ['openFile', 'multiSelections'], filters: CODE_FILTERS
        });
        if (res.canceled || !res.filePaths.length) return null;
        return res.filePaths;
    });

    ipcMain.handle('dialog-save-file', async (e, payload) => {
        const res = await dialog.showSaveDialog(ctx.getWindow(), {
            defaultPath: (payload && payload.path) || 'untitled.txt',
            filters: CODE_FILTERS
        });
        if (res.canceled || !res.filePath) return null;
        try {
            fs.writeFileSync(res.filePath, (payload && payload.content) || '', 'utf8');
            return { path: res.filePath };
        } catch (err) { return { error: err.message }; }
    });

    /* 打开文件时区分三种结果：
       ok       — 作为文本交给 Monaco
       isBinary — 二进制，交给十六进制视图（与体积无关，先看格式）
       tooLarge — 是文本但超过上限，提示可调高上限                */
    ipcMain.handle('file-read', async (e, p) => {
        try {
            const st = fs.statSync(p);
            if (st.isDirectory()) return { ok: false, error: '这是一个文件夹，无法作为文件打开' };

            if (!isProbablyText(p)) {
                return {
                    ok: false,
                    isBinary: true,
                    size: st.size,
                    sizeText: formatSize(st.size),
                    error: `这是二进制文件（${formatSize(st.size)}），已改用十六进制视图打开`
                };
            }

            const limit = maxOpenBytes();
            if (st.size > limit.bytes) {
                return {
                    ok: false,
                    tooLarge: true,
                    size: st.size,
                    sizeText: formatSize(st.size),
                    limitMB: limit.mb,
                    error: `文本文件 ${formatSize(st.size)}，超过单文件上限 ${limit.mb} MB`
                };
            }

            return { ok: true, path: p, content: fs.readFileSync(p, 'utf8'), size: st.size, mtime: st.mtimeMs };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('file-write', async (e, payload) => {
        try {
            fs.writeFileSync(payload.path, payload.content || '', 'utf8');
            return { ok: true, path: payload.path, mtime: fs.statSync(payload.path).mtimeMs };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('file-exists', async (e, p) => {
        try {
            return { ok: true, exists: fs.existsSync(p), isDir: fs.existsSync(p) && fs.statSync(p).isDirectory() };
        } catch (err) { return { ok: false, exists: false }; }
    });

    ipcMain.handle('file-stat', async (e, p) => {
        try {
            const st = fs.statSync(p);
            return { ok: true, size: st.size, mtime: st.mtimeMs, isDir: st.isDirectory() };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    // 未保存的新文件先落到临时目录，方便直接运行
    ipcMain.handle('temp-save', async (e, payload) => {
        try {
            const dir = path.join(os.tmpdir(), 'sysbin-sc-run');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, (payload.name || 'main') + '.' + (payload.ext || 'txt'));
            fs.writeFileSync(file, payload.content || '', 'utf8');
            return { ok: true, path: file };
        } catch (err) { return { ok: false, error: err.message }; }
    });
}

module.exports = { register, maxOpenBytes, DEFAULT_MAX_FILE_MB, HARD_MAX_FILE_MB };
