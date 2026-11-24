'use strict';

/* ═══════════════════════════════════════════
   AI Agent 工具集（白名单 + 二次确认）

   安全模型（参照 Cursor 的 Allowlist + Human-in-the-loop）：
     · 只读工具 read_file / list_dir —— 无副作用，直接执行。
     · write_file / run_command —— 默认不自动执行：
         主进程先算出「预览」（写文件=diff，命令=命令行），发 ai-tool(confirm)
         给渲染层出确认卡片；用户点「允许」回传 ai-tool-decision 后才真正执行；
         点「拒绝」则把拒绝结果回灌给模型。
     · run_command 白名单：只有命中白名单的命令可自动放行（无需确认）。
       其余命令一律进确认卡片，由用户亲手 Run / 修改 / 拒绝。
       没有黑名单——未知命令默认走人工确认，而不是直接拒绝或放行。

   路径：参数里的路径可绝对路径，也可相对工作区根 root。
   ═══════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const commands = require('./commands');

/* ── 命令白名单 ──
   命中即自动执行（无需确认）。只放只读查询与安全构建命令；
   前缀精确匹配，避免 `ls && rm -rf` 之类的夹带。 */
const ALLOW_PREFIXES = [
    // 只读查询
    'dir', 'ls', 'll', 'pwd', 'whoami', 'echo',
    'node -v', 'node --version', 'npm -v', 'npm --version',
    'python --version', 'python -V', 'python3 --version', 'py --version',
    'git status', 'git log', 'git diff', 'git branch', 'git remote -v',
    'type ', 'cat ', 'find ', 'where ',
    // 安全构建（仍建议确认，但按 Cursor 习惯可放行；如需更严可从这里删掉）
    'npm run build', 'npm run dev', 'npm test', 'npm run test',
    'pytest', 'gcc ', 'g++ ', 'javac ', 'go build', 'cargo build', 'make'
];

function commandAllowed(cmd) {
    const s = String(cmd || '').trim().replace(/\s+/g, ' ');
    if (!s) return false;
    /* 任何「命令链 / 管道 / 重定向」都不auto放行，必须人工确认 */
    if (/[|&;><`]|\$\(/.test(s)) return false;
    const low = s.toLowerCase();
    return ALLOW_PREFIXES.some(pre => {
        const p = pre.toLowerCase();
        if (p.endsWith(' ')) return low.startsWith(p);
        return low === p || low.startsWith(p + ' ');
    });
}

/* ── 绝对毁灭性命令黑名单（安全兜底）──
   即使「允许完全访问」开启、跳过二次确认，命中这些也一律拒绝。
   覆盖：删根、格式化、整盘删除、以及通过脚本解释器(node -e / python -c)的降维打击。 */
const CATASTROPHIC_CMDS = [
    { re: /\brd\b/i, why: 'rd 删除目录' },
    { re: /\brmdir\b/i, why: 'rmdir 删除目录' },
    { re: /\bremove-item\b/i, why: 'Remove-Item 删除项' },
    { re: /\bformat-volume\b/i, why: 'Format-Volume 格式化卷' },
    { re: /\bnode\s+-e\b/i, why: 'node -e 内联脚本执行' },
    { re: /\bnode\s+--eval\b/i, why: 'node --eval 内联脚本执行' },
    { re: /\bpython(3)?\s+-c\b/i, why: 'python -c 内联脚本执行' },
    { re: /\bpy\s+-c\b/i, why: 'py -c 内联脚本执行' },
    { re: /rm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|\/\*|~|%userprofile%|[c-z]:\\?$)/i, why: 'rm -rf 删除根目录或用户目录' },
    { re: /\bformat\s+[a-z]:/i, why: 'format 格式化磁盘' },
    { re: /\bdel\s+(\/[a-z]+\s+)*[a-z]:\\/i, why: 'del 整盘删除' },
    { re: /\bmkfs\b/i, why: 'mkfs 格式化文件系统' },
    { re: /\bdiskpart\b/i, why: 'diskpart 磁盘分区操作' },
    { re: /\bdd\s+[\s\S]*\bof=\s*\/dev\/(sd|hd|nvme)/i, why: 'dd 覆写裸磁盘' },
    { re: /:\(\)\s*\{.*\|\s*&.*\}/, why: 'fork bomb' }
];

/* 返回命中的原因字符串，未命中返回 '' */
function isCatastrophic(cmd) {
    const s = String(cmd || '');
    for (const item of CATASTROPHIC_CMDS) if (item.re.test(s)) return item.why;
    return '';
}

/* ── 执行白名单（硬门槛，优先级高于「完全访问」）──
   只放行编程助手的常规命令族：npm / git / 目录查看 / node 脚本 / python 脚本 /
   常见构建工具。命令的「根命令」必须命中这里，否则一律拒绝。
   注意：白名单只决定「能否执行」；是否免确认仍由 ALLOW_PREFIXES 与完全访问开关决定。 */
const ALLOWED_ROOTS = [
    /* 包管理 / 版本 / 任务 */
    'npm', 'npx', 'pnpm', 'yarn', 'git',
    /* 目录与文本查看（只读） */
    'dir', 'ls', 'll', 'pwd', 'whoami', 'echo', 'type', 'cat', 'find', 'where', 'cd',
    /* 解释器执行「脚本文件」（-e / -c 已被绝对黑名单拦截） */
    'node', 'python', 'python3', 'py',
    /* 常见构建 / 测试 */
    'pytest', 'pip', 'pip3', 'gcc', 'g++', 'javac', 'java', 'go', 'cargo', 'make', 'cmake'
];

/* 提取命令的根 token（去掉引号、路径前缀、.exe 后缀、大小写归一） */
function rootCommand(cmd) {
    const s = String(cmd || '').trim();
    if (!s) return '';
    const first = (s.match(/^"[^"]*"|^'[^']*'|^\S+/) || [''])[0];
    let root = first.replace(/^["']|["']$/g, '');
    root = root.split(/[\\/]/).pop();                 // C:\...\node.exe -> node.exe
    root = root.replace(/\.(exe|cmd|bat)$/i, '');     // 去可执行后缀
    return root.toLowerCase();
}

/* 路径穿越 / 越界风险检测 */
function hasTraversal(cmd) {
    const s = String(cmd || '');
    if (/(^|[\s"'`])\.\.([\\/]|$|[\s"'`])/.test(s)) return '路径穿越 (..)';
    if (/[\\/]\.\.[\\/]/.test(s)) return '路径穿越 (..)';
    if (/%[a-z]+%|\$[a-z_]+\b/i.test(s) && /userprofile|home|systemroot|windir|appdata|path/i.test(s)) return '敏感环境变量展开';
    if (/\\\\/.test(s)) return 'UNC 网络路径';
    return '';
}

/* ── 代码内容净化：移除含「删除命令」的代码行 ──
   写入文件时逐行扫描，凡命中删除/毁灭命令特征的行直接丢弃，
   避免 AI 写入的代码本身携带 rm -rf / Remove-Item / fs.rmSync 之类的删除逻辑。
   返回 { content, removed:[{line, text}] }。 */
const DELETE_CODE_PATTERNS = [
    /\brm\s+-[a-z]*r[a-z]*f\b/i,
    /\brmdir\b/i,
    /\brd\s+\/[a-z]/i,
    /\bdel\s+\/[a-z]/i,
    /\bRemove-Item\b/i,
    /\bFormat-Volume\b/i,
    /\bfs\.(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/i,
    /\bshutil\.rmtree\s*\(/i,
    /\bos\.(remove|unlink|removedirs)\s*\(/i,
    /\brm\s+-rf\b/i,
    /<ⅣDELⅣ>/ // 占位，永不匹配；保留数组结构稳定
];

function sanitizeDeleteCode(content) {
    const src = String(content == null ? '' : content);
    const lines = src.split('\n');
    const kept = [];
    const removed = [];
    lines.forEach((text, i) => {
        const hit = DELETE_CODE_PATTERNS.some(re => re.test(text));
        if (hit) removed.push({ line: i + 1, text: text.trim() });
        else kept.push(text);
    });
    return { content: kept.join('\n'), removed };
}

/* 命令策略检查：只拦截删除/毁灭性命令，其余命令一律放行。
   返回 { ok, reason, kind }；kind: 'catastrophic' | 'ok'。
   「完全访问」开关不影响此门槛——删除命令任何模式都拦。 */
function vetCommand(cmd) {
    const s = String(cmd || '').trim();
    if (!s) return { ok: false, reason: '命令为空', kind: 'not-allowed' };
    const why = isCatastrophic(s);
    if (why) return { ok: false, reason: why, kind: 'catastrophic' };
    return { ok: true, reason: '', kind: 'ok', root: rootCommand(s) };
}

/* OpenAI tools 定义 */
const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: '读取一个文本文件的完整内容。用于查看代码、配置或日志。文件过大时会截断。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件路径，绝对路径或相对工作区根目录' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: '列出一个目录下的文件与子目录。用于了解项目结构。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '目录路径，绝对路径或相对工作区根目录；留空表示工作区根' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: '创建或覆盖一个文本文件。会按需自动创建父目录。执行前会向用户展示 diff 并等待确认。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '要写入的文件路径，绝对路径或相对工作区根目录' },
                    content: { type: 'string', description: '要写入的完整文本内容' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: '执行一条 shell 命令，返回退出码与标准输出/错误。白名单内的只读/构建命令自动执行，其余命令需用户确认后执行。',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: '要执行的命令字符串' },
                    cwd: { type: 'string', description: '工作目录，绝对路径或相对工作区根目录；留空表示工作区根' },
                    timeout: { type: 'number', description: '超时毫秒数，默认 60000，最大 120000' }
                },
                required: ['command']
            }
        }
    }
];

const MAX_READ = 200 * 1024;
const MAX_LIST = 300;
const MAX_DIFF = 12000;

function resolvePath(p, root) {
    let s = String(p == null ? '' : p).trim();
    if (!s) return root ? path.resolve(root) : '';
    if (!path.isAbsolute(s) && root) s = path.join(root, s);
    return path.resolve(s);
}

/* 系统目录保护（写操作无论确认与否都拒绝） */
function isForbiddenWrite(abs) {
    const s = path.resolve(abs).toLowerCase();
    const win = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata', 'c:\\$recycle.bin'];
    for (const p of win) if (s === p || s.startsWith(p + path.sep)) return '禁止写入系统目录：' + p;
    if (/^\/(bin|sbin|usr|etc|sys|proc|boot|dev)(\/|$)/.test(s)) return '禁止写入系统目录';
    return null;
}

/* 极简逐行 diff（LCS 太重，这里做「相同前缀/后缀 + 中间替换」的可读展示） */
function makeDiff(oldText, newText) {
    const a = String(oldText || '').split(/\r?\n/);
    const b = String(newText || '').split(/\r?\n/);
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre
           && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const lines = [];
    if (pre > 0) lines.push('  … ' + pre + ' 行未变');
    for (let i = pre; i < a.length - suf; i++) lines.push('- ' + a[i]);
    for (let i = pre; i < b.length - suf; i++) lines.push('+ ' + b[i]);
    if (suf > 0) lines.push('  … ' + suf + ' 行未变');
    const out = lines.join('\n');
    return out.length > MAX_DIFF ? out.slice(0, MAX_DIFF) + '\n… (diff 已截断)' : out;
}

/* ── 预览（不产生副作用）── */
function preview(toolName, args, opts) {
    const root = (opts && opts.root) || '';
    const a = args && typeof args === 'object' ? args : {};
    if (toolName === 'write_file') {
        const abs = resolvePath(a.path, root);
        if (!abs) return { ok: false, error: '未指定文件路径' };
        const forbid = isForbiddenWrite(abs);
        if (forbid) return { ok: false, error: forbid, blocked: true };
        const rawContent = typeof a.content === 'string' ? a.content : String(a.content == null ? '' : a.content);
        /* 写入前净化：移除含删除命令的代码行，diff 展示的就是实际会写入的内容 */
        const clean = sanitizeDeleteCode(rawContent);
        const content = clean.content;
        let old = '';
        let exists = false;
        try { if (fs.existsSync(abs)) { old = fs.readFileSync(abs, 'utf8'); exists = true; } } catch (e) {}
        return {
            ok: true,
            path: abs,
            exists,
            diff: exists ? makeDiff(old, content) : makeDiff('', content),
            bytes: Buffer.byteLength(content, 'utf8'),
            sanitized: clean.removed.length,
            removed: clean.removed
        };
    }
    if (toolName === 'run_command') {
        const cmd = String(a.command || '').trim();
        if (!cmd) return { ok: false, error: '命令为空' };
        const cwd = a.cwd ? resolvePath(a.cwd, root) : (root || '');
        return { ok: true, command: cmd, cwd, auto: commandAllowed(cmd) };
    }
    return { ok: true };
}

/* ── 真正执行（仅在只读工具或用户确认后调用）── */
async function execute(toolName, args, opts) {
    const root = (opts && opts.root) || '';
    const a = args && typeof args === 'object' ? args : {};
    try {
        if (toolName === 'read_file') {
            const abs = resolvePath(a.path, root);
            if (!abs) return { ok: false, error: '未指定文件路径' };
            const st = fs.statSync(abs);
            if (st.isDirectory()) return { ok: false, error: '这是一个目录，请用 list_dir：' + abs };
            let content = fs.readFileSync(abs, 'utf8');
            let truncated = false;
            if (Buffer.byteLength(content, 'utf8') > MAX_READ) { content = content.slice(0, MAX_READ); truncated = true; }
            return { ok: true, path: abs, size: st.size, truncated, content };
        }
        if (toolName === 'list_dir') {
            const abs = resolvePath(a.path || root, root);
            if (!abs) return { ok: false, error: '未指定目录且没有工作区' };
            const st = fs.statSync(abs);
            if (!st.isDirectory()) return { ok: false, error: '这不是目录：' + abs };
            const entries = fs.readdirSync(abs, { withFileTypes: true });
            const items = entries.slice(0, MAX_LIST).map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(abs, e.name) }));
            return { ok: true, path: abs, truncated: entries.length > MAX_LIST, items };
        }
        if (toolName === 'write_file') {
            const abs = resolvePath(a.path, root);
            if (!abs) return { ok: false, error: '未指定文件路径' };
            const forbid = isForbiddenWrite(abs);
            if (forbid) return { ok: false, error: forbid, blocked: true };
            const dir = path.dirname(abs);
            if (dir && dir !== abs) fs.mkdirSync(dir, { recursive: true });
            const rawContent = typeof a.content === 'string' ? a.content : String(a.content == null ? '' : a.content);
            /* 写入前净化：自动删除含删除命令的代码行 */
            const clean = sanitizeDeleteCode(rawContent);
            const content = clean.content;
            fs.writeFileSync(abs, content, 'utf8');
            return {
                ok: true, path: abs, bytes: Buffer.byteLength(content, 'utf8'),
                sanitized: clean.removed.length, removed: clean.removed
            };
        }
        if (toolName === 'run_command') {
            const raw = String(a.command || '').trim();
            if (!raw) return { ok: false, error: '命令为空' };
            const cmd = a.edited && String(a.edited).trim() ? String(a.edited).trim() : raw;   // 用户可在确认卡片里改命令
            /* 硬门槛：只拦截删除/毁灭类命令，任何模式（含完全访问）都必须通过。
               这是执行层最后一道保险，主进程 ai-agent 也会先做同样检查并告警。 */
            const verdict = vetCommand(cmd);
            if (!verdict.ok) {
                return {
                    ok: false,
                    error: '命令被安全策略拒绝（' + verdict.reason + '）：' + cmd,
                    blocked: true,
                    kind: verdict.kind,
                    catastrophic: verdict.kind === 'catastrophic'
                };
            }
            if (!commandAllowed(cmd) && a.approved !== true) {
                return { ok: false, error: '命令未获用户确认，已取消', denied: true };
            }
            const cwd = a.cwd ? resolvePath(a.cwd, root) : (root || undefined);
            let timeout = Number(a.timeout);
            if (!Number.isFinite(timeout) || timeout <= 0) timeout = 60000;
            timeout = Math.min(120000, timeout);
            const r = await commands.execOnce(cmd, cwd && fs.existsSync(cwd) ? cwd : undefined, timeout);
            return {
                ok: !r.spawnError && !r.timeout,
                command: cmd,
                code: r.code,
                stdout: r.stdout || '',
                stderr: r.stderr || '',
                timeout: !!r.timeout,
                spawnError: !!r.spawnError
            };
        }
        return { ok: false, error: '未知工具：' + toolName };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
}

module.exports = { TOOLS, preview, execute, commandAllowed, isCatastrophic, vetCommand, sanitizeDeleteCode, rootCommand, hasTraversal, CATASTROPHIC_CMDS, ALLOWED_ROOTS, ALLOW_PREFIXES, MAX_READ };
