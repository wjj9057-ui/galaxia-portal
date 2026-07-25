// interior.js — 星球内部层 v3.2:中央立体四芒星 + 大小不一/高低错落的小星系散落四周
// 四芒星构成:① 致密亮心 ② 梭形横盘(任意角度侧看即横向星芒) ③ 梭形纵芒(轴向光柱) ④ 金色亮砂点缀
// 芒的要义:近心丰满明亮,向尖端收细消散(梭形渐变),绝不允许粗细均匀的"坐标轴"感
// 定调:四芒星只作氛围、亮度显著低于五域小星系——行星才是主体
// v3.2:汇聚入场——进入时四芒星粒子从四方奔向既定位置(约2s),随后五域小星系错峰浮现
// 泛光与一级页同参(定稿:强度1.06/半径0.55/阈值0.32),发光感全站一致
import * as THREE from 'three';
import { createGlowSphere } from './planets.js';
import { makeCloudLayers } from './pointillism-factory.js';
import { createPostFX } from './postfx.js';

const NODE_DEFS = [
  { key: 'place', label: '场地' },
  { key: 'story', label: '故事' },
  { key: 'process', label: '流程' },
  { key: 'visual', label: '视觉' },
  { key: 'moment', label: '那一刻' },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createInterior(renderer, camera) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0c10);
  let postfx = null;

  const labelLayer = document.getElementById('labels');
  let labelEls = [];
  let minis = [];
  let ringGroup = null;
  let stardust = null;
  let ringR = 8;
  let open = false;
  let openT = -1;        // 进入后的累计时间(驱动汇聚入场与小星系浮现)
  let clouds = [];       // 四芒星各粒子层的 {attr, start, tgt},供汇聚动画插值
  const INTRO = 2.0;     // 汇聚时长(秒)

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(-2, -2);
  const _v = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  const WARM = { r: 1, g: 243 / 255, b: 224 / 255 };            // 暖白
  const GOLD = { r: 217 / 255, g: 192 / 255, b: 138 / 255 };    // 金砂

  function makePoints(pos, col, size) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size, sizeAttenuation: false, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pts.frustumCulled = false;
    return pts;
  }

  function clear() {
    labelEls.forEach((el) => el.remove());
    labelEls = [];
    minis = [];
    clouds = [];
    openT = -1;
    if (ringGroup) {
      ringGroup.traverse((o) => {
        if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); }
        if (o.isPoints || o.isMesh || o.isLine) { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }
      });
      scene.remove(ringGroup);
      ringGroup = null;
    }
    if (stardust) {
      scene.remove(stardust);
      stardust.geometry.dispose();
      stardust.material.dispose();
      stardust = null;
    }
  }

  const api = {
    scene,
    isOpen: () => open,
    getMinis: () => minis,
    getRingGroup: () => ringGroup,
    getRingR: () => ringR,

    // 进入:立体四芒星 + 散落小星系;机位比 v2 拉近(2.2 → 1.85 倍),整体在画面中更大
    open({ glowBase, radius, seed, fromDir, main, secondary }) {
      clear();
      const rand = mulberry32(seed * 31 + 5);
      const mainC = new THREE.Color(main[0] / 255, main[1] / 255, main[2] / 255);
      const secC = new THREE.Color(secondary[0] / 255, secondary[1] / 255, secondary[2] / 255);

      const spreadR = radius * 30;
      ringR = spreadR;
      ringGroup = new THREE.Group();
      ringGroup.name = 'interior-cluster';
      scene.add(ringGroup);

      // 汇聚入场:粒子层不直接落位,先散在四周的大球壳上,进入后 2s 内奔向目标位置
      function addConvergeCloud(tgt, col, size) {
        const cur = new Float32Array(tgt.length);
        const start = new Float32Array(tgt.length);
        for (let j = 0; j < tgt.length; j += 3) {
          const th = rand() * Math.PI * 2;
          const cp = rand() * 2 - 1;
          const sp = Math.sqrt(1 - cp * cp);
          const rr = spreadR * (1.6 + rand() * 1.6);
          start[j] = rr * sp * Math.cos(th);
          start[j + 1] = rr * cp * 0.8;
          start[j + 2] = rr * sp * Math.sin(th);
          cur[j] = start[j]; cur[j + 1] = start[j + 1]; cur[j + 2] = start[j + 2];
        }
        const pts = makePoints(cur, col, size);
        ringGroup.add(pts);
        clouds.push({ attr: pts.geometry.attributes.position, start, tgt });
      }

      // 三段配色:t=0 心(暖白/金) → t=1 芒尖(主色/辅色)
      function armColor(t, r) {
        const pick = r();
        let c;
        if (pick < 0.5 - t * 0.42) c = WARM;
        else if (pick < 0.78 - t * 0.3) c = GOLD;
        else if (pick < 0.92) c = mainC;
        else c = secC;
        return c;
      }

      // ---------- 背景星尘(静止;亮度 × 0.7,15% 染主色暗调) ----------
      {
        const N = 1500;
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          const r = 30 + rand() * 46;
          const th = rand() * Math.PI * 2;
          const cp = rand() * 2 - 1;
          const sp = Math.sqrt(1 - cp * cp);
          pos[i * 3] = r * sp * Math.cos(th);
          pos[i * 3 + 1] = r * cp;
          pos[i * 3 + 2] = r * sp * Math.sin(th);
          const b = (0.25 + Math.pow(rand(), 2.6) * 0.75) * 0.7;
          let c;
          if (rand() < 0.15) c = [mainC.r * 0.35, mainC.g * 0.35, mainC.b * 0.35];
          else if (rand() < 0.75) c = [0.85 * b, 0.75 * b, 0.54 * b];
          else c = [b, 0.96 * b, 0.9 * b];
          col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        }
        stardust = makePoints(pos, col, 1.4);
        scene.add(stardust);
      }

      // ---------- ① 致密亮心:四芒星的心脏(亮度较 v3 回落,避免糊成白饼) ----------
      {
        const N = 1500;
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        const sigma = spreadR * 0.1;
        for (let i = 0; i < N; i++) {
          const gx = (rand() + rand() + rand() + rand() - 2) / 2;
          const gy = (rand() + rand() + rand() + rand() - 2) / 2;
          const gz = (rand() + rand() + rand() + rand() - 2) / 2;
          const x = gx * sigma, y = gy * sigma * 0.75, z = gz * sigma;
          pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
          const rr = Math.sqrt(x * x + y * y + z * z);
          const t = Math.min(1, rr / (sigma * 2.1));
          // 四芒星是氛围不是主体:亮度大幅低于五域小星系
          const c = armColor(t * 0.8, rand);
          const b = (1 - t * 0.7) * (0.1 + rand() * 0.09);
          col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
        }
        addConvergeCloud(pos, col, 1.5);
      }

      // ---------- ② 梭形横盘:近心厚而亮,向盘缘收细消散(侧看即横向星芒) ----------
      {
        const N = 5200;
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        const armR = spreadR * 1.05;
        for (let i = 0; i < N; i++) {
          const a = rand() * Math.PI * 2;
          const rr = armR * Math.pow(rand(), 1.9);            // 密度更强地向心聚拢
          const t = rr / armR;                                 // 0 心 → 1 尖
          const thick = spreadR * (0.008 + 0.1 * Math.pow(1 - t, 1.9)); // 梭形:中段厚、盘缘急收
          const y = ((rand() + rand() + rand()) / 1.5 - 1) * thick;
          pos[i * 3] = Math.cos(a) * rr;
          pos[i * 3 + 1] = y;
          pos[i * 3 + 2] = Math.sin(a) * rr;
          const c = armColor(t, rand);
          const b = Math.pow(1 - t, 1.7) * (0.09 + rand() * 0.11) + 0.01;
          col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
        }
        addConvergeCloud(pos, col, 1.35);
      }

      // ---------- ③ 梭形纵芒:上下两道光柱,中段丰满、向尖端急剧收细消散 ----------
      {
        const N = 2200;
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        const armH = spreadR * 0.72;
        for (let i = 0; i < N; i++) {
          const sign = rand() < 0.5 ? -1 : 1;
          const yy = armH * Math.pow(rand(), 2.1) * sign;      // 密度强烈向心聚拢,尖端只剩零星
          const t = Math.abs(yy) / armH;
          const thick = spreadR * (0.006 + 0.105 * Math.pow(1 - t, 2.2)); // 梭形:中段明显粗、尖端针细
          pos[i * 3] = ((rand() + rand() - 1)) * thick;
          pos[i * 3 + 1] = yy;
          pos[i * 3 + 2] = ((rand() + rand() - 1)) * thick;
          const c = armColor(t, rand);
          const b = Math.pow(1 - t, 2.0) * (0.11 + rand() * 0.13) + 0.008;
          col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
        }
        addConvergeCloud(pos, col, 1.45);
      }

      // ---------- ④ 金色亮砂:横盘与纵芒上零星的高亮颗粒,提"星屑"质感 ----------
      // 减量、调暗、散开(尤其纵芒上的横向抖动加大),避免在光柱上结成生硬的亮块
      {
        const N = 360;
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        const armR = spreadR * 1.0;
        for (let i = 0; i < N; i++) {
          const onDisc = rand() < 0.78;
          if (onDisc) {
            const a = rand() * Math.PI * 2;
            const rr = armR * Math.pow(rand(), 1.4);
            pos[i * 3] = Math.cos(a) * rr;
            pos[i * 3 + 1] = ((rand() + rand() - 1)) * spreadR * 0.05 * (1 - rr / armR);
            pos[i * 3 + 2] = Math.sin(a) * rr;
          } else {
            const yy = spreadR * 0.58 * Math.pow(rand(), 1.9) * (rand() < 0.5 ? -1 : 1);
            const jit = spreadR * 0.035 * (1 - Math.abs(yy) / (spreadR * 0.58));
            pos[i * 3] = ((rand() + rand() - 1)) * jit;
            pos[i * 3 + 1] = yy;
            pos[i * 3 + 2] = ((rand() + rand() - 1)) * jit;
          }
          const b = 0.21 + rand() * 0.13;
          const c = rand() < 0.7 ? GOLD : WARM;
          col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
        }
        addConvergeCloud(pos, col, 1.6);
      }

      // ---------- ⑤ 五个五域小星系:大小差约 3 倍,距离/高度立体错落 ----------
      const baseD = spreadR * 0.5;
      NODE_DEFS.forEach((def, i) => {
        const ang = (i / NODE_DEFS.length) * Math.PI * 2 + (rand() - 0.5) * 0.7;
        const dist = spreadR * (0.55 + rand() * 0.7);         // 0.55 ~ 1.25 spreadR
        const D = baseD * (0.5 + rand() * 1.1);               // 大小差可达 ~3.2 倍
        const R = D / 2;
        const haloSize = D * 1.65;
        const yOff = (rand() - 0.5) * spreadR * 0.9;          // 高低错落 ±0.45 spreadR

        const layers = makeCloudLayers({
          main,
          patches: [i % 2 === 0 ? secondary : main],
          ringed: rand() < 0.3,
          coreType: 'none',
          seed: seed + i * 77 + 13,
          size: 1024,
          maxN: 9000,
        });

        const g = new THREE.Group();
        g.position.set(Math.cos(ang) * dist, yOff, Math.sin(ang) * dist);

        function layerSprite(tex, colorMul) {
          const mat = new THREE.SpriteMaterial({
            map: tex, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          mat.color.setScalar(colorMul);
          const sp = new THREE.Sprite(mat);
          sp.scale.set(haloSize, haloSize, 1);
          return sp;
        }
        // 亮度压到一级页"飞近星球"档以下再降两成(body 0.8 / halo 0.6),二级页整体走暗调
        const bodySp = layerSprite(layers.body, 0.8);
        const haloSp = layerSprite(layers.halo, 0.6);
        g.add(bodySp, haloSp);

        // 小发光核:主色向暖白混 45%,亮度压到一级页呼吸档均值,阈值 0.32 下与一级页同款泛光
        const miniGlow = new THREE.Color(main[0] / 255, main[1] / 255, main[2] / 255)
          .lerp(new THREE.Color(1, 243 / 255, 224 / 255), 0.45);
        const core = createGlowSphere(miniGlow, R * 0.1);
        core.material.uniforms.uMul.value = 0.55;
        g.add(core);

        const proxy = new THREE.Mesh(
          new THREE.SphereGeometry(R * 0.6, 10, 8),
          new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, side: THREE.DoubleSide })
        );
        proxy.userData.nodeIndex = i;
        g.add(proxy);

        ringGroup.add(g);

        const el = document.createElement('div');
        el.className = 'planet-label node-label';
        el.textContent = def.label;
        labelLayer.appendChild(el);
        labelEls.push(el);

        minis.push({
          def, g, bodySp, haloSp, core, proxy,
          D, R, haloSize,
          rotDir: rand() < 0.5 ? -1 : 1,
          hoverT: 0, hoveredNode: false,
        });
      });

      // 相机:近全景,整体明显放大(v2 的 2.2 倍 → 1.85 倍);俯角压到 8°,
      // 让横盘接近侧视、读成横向星芒,与纵芒合成四芒星(参考图式)
      const elev = THREE.MathUtils.degToRad(8);
      const dist = spreadR * 1.85;
      const flat = _dir.copy(fromDir).setY(0).normalize();
      camera.position.set(flat.x * dist * Math.cos(elev), dist * Math.sin(elev), flat.z * dist * Math.cos(elev));
      camera.lookAt(0, 0, 0);

      if (!postfx) {
        postfx = createPostFX(renderer, scene, camera, { bloomScale: 0.6 });
        // 与一级页定稿参数完全一致(卷的最终审美决定):发光感全站统一
        postfx.setBloom({ strength: 1.06, radius: 0.55, threshold: 0.32 });
        postfx.setGrade({ vignette: 0.55, grain: 0.05, aberration: 0.0016 });
      }
      open = true;
      openT = 0; // 启动汇聚入场
      return { ringR };
    },

    close() {
      open = false;
      clear();
    },

    pickAt(mx, my) {
      if (!open || !minis.length) return null;
      ndc.set((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(minis.map((n) => n.proxy), false);
      const hitDef = hits.length ? minis[hits[0].object.userData.nodeIndex].def : null;
      for (const n of minis) n.hoveredNode = hitDef !== null && n.def === hitDef;
      return hitDef;
    },

    update(dt, elapsed) {
      if (!open) return;
      // 四芒星与小星系作为一个整体缓慢同转(约 75 秒一周)
      if (ringGroup) ringGroup.rotation.y = elapsed * (Math.PI * 2 / 75);

      // 汇聚入场:0~2s 四芒星粒子从四方球壳缓出奔向既定位置(easeOutCubic)
      if (openT >= 0) {
        openT += dt;
        if (clouds.length && openT <= INTRO + 0.06) {
          const k = Math.min(1, openT / INTRO);
          const e = 1 - Math.pow(1 - k, 3);
          for (const c of clouds) {
            const arr = c.attr.array;
            for (let j = 0; j < c.tgt.length; j++) arr[j] = c.start[j] + (c.tgt[j] - c.start[j]) * e;
            c.attr.needsUpdate = true;
          }
        }
      }

      for (let i = 0; i < minis.length; i++) {
        const n = minis[i];
        const w = 0.006 * n.rotDir * dt;
        n.bodySp.material.rotation -= w;
        n.haloSp.material.rotation += w;
        n.core.rotation.y += 0.02 * dt;
        n.g.getWorldPosition(_v);
        _dir.copy(camera.position).sub(_v).normalize();
        n.haloSp.position.copy(_dir).multiplyScalar(n.R * 0.35);

        n.hoverT += ((n.hoveredNode ? 1 : 0) - n.hoverT) * Math.min(1, dt * 12);

        // 小星系错峰浮现:四芒星汇聚近尾声时(1.3s 起)依次缓出长大
        const t0 = 1.3 + i * 0.18;
        const ak = openT < 0 ? 1 : Math.max(0, Math.min(1, (openT - t0) / 0.7));
        const ae = 1 - Math.pow(1 - ak, 3);
        n.g.scale.setScalar(Math.max(0.0001, ae * (1 + n.hoverT * 0.12)));

        // 标签常显:淡淡地落在小星系上(参考图式的简单文字),悬停时提亮转金
        const el = labelEls[i];
        if (ae < 0.4) { el.classList.remove('show'); continue; }
        const sp = _v.clone().project(camera);
        if (sp.z > 1 || Math.abs(sp.x) > 1 || Math.abs(sp.y) > 1) { el.classList.remove('show'); continue; }
        el.classList.add('show');
        el.style.left = `${(sp.x * 0.5 + 0.5) * innerWidth}px`;
        el.style.top = `${(-sp.y * 0.5 + 0.5) * innerHeight}px`;
        el.style.opacity = (0.5 + n.hoverT * 0.5) * ae;
        el.style.color = n.hoverT > 0.6 ? '#d4a95a' : '';
      }
    },

    render(elapsed) {
      if (!open || !postfx) return;
      postfx.update(elapsed);
      postfx.composer.render();
    },

    resize() {
      if (postfx) postfx.setSize(innerWidth, innerHeight);
    },
  };

  return api;
}
