'use strict';

/* ═══════════════════════════════════════════
   搜索服务
   按内容全局搜索、按文件名模糊查找（Ctrl+P 快速打开）。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { walkFiles } = require('../util/fs-util');

function register() {
    ipcMain.handle('search-text', async (e, payload) => {
        const { root, query, caseSensitive, useRegex, max = 500 } = payload || {};
        if (!root || !query) return { ok: true, results: [], truncated: false };
        const files = walkFiles(root, [], 4000, 0);

        let re;
        if (useRegex) {
            try { re = new RegExp(query, caseSensitive ? 'g' : 'gi'); }
            catch (err) { return { ok: false, error: '正则表达式无效：' + err.message }; }
        } else {
            const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            re = new RegExp(esc, caseSensitive ? 'g' : 'gi');
        }

        const results = [];
        let truncated = false;
        for (const f of files) {
            if (results.length >= max) { truncated = true; break; }
            let text;
            try {
                const st = fs.statSync(f);
                if (st.size > 2 * 1024 * 1024) continue;    // 跳过超大文件
                text = fs.readFileSync(f, 'utf8');
            } catch (err) { continue; }
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                re.lastIndex = 0;
                const m = re.exec(lines[i]);
                if (!m) continue;
                results.push({
                    path: f,
                    name: path.basename(f),
                    rel: path.relative(root, f),
                    line: i + 1,
                    column: m.index + 1,
                    text: lines[i].length > 240 ? lines[i].slice(0, 240) + '…' : lines[i],
                    matchLen: m[0].length || 1,
                    matchStart: m.index
                });
                if (results.length >= max) { truncated = true; break; }
            }
        }
        return { ok: true, results, truncated, scanned: files.length };
    });

    // 在工作区里按文件名模糊查找（快速打开 Ctrl+P）
    ipcMain.handle('search-files', async (e, payload) => {
        const { root, query = '', max = 60 } = payload || {};
        if (!root) return { ok: true, results: [] };
        const files = walkFiles(root, [], 6000, 0);
        const q = String(query).toLowerCase().replace(/\s+/g, '');
        const scored = [];
        for (const f of files) {
            const rel = path.relative(root, f).replace(/\\/g, '/');
            const low = rel.toLowerCase();
            if (!q) { scored.push({ path: f, rel, score: 0 }); continue; }
            // 依次尝试：连续子串 → 顺序字符匹配
            const idx = low.indexOf(q);
            if (idx >= 0) { scored.push({ path: f, rel, score: 1000 - idx }); continue; }
            let pos = 0, hits = 0;
            for (const ch of q) {
                const next = low.indexOf(ch, pos);
                if (next < 0) { hits = -1; break; }
                pos = next + 1; hits++;
            }
            if (hits > 0) scored.push({ path: f, rel, score: hits - rel.length * 0.01 });
        }
        scored.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
        return { ok: true, results: scored.slice(0, max).map(s => ({ path: s.path, rel: s.rel })) };
    });
}

module.exports = { register };
