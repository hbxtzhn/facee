// FaceE 图标资产生成器 —— 依据 docs/icon-redesign-plan.md 图纸案（§3.1 主案「墨勾落纸」）
//
// 几何（108dp 画布，y 向下，圆心 54,54）：
//   对勾两臂等粗 14dp、方头切口；短臂 15dp（45° 右下），长臂 33dp（40° 右上），短:长 ≈ 1:2.2；
//   挑尖后沿长臂轴线隔 2.5dp 放 9.5dp #2B58DB 实心方块（终端光标）；
//   整体以墨迹包围盒重定中心，并均匀缩放到外向最远 30.5dp（安全圆 33dp 内留余量）。
//   该参数与方案文档实测对齐：墨覆盖 ≈5.8%、蓝块 ≈0.77%、48px 下笔画 ≈5.9px。
//
// 色彩（图纸案）：纸 #F7F6F1(theme surfaceWarm)、墨 #1F2428(theme primary)、
//   光标蓝 #2B58DB(theme 行内代码前景色)、启动图底 #F9F9F6(theme background)。
//
// 产物（§5 表格）：
//   icon.png                     1024²  RGB(colorType 2) 满幅纸底，不透明
//   android-icon-foreground.png  1024²  RGBA 透明底，墨勾 + 蓝光标
//   android-icon-monochrome.png  1024²  RGBA 单色白剪影（无蓝块）
//   splash-icon.png              1024²  RGBA 透明底，墨勾 + 蓝光标
//   favicon.png                   48²   RGBA 满幅纸底
//
// 无第三方依赖：RGBA PNG 编码手写 IHDR/IDAT/IEND + zlib deflate + CRC32。

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crc32 } from '../packages/bank-spec/lib/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');

// ---------- 色彩 ----------
const INK = [31, 36, 40]; // #1F2428
const PAPER = [247, 246, 241]; // #F7F6F1
const BLUE = [43, 88, 219]; // #2B58DB
const WHITE = [255, 255, 255];

// ---------- 几何（dp 空间） ----------
const CANVAS = 108;
const CANVAS_CENTER = 54;
const MAX_RADIUS = 30.5; // 安全圆 33dp 内留 2.5dp 余量

function norm([x, y]) {
  const len = Math.hypot(x, y);
  return [x / len, y / len];
}
function add([ax, ay], [bx, by]) {
  return [ax + bx, ay + by];
}
function sub([ax, ay], [bx, by]) {
  return [ax - bx, ay - by];
}
function mul([x, y], k) {
  return [x * k, y * k];
}
function perp([x, y]) {
  return [-y, x];
}

/** 直线 p+t·d 与直线 q+s·e 的交点 */
function lineIntersect(p, d, q, e) {
  const denom = d[0] * e[1] - d[1] * e[0];
  const dp = [q[0] - p[0], q[1] - p[1]];
  const t = (dp[0] * e[1] - dp[1] * e[0]) / denom;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

function dist([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by);
}

function buildGeometry() {
  const HALF = 7; // 14dp 笔宽
  const V = [45, 66]; // 肘点
  const d1 = norm([1, 1]); // 短臂方向：45° 右下
  const d2 = norm([Math.cos((40 * Math.PI) / 180), -Math.sin((40 * Math.PI) / 180)]); // 长臂方向：40° 右上
  const L1 = 15;
  const L2 = 33; // 短:长 ≈ 1:2.2
  const A = sub(V, mul(d1, L1));
  const B = add(V, mul(d2, L2));
  const n1 = perp(d1);
  const n2 = perp(d2);

  // 对勾 = 单个六边形：短臂外侧角 → 外斜接 → 长臂外侧角 → 长臂内侧角 → 内斜接 → 短臂内侧角。
  // 内外斜接按「离墨迹质心更远者为外」判定，避免手写方向搞反。
  const centroid = mul(add(add(A, V), B), 1 / 3);
  const out1 = lineIntersect(add(A, mul(n1, HALF)), d1, add(V, mul(n2, HALF)), d2);
  const out2 = lineIntersect(sub(A, mul(n1, HALF)), d1, sub(V, mul(n2, HALF)), d2);
  const outerIsFirst = dist(out1, centroid) > dist(out2, centroid);
  const sgn = outerIsFirst ? 1 : -1;
  const Mout = outerIsFirst ? out1 : out2;
  const Min = outerIsFirst ? out2 : out1;
  const Aout = add(A, mul(n1, HALF * sgn));
  const Ain = sub(A, mul(n1, HALF * sgn));
  const Bout = add(B, mul(n2, HALF * sgn));
  const Bin = sub(B, mul(n2, HALF * sgn));
  const checkPoly = [Aout, Mout, Bout, Bin, Min, Ain];

  // 光标方块：挑尖后沿轴线隔 2.5dp，9.5dp 见方（轴对齐）
  const CURSOR = 9.5;
  const GAP = 2.5;
  const cCenter = add(B, mul(d2, GAP + CURSOR / 2));
  const h = CURSOR / 2;
  const cursorQuad = [
    [cCenter[0] - h, cCenter[1] - h],
    [cCenter[0] + h, cCenter[1] - h],
    [cCenter[0] + h, cCenter[1] + h],
    [cCenter[0] - h, cCenter[1] + h],
  ];

  // 重定中心 + 缩放到安全圆内
  const corners = [...checkPoly, ...cursorQuad];
  const cx = corners.reduce((s, [x]) => s + x, 0) / corners.length;
  const cy = corners.reduce((s, [, y]) => s + y, 0) / corners.length;
  const maxDist = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const fit = Math.min(1, MAX_RADIUS / maxDist);
  const place = ([x, y]) => [
    CANVAS_CENTER + (x - cx) * fit,
    CANVAS_CENTER + (y - cy) * fit,
  ];

  return {
    ink: [checkPoly.map(place)],
    cursor: cursorQuad.map(place),
    fit,
  };
}

const GEO = buildGeometry();

// ---------- 光栅化（直接超采样） ----------
// 射线法点包含测试（对勾在肘部内角是凹的，不能用凸多边形判定）
function pointInPoly([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > py !== yj > py;
    if (crosses && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 光栅化一帧。
 * layers: [{ quads, color }] 按顺序合成（后层只在自身覆盖处覆盖前层）。
 * 统一输出 straight-alpha RGBA（opaque 时 alpha=255）；encodePng 负责丢 alpha。
 */
function render(size, layers, { opaque = false, background = null, ss = 3 } = {}) {
  const px = new Uint8Array(size * size * 4);
  const dpPerPx = CANVAS / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 每输出像素取 ss×ss 子样点
      const covers = layers.map(() => 0);
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const dx = ((x + (sx + 0.5) / ss) * dpPerPx);
          const dy = ((y + (sy + 0.5) / ss) * dpPerPx);
          layers.forEach((layer, li) => {
            if (layer.quads.some((poly) => pointInPoly([dx, dy], poly))) covers[li] += 1;
          });
        }
      }
      const total = ss * ss;
      // 自底向上合成
      let r;
      let g;
      let b;
      let a;
      if (opaque) {
        [r, g, b] = background;
        a = 255;
      } else {
        r = 0; g = 0; b = 0; a = 0;
      }
      layers.forEach((layer, li) => {
        const cov = covers[li] / total;
        if (cov <= 0) return;
        const [lr, lg, lb] = layer.color;
        const layerAlpha = layer.alpha ?? 1;
        if (opaque) {
          r = Math.round(lr * cov + r * (1 - cov));
          g = Math.round(lg * cov + g * (1 - cov));
          b = Math.round(lb * cov + b * (1 - cov));
        } else {
          // straight alpha 上叠加（各层互不相交，简化为各自独立）
          const srcA = cov * layerAlpha;
          const outA = srcA + (a / 255) * (1 - srcA);
          if (outA > 0) {
            r = Math.round((lr * srcA + (r * a) / 255 * (1 - srcA)) / outA);
            g = Math.round((lg * srcA + (g * a) / 255 * (1 - srcA)) / outA);
            b = Math.round((lb * srcA + (b * a) / 255 * (1 - srcA)) / outA);
          }
          a = Math.round(outA * 255);
        }
      });
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return px;
}

// ---------- PNG 编码 ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba, { alpha = true }) {
  const bpp = alpha ? 4 : 3;
  const stride = width * bpp + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const si = (y * width + x) * 4;
      const di = y * stride + 1 + x * bpp;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      if (alpha) raw[di + 3] = rgba[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // colorType: RGBA / RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 产物 ----------
const INK_LAYER = { quads: GEO.ink, color: INK };
const BLUE_LAYER = { quads: [GEO.cursor], color: BLUE };
const WHITE_LAYER = { quads: GEO.ink, color: WHITE };

const outputs = [
  { file: 'icon.png', size: 1024, layers: [INK_LAYER, BLUE_LAYER], opaque: true, background: PAPER },
  { file: 'android-icon-foreground.png', size: 1024, layers: [INK_LAYER, BLUE_LAYER] },
  { file: 'splash-icon.png', size: 1024, layers: [INK_LAYER, BLUE_LAYER] },
  { file: 'android-icon-monochrome.png', size: 1024, layers: [WHITE_LAYER] },
  // favicon 保持 RGBA（colorType 6，与现状规格一致），不透明纸底
  { file: 'favicon.png', size: 48, layers: [INK_LAYER, BLUE_LAYER], opaque: true, background: PAPER, ss: 8, keepAlpha: true },
];

for (const { file, size, layers, opaque, background, ss, keepAlpha } of outputs) {
  const rgba = render(size, layers, { opaque, background, ss });
  const png = encodePng(size, size, rgba, { alpha: keepAlpha || !opaque });
  writeFileSync(join(OUT, file), png);
  console.log(`✅ ${file}  ${size}×${size}  ${png.length}B  (缩放系数 ${GEO.fit.toFixed(3)})`);
}
