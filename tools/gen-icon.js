/**
 * 按 build/icon.svg 的同一套坐标与配色，程序化渲染多尺寸应用图标。
 * 纯 Node（仅用内置 zlib），不依赖任何外部图像库。
 * 产物：build/icon.png (512) 与 build/icon.ico（含 16/32/48/64/128/256/512）。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ───────── 设计参数（与 icon.svg 完全一致）─────────
const SIZE = 512;          // 主输出尺寸
const SUPER = 4;           // 超采样倍数（抗锯齿）
const R = SIZE * SUPER;    // 渲染分辨率
const RADIUS = 104 * SUPER;

const C0 = [30, 38, 82];   // 顶部渐变 #1E2652
const C1 = [58, 91, 160];  // 底部渐变 #3A5BA0
const WHITE = [245, 248, 255];
const CYAN = [45, 212, 191];

// 线段（输出坐标，渲染时乘 SUPER）。每条：[ax,ay,bx,by,color,width]
const SEGMENTS = [
  [150, 256, 212, 168, WHITE, 34],
  [150, 256, 212, 344, WHITE, 34],
  [362, 256, 300, 168, WHITE, 34],
  [362, 256, 300, 344, WHITE, 34],
  [224, 344, 288, 168, CYAN, 28],
];

function lerp(a, b, t) { return a + (b - a) * t; }

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  let t = (dx === 0 && dy === 0) ? 0 : ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// 对单个输出像素做 SUPER×SUPER 超采样并预乘平均
function renderPixel(ox, oy) {
  let ra = 0, ga = 0, ba = 0, aa = 0;
  for (let sy = 0; sy < SUPER; sy++) {
    for (let sx = 0; sx < SUPER; sx++) {
      const px = (ox * SUPER + sx + 0.5);
      const py = (oy * SUPER + sy + 0.5);
      // 圆角矩形 SDF
      const qx = Math.abs(px - R / 2) - (R / 2 - RADIUS);
      const qy = Math.abs(py - R / 2) - (R / 2 - RADIUS);
      const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
      const outside = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - RADIUS;
      let r, g, b, a;
      if (outside > 0) { r = 0; g = 0; b = 0; a = 0; }
      else {
        const t = py / R;
        r = lerp(C0[0], C1[0], t);
        g = lerp(C0[1], C1[1], t);
        b = lerp(C0[2], C1[2], t);
        a = 1;
        for (const s of SEGMENTS) {
          const d = distToSeg(px, py, s[0] * SUPER, s[1] * SUPER, s[2] * SUPER, s[3] * SUPER);
          if (d <= (s[5] / 2) * SUPER) { r = s[4][0]; g = s[4][1]; b = s[4][2]; a = 1; break; }
        }
      }
      ra += r * a; ga += g * a; ba += b * a; aa += a;
    }
  }
  const n = SUPER * SUPER;
  if (aa <= 0) return [0, 0, 0, 0];
  return [Math.round(ra / aa), Math.round(ga / aa), Math.round(ba / aa), Math.round((aa / n) * 255)];
}

// 渲染主图 (SIZE×SIZE, RGBA)
function renderMaster() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = renderPixel(x, y);
      const i = (y * SIZE + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return buf;
}

// 将主图降采样到指定尺寸（区块平均）
function downscale(src, s) {
  const out = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let ra = 0, ga = 0, ba = 0, aa = 0, cnt = 0;
      const fx0 = x * SIZE / s, fx1 = (x + 1) * SIZE / s;
      const fy0 = y * SIZE / s, fy1 = (y + 1) * SIZE / s;
      for (let sy = Math.floor(fy0); sy < Math.floor(fy1); sy++) {
        for (let sx = Math.floor(fx0); sx < Math.floor(fx1); sx++) {
          const i = (sy * SIZE + sx) * 4;
          const a = src[i + 3] / 255;
          ra += src[i] * a; ga += src[i + 1] * a; ba += src[i + 2] * a; aa += a; cnt++;
        }
      }
      const o = (y * s + x) * 4;
      if (aa > 0) { out[o] = ra / aa; out[o + 1] = ga / aa; out[o + 2] = ba / aa; out[o + 3] = (aa / cnt) * 255; }
    }
  }
  return out;
}

// ───── PNG 编码（真彩+alpha, 8bit, filter 0）─────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ───── 打包 ICO（PNG 嵌入，Vista+ 全支持）─────
function makeICO(pngs) {
  const count = pngs.length;
  const entries = [];
  let offset = 6 + count * 16;
  const parts = [];
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    parts.push(png);
    offset += png.length;
  }
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(count, 4);
  return Buffer.concat([dir, ...entries, ...parts]);
}

// ───── 执行 ─────
const master = renderMaster();
const sizes = [16, 32, 48, 64, 128, 256, 512];
const pngs = sizes.map(s => ({ size: s, png: encodePNG(s, s, s === 512 ? master : downscale(master, s)) }));

fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[pngs.length - 1].png);
fs.writeFileSync(path.join(OUT, 'icon.ico'), makeICO(pngs));
console.log('icon.png + icon.ico 已生成，尺寸：', sizes.join(', '));
