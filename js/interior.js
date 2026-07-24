// interior.js — 星球内部层:五个平级小星系环列同转(参考:星尘带上点缀一族星系)
// 每个小星系 = 完整缩小版点彩星系(小发光核 + L2~L5 粒子云,锁版工厂小尺寸生成)
// 色调同源不同貌:全部以案子主色为底,子云斑块在主/辅色间轮换
// 圆环作为 Group 缓慢整体自转(约 75s 一周),每个小星系再带极慢自转
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
  let ringBand = null;
  let ringR = 8;
  let open = false;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(-2, -2);
  const _v = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function clear() {
    labelEls.forEach((el) => el.remove());
    labelEls = [];
    minis = [];
    if (ringGroup) {
      ringGroup.traverse((o) => {
        if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); }
        if (o.isMesh || o.isLine) { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }
      });
      scene.remove(ringGroup);
      ringGroup = null;
    }
    for (const pts of [stardust, ringBand]) {
      if (pts) { scene.remove(pts); pts.geometry.dispose(); pts.material.dispose(); }
    }
    stardust = null;
    ringBand = null;
  }

  const api = {
    scene,
    isOpen: () => open,
    getMinis: () => minis,
    getRingGroup: () => ringGroup,
    getRingR: () => ringR,

    // 进入:以该案主色构建五个平级小星系 + 主色星尘/环带,相机俯视 15~25° 全景
    open({ glowBase, radius, seed, fromDir, main, secondary }) {
      clear();
      const rand = mulberry32(seed * 31 + 5);
      const mainC = new THREE.Color(main[0] / 255, main[1] / 255, main[2] / 255);
      const secC = new THREE.Color(secondary[0] / 255, secondary[1] / 255, secondary[2] / 255);

      // ---------- 背景星尘(亮度 × 0.7;15% 染主色暗调) ----------
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
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({
          size: 1.4, sizeAttenuation: false, vertexColors: true,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        pts.frustumCulled = false;
        scene.add(pts);
        stardust = pts;
      }

      // ---------- 该案点彩粒子云环带(主色 + 辅色,穿心而过) ----------
      {
        const N = 2600;
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        const bandR = radius * 28; // 与圆环同尺度
        for (let i = 0; i < N; i++) {
          const a = rand() * Math.PI * 2;
          const rr = bandR * (0.55 + Math.abs(rand() + rand() - 1) * 0.55);
          pos[i * 3] = Math.cos(a) * rr + (rand() - 0.5) * bandR * 0.12;
          pos[i * 3 + 1] = (rand() - 0.5) * bandR * 0.16;
          pos[i * 3 + 2] = Math.sin(a) * rr + (rand() - 0.5) * bandR * 0.12;
          const useMain = rand() < 0.6;
          const c = useMain ? mainC : secC;
          const b = 0.3 + Math.pow(rand(), 2.0) * 0.7;
          col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({
          size: 1.6, sizeAttenuation: false, vertexColors: true,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        pts.frustumCulled = false;
        pts.rotation.x = (rand() - 0.5) * 0.3;
        scene.add(pts);
        ringBand = pts;
      }

      // ---------- 五个平级小星系(同一圆环等距分布,没有主次) ----------
      ringR = radius * 28;                // 圆环半径 ≈ 屏高 0.32(配合 ringR*3 机位)
      ringGroup = new THREE.Group();
      ringGroup.name = 'interior-ring';
      scene.add(ringGroup);

      // 圆环暗线(#d9c08a,极淡)
      {
        const pts = [];
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * ringR, 0, Math.sin(a) * ringR));
        }
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: 0xd9c08a, transparent: true, opacity: 0.05,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        ringGroup.add(line);
      }

      const miniD = ringR * 0.24;
      NODE_DEFS.forEach((def, i) => {
        const ang = (i / NODE_DEFS.length) * Math.PI * 2 + rand() * 0.25;
        const D = miniD * (0.85 + rand() * 0.35);   // 大小微差,各有性格
        const R = D / 2;
        const haloSize = D * 1.65;

        // 完整缩小版点彩星系:子云斑块在主/辅色间轮换
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
        g.position.set(Math.cos(ang) * ringR, 0, Math.sin(ang) * ringR);

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
        const bodySp = layerSprite(layers.body, 1.6);
        const haloSp = layerSprite(layers.halo, 1.1);
        g.add(bodySp, haloSp);

        // 小发光核:主色向暖白混 45%(绝不是白球)
        const miniGlow = new THREE.Color(main[0] / 255, main[1] / 255, main[2] / 255)
          .lerp(new THREE.Color(1, 243 / 255, 224 / 255), 0.45);
        const core = createGlowSphere(miniGlow, R * 0.11);
        g.add(core);

        // 隐形拾取球
        const proxy = new THREE.Mesh(
          new THREE.SphereGeometry(R * 0.6, 10, 8),
          new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, side: THREE.DoubleSide })
        );
        proxy.userData.nodeIndex = i;
        g.add(proxy);

        ringGroup.add(g);

        // 衬线标签(仅悬停时浮现)
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

      // 相机:俯视 15~25° 的全景机位(圆环与粒子带一眼看全)
      const elev = THREE.MathUtils.degToRad(20);
      const dist = ringR * 3;
      const flat = _dir.copy(fromDir).setY(0).normalize();
      camera.position.set(flat.x * dist * Math.cos(elev), dist * Math.sin(elev), flat.z * dist * Math.cos(elev));
      camera.lookAt(0, 0, 0);

      if (!postfx) {
        postfx = createPostFX(renderer, scene, camera, { bloomScale: 0.6 });
        // 与主场景一致的克制泛光
        postfx.setBloom({ strength: 0.3, radius: 0.4, threshold: 0.85 });
        postfx.setGrade({ vignette: 0.55, grain: 0.05, aberration: 0.0016 });
      }
      open = true;
      return { ringR };
    },

    close() {
      open = false;
      clear();
    },

    // 命中检测(返回节点 def 或 null;同步刷新悬停态)
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
      // 整个圆环作为 Group 缓慢整体自转(约 75 秒一周)
      if (ringGroup) ringGroup.rotation.y = elapsed * (Math.PI * 2 / 75);

      for (let i = 0; i < minis.length; i++) {
        const n = minis[i];
        // 小星系极慢自转(贴图反向) + 发光核自转
        const w = 0.006 * n.rotDir * dt;
        n.bodySp.material.rotation -= w;
        n.haloSp.material.rotation += w;
        n.core.rotation.y += 0.02 * dt;
        // halo 每帧沿"小星系中心 → 相机"视线方向重排(任意角度同心)
        n.g.getWorldPosition(_v);
        _dir.copy(camera.position).sub(_v).normalize();
        n.haloSp.position.copy(_dir).multiplyScalar(n.R * 0.35);

        // 悬停:轻微放大 + 浮现名字
        n.hoverT += ((n.hoveredNode ? 1 : 0) - n.hoverT) * Math.min(1, dt * 12);
        n.g.scale.setScalar(1 + n.hoverT * 0.12);

        const el = labelEls[i];
        if (n.hoverT < 0.3) { el.classList.remove('show'); continue; }
        const sp = _v.clone().project(camera);
        if (sp.z > 1 || Math.abs(sp.x) > 1 || Math.abs(sp.y) > 1) { el.classList.remove('show'); continue; }
        el.classList.add('show');
        el.style.left = `${(sp.x * 0.5 + 0.5) * innerWidth}px`;
        el.style.top = `${(-sp.y * 0.5 + 0.5) * innerHeight}px`;
        el.style.opacity = 0.4 + n.hoverT * 0.6;
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
