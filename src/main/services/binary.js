'use strict';

/* ══════════════════════════════════════════════════════
   二进制文件支持
   核心原则：绝不把整个文件读进内存。
   所有操作都按块流式处理，172 MB 甚至更大的文件都能秒开。
   ══════════════════════════════════════════════════════ */

const fs = require('fs');
const { ipcMain } = require('electron');
const { formatSize } = require('../util/fs-util');

const HEX_CHUNK = 65536;               // 十六进制视图每次读取的块大小
const SCAN_CHUNK = 4 * 1024 * 1024;    // 扫描类操作每次读取 4 MB

const PE_MACHINE = {
    0x014c: 'x86 (I386)', 0x8664: 'x64 (AMD64)', 0x01c0: 'ARM',
    0x01c4: 'ARM (Thumb-2)', 0xaa64: 'ARM64', 0x0200: 'IA64', 0x0EBC: 'EFI Byte Code'
};
const PE_SUBSYSTEM = {
    0: '未知', 1: 'Native（驱动）', 2: 'GUI（窗口程序）', 3: 'CUI（控制台）',
    5: 'OS/2 CUI', 7: 'POSIX CUI', 9: 'Windows CE', 10: 'EFI 应用',
    14: 'EFI 引导服务驱动', 16: 'Windows 启动应用'
};

function readCStringAt(fd, offset, maxLen) {
    try {
        const buf = Buffer.alloc(maxLen || 256);
        const n = fs.readSync(fd, buf, 0, buf.length, offset);
        let end = buf.indexOf(0);
        if (end < 0) end = n > 0 ? n : 0;
        return buf.slice(0, end).toString('latin1');
    } catch (e) { return ''; }
}

function register() {
    /* ── 十六进制分块读取：只返回请求区间的数据 ── */
    ipcMain.handle('hex-read', async (e, payload) => {
        const p = payload && payload.path;
        if (!p) return { ok: false, error: '缺少路径' };
        try {
            const st = fs.statSync(p);
            if (st.isDirectory()) return { ok: false, error: '这是一个文件夹' };
            const size = st.size;
            const off = Math.max(0, Math.floor(Number(payload.offset) || 0));
            let len = Math.floor(Number(payload.length) || HEX_CHUNK);
            len = Math.min(Math.max(len, 16), HEX_CHUNK * 4);
            if (off >= size) return { ok: true, offset: off, length: 0, size, hex: '' };
            const realLen = Math.min(len, size - off);

            const fd = fs.openSync(p, 'r');
            const buf = Buffer.alloc(realLen);
            const n = fs.readSync(fd, buf, 0, realLen, off);
            fs.closeSync(fd);

            return { ok: true, offset: off, length: n, size, hex: buf.slice(0, n).toString('hex') };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    /* ── 从二进制中流式提取可读字符串 ── */
    ipcMain.handle('bin-strings', async (e, payload) => {
        const p = payload && payload.path;
        if (!p) return { ok: false, error: '缺少路径' };
        const minLen = Math.max(2, Math.min(Number(payload && payload.minLen) || 4, 1024));
        const maxResults = Math.max(1, Math.min(Number(payload && payload.maxResults) || 20000, 200000));
        const utf16 = !!(payload && payload.utf16);

        try {
            const st = fs.statSync(p);
            const fd = fs.openSync(p, 'r');
            const hits = [];
            let total = 0;
            let truncated = false;
            let base = 0;

            // 跨块续接：块尾未终止的字符串留到下块继续
            let cur = '';
            let curStart = 0;

            const flush = () => {
                if (cur.length >= minLen) {
                    total++;
                    if (hits.length < maxResults) hits.push({ offset: curStart, text: cur });
                    else truncated = true;
                }
                cur = '';
            };

            const buf = Buffer.alloc(SCAN_CHUNK);
            let n;
            while ((n = fs.readSync(fd, buf, 0, SCAN_CHUNK, null)) > 0) {
                if (utf16) {
                    // UTF-16LE：低字节可打印且高字节为 0
                    for (let i = 0; i + 1 < n; i += 2) {
                        const lo = buf[i];
                        const hi = buf[i + 1];
                        if (hi === 0 && lo >= 32 && lo < 127) {
                            if (!cur) curStart = base + i;
                            cur += String.fromCharCode(lo);
                        } else flush();
                    }
                } else {
                    for (let i = 0; i < n; i++) {
                        const c = buf[i];
                        if (c >= 32 && c < 127) {
                            if (!cur) curStart = base + i;
                            cur += String.fromCharCode(c);
                        } else flush();
                    }
                }
                base += n;
                if (hits.length >= maxResults) { truncated = true; break; }
            }
            flush();   // 文件末尾收尾
            fs.closeSync(fd);

            return { ok: true, size: st.size, sizeText: formatSize(st.size), total, shown: hits.length, truncated, hits };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    /* ── 在二进制中搜索字节序列 ── */
    ipcMain.handle('bin-search', async (e, payload) => {
        const p = payload && payload.path;
        if (!p) return { ok: false, error: '缺少路径' };
        const q = String((payload && payload.query) || '');
        const mode = (payload && payload.mode) === 'hex' ? 'hex' : 'text';
        if (!q) return { ok: false, error: '搜索内容为空' };

        let pattern;
        try {
            if (mode === 'hex') {
                const clean = q.replace(/[^0-9a-fA-F]/g, '');
                if (clean.length % 2 !== 0) return { ok: false, error: '十六进制长度必须为偶数' };
                pattern = Buffer.from(clean, 'hex');
            } else {
                pattern = Buffer.from(q, 'latin1');
            }
        } catch (err) { return { ok: false, error: '无效的搜索内容' }; }
        if (!pattern.length) return { ok: false, error: '搜索内容为空' };

        const maxHits = Math.max(1, Math.min(Number(payload && payload.maxHits) || 2000, 50000));
        const from = Math.max(0, Math.floor(Number(payload && payload.fromOffset) || 0));

        try {
            const st = fs.statSync(p);
            const fd = fs.openSync(p, 'r');
            const hits = [];
            const overlap = pattern.length - 1;
            let base = from;
            let prevTail = Buffer.alloc(0);
            let truncated = false;

            while (base < st.size) {
                const buf = Buffer.alloc(SCAN_CHUNK);
                const n = fs.readSync(fd, buf, 0, SCAN_CHUNK, base);
                if (n <= 0) break;

                const joined = prevTail.length ? Buffer.concat([prevTail, buf.slice(0, n)]) : buf.slice(0, n);
                let idx = 0;
                while (true) {
                    const at = joined.indexOf(pattern, idx);
                    if (at < 0) break;
                    hits.push(base - prevTail.length + at);
                    idx = at + 1;
                    if (hits.length >= maxHits) break;
                }
                if (hits.length >= maxHits) { truncated = true; break; }

                prevTail = joined.slice(Math.max(0, joined.length - overlap));
                base += n;
                if (n < SCAN_CHUNK) break;
            }
            fs.closeSync(fd);

            return { ok: true, size: st.size, count: hits.length, truncated, hits, patternLen: pattern.length };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    /* ── PE 文件解析：只读头部和节表，与文件体积无关 ── */
    ipcMain.handle('pe-info', async (e, p) => {
        if (!p) return { ok: false, error: '缺少路径' };
        try {
            const st = fs.statSync(p);
            if (st.size < 64) return { ok: false, error: '文件过小，不是有效的 PE 文件' };

            const fd = fs.openSync(p, 'r');
            const head = Buffer.alloc(Math.min(8192, st.size));
            const hn = fs.readSync(fd, head, 0, head.length, 0);

            if (hn < 64 || head.slice(0, 2).toString('latin1') !== 'MZ') {
                fs.closeSync(fd);
                return { ok: false, error: '不是 PE 文件（缺少 MZ 头）' };
            }

            const peOff = head.readUInt32LE(0x3c);
            if (peOff + 24 > hn || head.slice(peOff, peOff + 4).toString('latin1') !== 'PE\0\0') {
                fs.closeSync(fd);
                return { ok: false, error: '不是有效的 PE 文件（PE 签名缺失）' };
            }

            const coff = peOff + 4;
            const machine = head.readUInt16LE(coff);
            const numSec = head.readUInt16LE(coff + 2);
            const timeStamp = head.readUInt32LE(coff + 4);
            const optSize = head.readUInt16LE(coff + 16);
            const chars = head.readUInt16LE(coff + 18);

            const optOff = coff + 20;
            const magic = head.readUInt16LE(optOff);
            const isPlus = magic === 0x20b;
            const entry = head.readUInt32LE(optOff + 16);
            const imageBase = isPlus ? Number(head.readBigUInt64LE(optOff + 24)) : head.readUInt32LE(optOff + 28);
            const subsystem = head.readUInt16LE(optOff + 68);
            const numRvaOff = optOff + (isPlus ? 108 : 92);
            const numRva = numRvaOff + 4 <= hn ? head.readUInt32LE(numRvaOff) : 0;
            const dirOff = optOff + (isPlus ? 112 : 96);

            // 节区表
            const secOff = optOff + optSize;
            const sections = [];
            for (let i = 0; i < numSec; i++) {
                const o = secOff + i * 40;
                if (o + 40 > hn) break;
                sections.push({
                    name: head.slice(o, o + 8).toString('latin1').replace(/\0+$/, ''),
                    vsize: head.readUInt32LE(o + 8),
                    vaddr: head.readUInt32LE(o + 12),
                    rawSize: head.readUInt32LE(o + 16),
                    rawOff: head.readUInt32LE(o + 20),
                    chars: head.readUInt32LE(o + 36)
                });
            }

            // RVA → 文件偏移
            const rva2off = (rva) => {
                for (const s of sections) {
                    if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize)) {
                        return s.rawOff + (rva - s.vaddr);
                    }
                }
                return -1;
            };

            // 导入表（数据目录第 1 项）
            const imports = [];
            if (dirOff + 16 <= hn && numRva > 1) {
                const impRva = head.readUInt32LE(dirOff + 8);
                const impOff = impRva ? rva2off(impRva) : -1;
                if (impOff > 0 && impOff < st.size) {
                    const descs = Buffer.alloc(20 * 256);
                    const dn = fs.readSync(fd, descs, 0, descs.length, impOff);
                    for (let i = 0; i + 20 <= dn; i += 20) {
                        const nameRva = descs.readUInt32LE(i + 12);
                        if (!nameRva) break;
                        const nameOff = rva2off(nameRva);
                        if (nameOff < 0 || nameOff >= st.size) continue;
                        const dll = readCStringAt(fd, nameOff, 256);
                        if (dll) imports.push(dll);
                        if (imports.length >= 256) break;
                    }
                }
            }

            // 导出表（数据目录第 0 项）
            let exportName = '';
            if (dirOff <= hn && numRva > 0) {
                const expRva = head.readUInt32LE(dirOff);
                const expOff = expRva ? rva2off(expRva) : -1;
                if (expOff > 0 && expOff < st.size) {
                    const ed = Buffer.alloc(40);
                    const en = fs.readSync(fd, ed, 0, 40, expOff);
                    if (en >= 40) {
                        const nRva = ed.readUInt32LE(12);
                        const nOff = rva2off(nRva);
                        if (nOff > 0 && nOff < st.size) exportName = readCStringAt(fd, nOff, 256);
                    }
                }
            }

            fs.closeSync(fd);

            const dt = timeStamp ? new Date(timeStamp * 1000) : null;
            return {
                ok: true,
                size: st.size,
                sizeText: formatSize(st.size),
                bits: isPlus ? '64 位' : '32 位',
                machine: PE_MACHINE[machine] || ('未知 (0x' + machine.toString(16) + ')'),
                subsystem: PE_SUBSYSTEM[subsystem] || ('未知 (' + subsystem + ')'),
                entry: '0x' + entry.toString(16).toUpperCase(),
                imageBase: '0x' + imageBase.toString(16).toUpperCase(),
                timeStamp: dt && !isNaN(dt.getTime()) && timeStamp > 0
                    ? dt.toISOString().replace('T', ' ').slice(0, 19)
                    : '未知',
                isDll: !!(chars & 0x2000),
                isExe: !!(chars & 0x0002),
                sections: sections.map(s => ({
                    name: s.name,
                    vsize: s.vsize,
                    vaddr: '0x' + s.vaddr.toString(16).toUpperCase(),
                    rawSize: s.rawSize,
                    rawOff: '0x' + s.rawOff.toString(16).toUpperCase(),
                    rawSizeText: formatSize(s.rawSize)
                })),
                imports,
                exportName
            };
        } catch (err) { return { ok: false, error: err.message }; }
    });
}

module.exports = { register, HEX_CHUNK, SCAN_CHUNK };
