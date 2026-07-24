// pointillism-factory.js — 点彩贴图工厂
// makeCloud 渲染逻辑逐字复制自 pointillism/pointillism.js(锁版,一字不改),
// 仅做两处工程化处理:① 改为 ES Module 纯函数导出;② 移除 URL 参数读取(coreType 由调用方传入)
import * as THREE from 'three';

// ---------- 可复现伪随机 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller 标准正态
function gauss2(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const m = Math.sqrt(-2 * Math.log(u));
  const a = 2 * Math.PI * rand();
  return [m * Math.cos(a), m * Math.sin(a)];
}

// ---------- 色板(低饱和) ----------
export const PALETTE = [
  { name: '灰橙', rgb: [201, 141, 94] },
  { name: '雾紫', rgb: [157, 139, 168] },
  { name: '烟青', rgb: [126, 154, 146] },
  { name: '米金', rgb: [217, 192, 138] },
  { name: '砖红', rgb: [163, 74, 53] },
  { name: '灰蓝', rgb: [122, 134, 166] },
];
const ACCENTS = [
  [224, 47, 40],   // 正红
  [39, 174, 96],   // 翠绿
  [37, 87, 214],   // 钴蓝
];
const GOLD = [217, 192, 138];                // 金色砂粒

function rgba(rgb, a) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;
}

// ---------- HSL 工具 ----------
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0, s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [(h + 360) % 360, s, l];
}
function hslToRgb([h, s, l]) {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---------- 单个星系:五层结构,生成一次缓存到离屏 canvas ----------
// L1 核心 0~10%(亮核/焦核/年轮核/无核)| L2 浓彩环 10~30% | L3 混色带 30~55%(子云斑)
// L4 碎彩过渡 55~80%(主色+斑色+金砂细点)| L5 消散晕 80~140%
// 层间分布重叠 + alpha 渐变,无圆环分界;粒径内大外小;半径出界一律丢弃重采
export function makeCloud({ D, main, patches, ringed, coreType, seed, k = 1, maxN = 20000, layers = null }) {
  const rand = mulberry32(seed);
  // 分层导出:dot() 按 currentLayer 过滤,但所有 rand() 照常消耗 → 三层贴图同坐标系严格对齐
  const layerSet = layers ? new Set(layers) : null;
  let currentLayer = '';
  const R = D / 2;
  const half = Math.ceil(R * 1.45 + D * 0.1);  // 晕到 140% + 抖动余量
  const size = half * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(size * k); // 物理分辨率
  const ctx = cv.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';

  const cx = half, cy = half;
  const rc = R * 0.10;                          // 核心半径(10%,实体感)
  const WARM_WHITE = [255, 243, 224];

  const N = Math.min(maxN, Math.max(2500, Math.round(0.085 * D * D)));
  const nL1 = Math.round(N * 0.14);             // 核变大,粒子占比 14%(从 L5 扣)
  const nL2 = Math.round(N * 0.40);             // 浓彩环 40%(从 L5 扣)
  const nL3 = Math.round(N * 0.33);
  const nL4 = Math.round(N * 0.15);
  const nL5 = N - nL1 - nL2 - nL3 - nL4;        // ≈4%

  const lerpC = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];

  const [hMain, , lMain] = rgbToHsl(main);
  const bodySat = 0.7 + rand() * 0.2;                        // 主体饱和度 70~90%
  const richMain = hslToRgb([hMain, Math.min(0.85, bodySat + 0.15), Math.min(0.72, lMain + 0.12)]);
  const haloColor = hslToRgb([hMain, 0.25, lMain * 0.5]);    // 消散晕灰调
  const darkCore = hslToRgb([hMain, 0.3, lMain * 0.16]);     // 焦核(加法混色下的"暗"= 几乎不加光)

  // 硬边方点。x/y 为逻辑坐标,落笔时乘 k 对齐物理像素;s 为物理像素粒径。
  function dot(x, y, s, rgb, a) {
    if (layerSet && !layerSet.has(currentLayer)) return; // 分层过滤(rand 已照常消耗)
    ctx.fillStyle = rgba(rgb, Math.min(a, 0.4)); // 防过曝:单粒 alpha 封顶 0.4
    ctx.fillRect((x * k) | 0, (y * k) | 0, s, s);
  }
  const grain  = () => 1.0 + rand() * 1.0;      // 内层粒径 1.0~2.0 物理px
  const grainS = () => 0.8 + rand() * 0.7;      // 外层更细 0.8~1.5

  // ===== L1 核心(0~10%):亮核/焦核/年轮核/无核 =====
  currentLayer = 'L1';
  const sigmaC = Math.max(1.4, rc / 2.2);
  if (coreType === 'none') {
    // 无核纯粉尘:跳过核心层
  } else if (coreType === 'dark') {
    // 焦核(焦糊不规则暗心):核区随机保留 10~15% 彩色粒子,
    // 边缘判定半径逐粒随机,洞轮廓自然碎
    const nKeep = Math.round(nL1 * (0.10 + rand() * 0.05));
    for (let i = 0; i < nL1; i++) {
      const [gx, gy] = gauss2(rand);
      let x = cx + gx * sigmaC;
      let y = cy + gy * sigmaC;
      const rr = Math.hypot(x - cx, y - cy);
      const inEdge = rr > sigmaC * (0.7 + rand() * 0.8);
      if (i < nKeep) {
        dot(x, y, grain(), richMain, 0.12 + rand() * 0.12);
        continue;
      }
      if (inEdge && rand() < 0.55) continue;   // 边缘随机缺口
      if (inEdge) {
        const [jx, jy] = gauss2(rand);
        x += jx * rc * 0.5;
        y += jy * rc * 0.5;
      }
      dot(x, y, grain(), darkCore, 0.06 + rand() * 0.09);
    }
  } else if (coreType === 'rings') {
    // 年轮核:同心细环,加大抖动 → "隐约可见的纹理"
    const sp = 1.5 + rand() * 1.5;
    for (let i = 0; i < nL1; i++) {
      const [gx, gy] = gauss2(rand);
      let x = cx + gx * sigmaC;
      let y = cy + gy * sigmaC;
      const rr = Math.hypot(x - cx, y - cy);
      const ang = Math.atan2(y - cy, x - cx) + (rand() - 0.5) * 0.1;
      const rq = Math.round(rr / sp) * sp + (rand() - 0.5) * 1.6;
      x = cx + Math.cos(ang) * rq;
      y = cy + Math.sin(ang) * rq;
      dot(x, y, grain(), lerpC(main, WARM_WHITE, 0.55 + rand() * 0.15), 0.15 + rand() * 0.13);
    }
  } else {
    // 暖白亮核(默认):混白 55~70% 保母色,外圈 30% 毛边
    for (let i = 0; i < nL1; i++) {
      const [gx, gy] = gauss2(rand);
      let x = cx + gx * sigmaC;
      let y = cy + gy * sigmaC;
      const rr = Math.hypot(x - cx, y - cy);
      if (rr > 1.55 * sigmaC) {
        const [jx, jy] = gauss2(rand);
        x += jx * rc * 0.45;
        y += jy * rc * 0.45;
      }
      dot(x, y, grain(), lerpC(main, WARM_WHITE, 0.55 + rand() * 0.15), 0.18 + rand() * 0.12);
    }
    // 恒星芯:密集硬点堆(随 rc 等比缩放)
    for (let i = 0; i < 26; i++) {
      const [gx, gy] = gauss2(rand);
      dot(cx + gx * rc * 0.18, cy + gy * rc * 0.18, grain(), lerpC(main, WARM_WHITE, 0.75), 0.25);
    }
  }

  // ===== L2 浓彩环(10~30%):全团密度与饱和度顶点 =====
  currentLayer = 'L2';
  const ringIn = R * 0.10, ringOut = R * 0.30; // 浓彩环紧贴核外
  const ringMid = R * 0.20, ringSig = R * 0.07;
  for (let i = 0; i < nL2; i++) {
    const ang = rand() * Math.PI * 2;
    // 出界不 clamp,丢弃重采(最多 3 次),防止粒子堆积在同一个圆周上
    let rr, ok = false;
    for (let t = 0; t < 3; t++) {
      rr = ringMid + gauss2(rand)[0] * ringSig;
      if (rr >= ringIn * 0.4 && rr <= ringOut * 1.2) { ok = true; break; }
    }
    if (!ok) continue;
    const x = cx + Math.cos(ang) * rr;
    const y = cy + Math.sin(ang) * rr;
    const col = i % 7 === 0 ? hslToRgb([hMain, 0.85, Math.min(0.78, lMain + 0.18)]) : richMain;
    dot(x, y, grain(), col, 0.384 + rand() * 0.288); // 浓彩环必须立起来(×1.6)
  }

  // ===== L3 混色带(30~55%):主色松动 =====
  currentLayer = 'L3';
  const l3In = R * 0.30, l3Out = R * 0.55;
  for (let i = 0; i < nL3; i++) {
    const ang = rand() * Math.PI * 2;
    // 外界同样丢弃重采
    let rr, ok3 = false;
    for (let t = 0; t < 3; t++) {
      rr = l3In + Math.abs(gauss2(rand)[0]) * (l3Out - l3In) * 0.55;
      if (rr <= l3Out * 1.08) { ok3 = true; break; }
    }
    if (!ok3) continue;
    let x = cx + Math.cos(ang) * rr;
    let y = cy + Math.sin(ang) * rr;
    // 年轮纹理(仅 ringed 星系,这一带;抖动加大)
    if (ringed) {
      const sp = 2 + rand() * 2;
      const a2 = ang + (rand() - 0.5) * 0.1;
      const rq = Math.round(rr / sp) * sp + (rand() - 0.5) * 2.2;
      x = cx + Math.cos(a2) * rq;
      y = cy + Math.sin(a2) * rq;
    }
    const t = (rr - l3In) / (l3Out - l3In);                // 0 内 1 外
    const col = hslToRgb([hMain, bodySat, lMain * (1 - 0.35 * t)]);
    const a = (0.315 + rand() * 0.252) * (1 - 0.4 * t);
    dot(x, y, grain(), col, Math.max(0.07, a));
  }

  // ===== 子云(sub-cluster):主云身上的哑光杂色粉斑 =====
  currentLayer = 'SUB';
  // sigma 放宽(subR/1.4)、粒子 500~1200、alpha 低、中心压进 L3 内侧 70% 环带保证浸没主云。
  // 无核、不增密、不发亮 —— 只是主云上一片颜色不同的干粉区域。
  const hueDist = (rgb) => {
    const d = Math.abs(rgbToHsl(rgb)[0] - hMain) % 360;
    return Math.min(d, 360 - d);
  };
  const clashPool = PALETTE.filter((p) => p.rgb !== main && hueDist(p.rgb) >= 120);
  const subClouds = [];
  const nSub = 2 + Math.floor(rand() * 3);
  for (let s = 0; s < nSub; s++) {
    const ang = rand() * Math.PI * 2;
    const dist = l3In + rand() * (l3Out - l3In) * 0.7;     // 压进内侧,浸没主云
    const subR = R * (0.13 + rand() * 0.12);
    const count = 500 + Math.round(rand() * 700);
    let base;
    if (s === 0 && clashPool.length) base = clashPool[Math.floor(rand() * clashPool.length)].rgb; // 撞色
    else base = patches[s % patches.length];
    const [h, , l] = rgbToHsl(base);
    const col = hslToRgb([h, 0.55 + rand() * 0.2, l]);     // 保持高饱和
    const sx = cx + Math.cos(ang) * dist;
    const sy = cy + Math.sin(ang) * dist;
    subClouds.push({ rgb: col });
    for (let i = 0; i < count; i++) {
      const [gx, gy] = gauss2(rand);
      dot(sx + gx * (subR / 1.4), sy + gy * (subR / 1.4), grain(), col, 0.126 + rand() * 0.147);
    }
  }

  // 高饱和点缀(<2%)
  currentLayer = 'ACCENT';
  const nAccent = Math.round(N * 0.015);
  for (let i = 0; i < nAccent; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = l3In + rand() * (l3Out - l3In);
    dot(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr,
      grainS(), ACCENTS[Math.floor(rand() * ACCENTS.length)], 0.1 + rand() * 0.13);
  }

  // ===== L4 碎彩过渡(55~80%):颜色打碎,主色/斑色/金砂细点混杂 =====
  currentLayer = 'L4';
  const l4In = R * 0.55, l4Out = R * 0.8;
  const broken = [
    { rgb: hslToRgb([hMain, bodySat * 0.7, lMain * 0.9]), w: 0.45 },
    ...subClouds.map((c) => ({ rgb: c.rgb, w: 0.35 / subClouds.length })),
    { rgb: GOLD, w: 0.2 },
  ];
  for (let i = 0; i < nL4; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = l4In + rand() * (l4Out - l4In) + (rand() - 0.5) * R * 0.06;
    const x = cx + Math.cos(ang) * rr;
    const y = cy + Math.sin(ang) * rr;
    let pick = rand(), col = broken[0].rgb;
    for (const b of broken) { pick -= b.w; if (pick <= 0) { col = b.rgb; break; } }
    const t = (rr - l4In) / (l4Out - l4In);
    const a = (0.165 + rand() * 0.15) * (1 - 0.5 * t);
    dot(x, y, grainS(), col, Math.max(0.05, a));
  }

  // ===== L5 消散晕(80~140%):灰调粉尘 + 少量金砂,无边界消散 =====
  currentLayer = 'L5';
  for (let i = 0; i < nL5; i++) {
    const ang = rand() * Math.PI * 2;
    // 外界丢弃重采,防止粒子堆在 1.4R 圆周上
    let rr, ok5 = false;
    for (let t = 0; t < 3; t++) {
      rr = R * 0.8 + Math.abs(gauss2(rand)[0]) * R * 0.3;
      if (rr <= R * 1.4) { ok5 = true; break; }
    }
    if (!ok5) continue;
    let x = cx + Math.cos(ang) * rr;
    let y = cy + Math.sin(ang) * rr;
    const [jx, jy] = gauss2(rand);
    const jitter = D * (0.015 + 0.03 * (rr / (R * 1.4)));
    x += jx * jitter;
    y += jy * jitter;
    const col = rand() < 0.15 ? GOLD : haloColor;
    const a = (0.05 + rand() * 0.08) * Math.exp(-(rr - R * 0.8) / (R * 0.4));
    dot(x, y, grainS(), col, Math.max(0.03, a));
  }

  return { canvas: cv, size };
}

// ---------- Three.js 贴图工厂:基准 2048px / 高清 4096px ----------
// size = 目标贴图边长(px);云主体直径 D ≈ size / 1.65(晕占满画布);k = 1(画布即物理像素)
// mipmaps 由 CanvasTexture 默认开启(generateMipmaps + LinearMipmapLinearFilter)
export function makeCloudTexture({ size = 2048, maxN = 20000, ...params }) {
  const D = size / 1.65;
  const cloud = makeCloud({ ...params, D, k: 1, maxN });
  const tex = new THREE.CanvasTexture(cloud.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- 三层贴图:core(L1)/ body(L2+L3+子云+点缀)/ halo(L4+L5) ----------
// 同 seed 同坐标系分层导出,三层叠加 ≡ 完整云
export function makeCloudLayers({ size = 2048, maxN = 20000, ...params }) {
  return {
    core: makeCloudTexture({ ...params, size, maxN, layers: ['L1'] }),
    body: makeCloudTexture({ ...params, size, maxN, layers: ['L2', 'L3', 'SUB', 'ACCENT'] }),
    halo: makeCloudTexture({ ...params, size, maxN, layers: ['L4', 'L5'] }),
  };
}
