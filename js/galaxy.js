// galaxy.js — 背景星尘(与点彩统一:硬点、无光晕贴图、禁一切径向渐变)
// 两层深度:远层(慢视差,几乎不动)+ 近层(随相机轻微移动)
// 颜色:70% 暖金 #d9c08a / 20% 暖白 / 10% 随机彩(低饱和)
import * as THREE from 'three';

// 可复现伪随机
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLD = new THREE.Color(217 / 255, 192 / 255, 138 / 255);      // #d9c08a
const WARM_WHITE = new THREE.Color(255 / 255, 246 / 255, 232 / 255);
const ACCENT_POOL = [
  new THREE.Color(0.85, 0.45, 0.38),   // 砖红(降饱和)
  new THREE.Color(0.45, 0.62, 0.55),   // 苔绿
  new THREE.Color(0.48, 0.55, 0.72),   // 雾蓝
  new THREE.Color(0.62, 0.52, 0.68),   // 雾紫
];

function pickColor(rand, brightness) {
  const p = rand();
  let c;
  if (p < 0.7) c = GOLD;
  else if (p < 0.9) c = WARM_WHITE;
  else c = ACCENT_POOL[Math.floor(rand() * ACCENT_POOL.length)];
  return [c.r * brightness, c.g * brightness, c.b * brightness];
}

// 硬点星尘:BufferGeometry + PointsMaterial(无 map → 硬边方点)
function buildHardPoints({ count, seed, size, sizeJitter = 0, place }) {
  const rand = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = place(rand, i);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    // 亮度差异:少数亮星,多数暗星(一级页整体 × 0.8)
    const b = (0.25 + Math.pow(rand(), 2.6) * 0.75) * 0.8;
    const [r, g, bch] = pickColor(rand, b);
    color[i * 3] = r; color[i * 3 + 1] = g; color[i * 3 + 2] = bch;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  const mat = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,          // 恒定屏幕像素尺寸(硬点)
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function createGalaxy(quality) {
  const group = new THREE.Group();
  group.name = 'galaxy';

  // ---------- 远层星尘(慢视差:不随相机动,只极缓自转) ----------
  let farStars = null;
  function buildFar(count) {
    if (farStars) {
      group.remove(farStars);
      farStars.geometry.dispose();
      farStars.material.dispose();
    }
    farStars = buildHardPoints({
      count,
      seed: 20260722,
      size: 1.3,                      // 1~2px 硬点
      place: (rand) => {
        // 远处球壳 400~620
        const r = 400 + rand() * 220;
        const theta = rand() * Math.PI * 2;
        const cosPhi = rand() * 2 - 1;
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        return [r * sinPhi * Math.cos(theta), r * cosPhi, r * sinPhi * Math.sin(theta)];
      },
    });
    farStars.name = 'farStars';
    group.add(farStars);
  }

  // ---------- 近层星尘(随相机轻微移动:漂移 + 回绕) ----------
  let nearStars = null;
  let nearVel = null;
  const NEAR_COUNT = 2200;
  function buildNear() {
    nearVel = new Float32Array(NEAR_COUNT * 3);
    const rand = mulberry32(31337);
    nearStars = buildHardPoints({
      count: NEAR_COUNT,
      seed: 31337,
      size: 1.8,
      place: (r2, i) => {
        const x = (r2() - 0.5) * 120;
        const y = (r2() - 0.5) * 50;
        const z = (r2() - 0.5) * 120;
        nearVel[i * 3] = (r2() - 0.5) * 0.22;
        nearVel[i * 3 + 1] = (r2() - 0.5) * 0.08;
        nearVel[i * 3 + 2] = (r2() - 0.5) * 0.22;
        return [x, y, z];
      },
    });
    nearStars.name = 'nearStars';
    group.add(nearStars);
  }

  // ---------- 尘埃带(硬点,倾斜薄带,给构图一条斜线) ----------
  let dustBand = null;
  function buildDustBand() {
    dustBand = buildHardPoints({
      count: 3200,
      seed: 555444,
      size: 1.2,
      place: (rand) => {
        const a = rand() * Math.PI * 2;
        const rad = 46 + (rand() + rand() - 1) * 20;
        return [
          Math.cos(a) * rad,
          (rand() + rand() - 1) * 2.8,
          Math.sin(a) * rad,
        ];
      },
    });
    dustBand.name = 'dustBand';
    dustBand.rotation.x = 0.42;
    dustBand.rotation.z = -0.18;
    group.add(dustBand);
  }

  const total = quality.starCount || 8000;
  buildFar(Math.max(4000, Math.min(8000, total - NEAR_COUNT)));
  buildNear();
  buildDustBand();

  const api = {
    group,

    // 每帧更新:远层极缓自转,近层漂移回绕(随相机轻微移动感)
    update(dt, elapsed) {
      if (farStars) farStars.rotation.y = elapsed * 0.0016;
      if (dustBand) dustBand.rotation.y = elapsed * 0.002;
      if (nearStars) {
        const pos = nearStars.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          let x = pos.getX(i) + nearVel[i * 3] * dt;
          let y = pos.getY(i) + nearVel[i * 3 + 1] * dt;
          let z = pos.getZ(i) + nearVel[i * 3 + 2] * dt;
          if (x > 60) x = -60; else if (x < -60) x = 60;
          if (y > 25) y = -25; else if (y < -25) y = 25;
          if (z > 60) z = -60; else if (z < -60) z = 60;
          pos.setXYZ(i, x, y, z);
        }
        pos.needsUpdate = true;
      }
    },

    // 星点数量(实时重建远层)
    setStarCount(n) {
      buildFar(Math.max(2000, n - NEAR_COUNT));
    },

    // 星云已整体废弃(点彩气质冲突),保留 API 兼容参数面板
    setNebulaDensity() {},
    setNebulaHue() {},

    // 调试视图:1=仅星尘 0=全部
    setDebugView(v) {
      const showAll = v === 0 || v === 5 || v === 6;
      if (farStars) farStars.visible = showAll || v === 1;
      if (nearStars) nearStars.visible = showAll || v === 1;
      if (dustBand) dustBand.visible = showAll || v === 2;
    },
  };

  return api;
}
