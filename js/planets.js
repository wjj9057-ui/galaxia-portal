// planets.js — 点彩星系系统(星球本体版)
// 每颗星系 = body(L2~L3+子云)/halo(L4~L5)两个点彩 Sprite + 中心真实发光球体(星球本体)
// 贴图层每帧沿"星系中心→相机"视线方向重排(halo 靠相机侧),任意角度严格同心
// 布局:年份同心圈(最早年份最内圈);连线收纳在 SHOW_LINKS flag 后,默认关闭
import * as THREE from 'three';
import { makeCloudLayers, makeCloudTexture, mulberry32, PALETTE } from './pointillism-factory.js';

const SHOW_LINKS = false;            // 星系连线(默认 false,代码保留)
const WARM_WHITE = [255, 243, 224];

// ---------- 发光球体工厂(星球本体,interior 内部层复用) ----------
export function createGlowSphere(glowBase, sphereR) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: glowBase.clone() },
      uMul: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uMul;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vPos;
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      void main() {
        float ndv = abs(dot(normalize(vNormal), normalize(vViewDir)));
        float rim = pow(1.0 - ndv, 2.0) * 0.55;              // 边缘辉光(恒星临边)
        float grain = (hash(vPos.xy * 320.0 + vPos.z) - 0.5) * 0.10; // 细砂纹
        vec3 col = uColor * (0.82 + rim + grain) * uMul;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  mat.toneMapped = false;
  return new THREE.Mesh(new THREE.SphereGeometry(sphereR, 48, 32), mat);
}

// ---------- 颜色归一化:任何输入色都落到点彩气质(S 55~75%,L 38~62%),不出荧光 ----------
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function normalizeColor(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
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
  h = (h + 360) % 360;
  s = Math.min(0.75, Math.max(0.55, s));       // S 归一 55~75%
  const lc = Math.min(0.62, Math.max(0.38, l)); // L 归一 38~62%
  const c = (1 - Math.abs(2 * lc - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lc - c / 2;
  let rr, gg, bb;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
}

// 每个客户的点彩参数(colors 填写制:primary → L2/L3 主体色与星球本体;secondary → 子云斑块)
function cloudParamsFor(client) {
  const rand = mulberry32(client.colorSeed * 131 + 17);
  const cols = client.colors || { primary: '#D9C08A', secondary: '#C9803A' };
  const main = normalizeColor(cols.primary);
  const patches = [normalizeColor(cols.secondary)];
  return {
    main,
    patches,
    ringed: rand() < 0.22,   // 贴图浓彩环维持原随机率;回访光环另以细金环表达(见 createPlanetSystem)
    coreType: 'none',
    seed: client.colorSeed * 1009 + 7,
  };
}

// ---------- 大小映射资料丰富度:D 线性映射到 [Dmin, Dmax],Dmax = Dmin × 5 ----------
// richness = story 条数×2 + (有 piece 3) + (有 plan 2) + elements(proposal 交付物总数)
const RICH_DMIN = 2.2, RICH_DMAX = 11;   // Dmax = Dmin × 5
function richnessOf(c) {
  if (typeof c.richness === 'number') return c.richness; // 新模型:适配层按公开资料体量算好
  const elements = (c.proposal || []).reduce((n, p) => n + (p.deliverables ? p.deliverables.length : 0), 0);
  return (c.story ? c.story.length * 2 : 0) + (c.article ? 3 : 0) + (c.proposal ? 2 : 0) + elements;
}

// ---------- 年份同心圈:每年一圈,最早最内,圈距 8~10,同年沿圈随机(半径 ±1.5、y ±2) ----------
function planComposition(clients) {
  const rand = mulberry32(20260724);
  const years = [...new Set(clients.map((c) => c.year))].sort();
  const placements = [];
  const ringRadius = years.map((_, i) => 12 + i * 9);   // 圈距 9(8~10 区间)
  const richnesses = clients.map(richnessOf);
  const rMin = Math.min(...richnesses), rMax = Math.max(...richnesses);

  years.forEach((year, yi) => {
    const members = clients.filter((c) => c.year === year);
    // 同圈星系用黄金角错开 + 随机抖动,自然不呆板
    let ang = rand() * Math.PI * 2;
    members.forEach((client) => {
      ang += 2.39996 + (rand() - 0.5) * 0.5;
      const r = ringRadius[yi] + (rand() - 0.5) * 3;     // 半径 ±1.5
      const D = RICH_DMIN + ((richnessOf(client) - rMin) / Math.max(1, rMax - rMin)) * (RICH_DMAX - RICH_DMIN);
      placements.push({
        client,
        D,
        year,
        ringR: ringRadius[yi],
        pos: new THREE.Vector3(
          Math.cos(ang) * r,
          (rand() - 0.5) * 4,                             // y ±2
          Math.sin(ang) * r
        ),
      });
    });
  });

  return { placements, ringRadius, years };
}

export function createPlanetSystem(clients) {
  const group = new THREE.Group();
  group.name = 'planets';

  const { placements, ringRadius, years } = planComposition(clients);
  const planets = [];

  // ---------- 年轮圈线(#d9c08a,透明度 0.05;悬停联动 0.2,导航点击闪亮 0.25) ----------
  const ringLines = ringRadius.map((r, i) => {
    const pts = [];
    for (let k = 0; k <= 128; k++) {
      const a = (k / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: 0xd9c08a, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    line.name = `ring-${r}`;
    group.add(line);
    return { r, year: years[i], line, flashUntil: -1 };
  });

  placements.forEach(({ client, D, pos, ringR }) => {
    const cp = cloudParamsFor(client);
    const R = D / 2;
    const haloSize = D * 1.65;

    // 两层点彩贴图(基准 2048px;coreType='none',L1 空,本体由球体承担)
    const baseLayers = makeCloudLayers({ ...cp, size: 2048, maxN: 20000 });

    const pGroup = new THREE.Group();
    pGroup.name = `planet-${client.id}`;
    pGroup.position.copy(pos);

    const spacing = R * 0.35;

    function layerSprite(tex, colorMul) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mat.color.setScalar(colorMul);
      const sp = new THREE.Sprite(mat);
      sp.scale.set(haloSize, haloSize, 1);
      return sp;
    }

    // body 居中(亮度 ×2.0)、halo 每帧重排到靠相机侧(亮度 ×1.3)
    const bodySp = layerSprite(baseLayers.body, 2.0);
    const haloSp = layerSprite(baseLayers.halo, 1.3);
    pGroup.add(bodySp, haloSp);

    // ---------- 星球本体:真实发光球体(主色向暖白混 45%,明确带色相) ----------
    const glowBase = new THREE.Color(cp.main[0] / 255, cp.main[1] / 255, cp.main[2] / 255)
      .lerp(new THREE.Color(WARM_WHITE[0] / 255, WARM_WHITE[1] / 255, WARM_WHITE[2] / 255), 0.45);
    const sphereR = R * 0.09;
    const sphere = createGlowSphere(glowBase, sphereR);
    pGroup.add(sphere);
    // 两层薄辉光壳:1.15x / 1.45x,同色 BackSide(透明度随相机距离衰减)
    const shell1 = new THREE.Mesh(
      new THREE.SphereGeometry(sphereR * 1.15, 32, 24),
      new THREE.MeshBasicMaterial({
        color: glowBase.clone(), side: THREE.BackSide, transparent: true,
        opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    const shell2 = new THREE.Mesh(
      new THREE.SphereGeometry(sphereR * 1.45, 32, 24),
      new THREE.MeshBasicMaterial({
        color: glowBase.clone(), side: THREE.BackSide, transparent: true,
        opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    pGroup.add(shell1, shell2);

    // ---------- 回访光环:多段故事的星,外围一道道土星式粒子环带(光环数 = 故事数 − 1) ----------
    // 粒子形态(哑光硬点,疏密作渐变):带心最密最亮,向内外边缘高斯衰减;
    // 配色随星走(主色/辅色为主,掺少量金砂),远看戴环的星即"回来过的人"
    const haloRings = [];
    for (let ri = 0; ri < (client.rings || 0); ri++) {
      // 贴星:环从星体边缘起步;每道光环由 4 股极细环丝构成,丝间留缝(土星环的纹路感)
      const base = R * (0.98 + ri * 0.16);
      const STRANDS = [
        { off: -0.055, w: 0.010, den: 0.18, br: 0.75 },
        { off: -0.018, w: 0.013, den: 0.34, br: 1.0 },
        { off: 0.014, w: 0.011, den: 0.30, br: 0.9 },
        { off: 0.052, w: 0.009, den: 0.18, br: 0.65 },
      ];
      const N = 1100;
      const rpos = new Float32Array(N * 3);
      const rcol = new Float32Array(N * 3);
      const rrand = mulberry32(client.colorSeed * 977 + ri * 131 + 29);
      const GOLD = [217, 192, 138];
      for (let i = 0; i < N; i++) {
        // 按密度权重选一股环丝
        let pickS = rrand(), s = STRANDS[0], acc = 0;
        for (const st of STRANDS) { acc += st.den; if (pickS <= acc) { s = st; break; } }
        const a = rrand() * Math.PI * 2;
        const g = (rrand() + rrand() + rrand() + rrand() - 2) / 2;   // 近高斯 [-1, 1]
        const rad = base + s.off * R + g * s.w * R;
        rpos[i * 3] = Math.cos(a) * rad;
        rpos[i * 3 + 1] = (rrand() + rrand() - 1) * R * 0.008;       // 环面极薄
        rpos[i * 3 + 2] = Math.sin(a) * rad;
        const fall = Math.exp(-g * g * 2.0);                          // 丝心 → 丝缘渐暗
        const b = (0.2 + rrand() * 0.4) * fall * s.br;
        const pick = rrand();
        const c = pick < 0.55 ? cp.main : (pick < 0.85 ? cp.patches[0] : GOLD);
        rcol[i * 3] = (c[0] / 255) * b;
        rcol[i * 3 + 1] = (c[1] / 255) * b;
        rcol[i * 3 + 2] = (c[2] / 255) * b;
      }
      const rgeo = new THREE.BufferGeometry();
      rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
      rgeo.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
      const ring = new THREE.Points(rgeo, new THREE.PointsMaterial({
        size: 1.15, sizeAttenuation: false, vertexColors: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      ring.frustumCulled = false;
      pGroup.add(ring);
      haloRings.push(ring);
    }

    // 隐形拾取代理球:半径 = 星系视觉半径(D/2)× 0.6;DoubleSide 允许相机进入球内后继续命中
    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.6, 12, 8),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, side: THREE.DoubleSide })
    );
    proxy.userData.planetId = client.id;
    pGroup.add(proxy);

    group.add(pGroup);

    const rand = mulberry32(client.colorSeed * 53 + 3);
    planets.push({
      id: client.id,
      data: client,
      group: pGroup,
      layers: { body: bodySp, halo: haloSp },
      sphere,
      shells: [shell1, shell2],
      haloRings,
      glowBase,
      status: client.status === 'ing' ? 'ing' : 'done',  // done 满亮 / ing 未点燃(0.25)
      breathT: 3 + rand() * 2,                            // 呼吸周期 3~5s
      breathPhase: rand() * Math.PI * 2,
      proxy,
      ringLine: ringLines.find((rl) => rl.r === ringR) || null,
      cloudParams: cp,
      baseLayers,
      hdLayers: null,
      radius: R,                              // focusPosFor:落点 = 球体中心 + 视线反向 × 球体半径×6
      haloSize,
      rotFlip: rand() < 0.5 ? -1 : 1,
      hoverT: 0,
      haloFade: 1,                            // halo 当前透明度系数(飞近渐降)
      bodyFade: 2.0,                          // body 当前亮度系数(飞近降到 1.0,拉远回到 2.0)
      burstBoost: 0,                          // 爆裂蓄势:球体亮度额外攀升(0~0.15)
      atmoM: 1,                               // 参数面板亮度倍率
      dimmed: false,
    });
  });

  // ---------- 星轨连线(flag 控制,默认关闭) ----------
  const links = [];
  if (SHOW_LINKS) {
    const linkPairs = [];
    for (let i = 0; i < planets.length - 1; i++) linkPairs.push([i, i + 1]);
    linkPairs.forEach(([a, b]) => {
      const SEGS = 32;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGS + 1) * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xd9c08a, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      group.add(line);
      links.push({ line, a, b, segs: SEGS });
    });
  }

  const _va = new THREE.Vector3();
  const _vb = new THREE.Vector3();
  const _mid = new THREE.Vector3();
  const _curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const _dir = new THREE.Vector3();

  const api = {
    group,
    planets,

    update(dt, elapsed, params, camera) {
      // 悬停星系的年轮圈线:0.05 → 0.2;导航点击闪亮 0.25 持续 2 秒
      const hoveredPlanet = planets.find((p) => p.hovered) || null;
      for (const rl of ringLines) {
        let target = 0.05;
        if (hoveredPlanet && hoveredPlanet.ringLine && hoveredPlanet.ringLine.r === rl.r) target = 0.2;
        if (elapsed < rl.flashUntil) target = 0.25;
        const m = rl.line.material;
        m.opacity += (target - m.opacity) * Math.min(1, dt * 10);
      }

      for (const p of planets) {
        // 每帧沿"星系中心 → 相机"视线方向重排:halo 靠相机侧,任意角度严格同心
        _dir.copy(camera.position).sub(p.group.position).normalize();
        p.layers.halo.position.copy(_dir).multiplyScalar(p.radius * 0.35);

        // 两层点彩极缓慢反向自转(±0.005 rad/s)
        const w = 0.005 * p.rotFlip * params.rotationSpeed * dt;
        p.layers.body.material.rotation -= w;
        p.layers.halo.material.rotation += w;

        // 星球本体:极缓自转 + 亮度呼吸(±8%,3~5s 周期);ing 暗如未点燃的胚
        p.sphere.rotation.y += 0.02 * dt;
        const breath = 1 + 0.08 * Math.sin(elapsed * (Math.PI * 2 / p.breathT) + p.breathPhase);
        const mul = (p.status === 'ing' ? 0.25 : 0.9) * breath * (1 + p.burstBoost);
        p.sphere.material.uniforms.uMul.value = mul;

        // 悬停反馈:整组(贴图层 + 光球)150ms 缓动放大 1.07,移开缓回
        p.hoverT += ((p.hovered ? 1 : 0) - p.hoverT) * Math.min(1, dt * 14);
        p.group.scale.setScalar(1 + p.hoverT * 0.07);

        // 飞近(相机距离 < 星系半径)时:halo 渐降到 0.3 透明度、body 亮度降到 1.0
        // 避免粉尘糊住视线、浓彩环贴脸过曝;拉远后恢复
        const dCam = camera.position.distanceTo(p.group.position);
        const near = dCam < p.radius;
        const fadeTarget = (near ? 0.3 : 1) * (p.dimmed ? 0.15 : 1);
        p.haloFade += (fadeTarget - p.haloFade) * Math.min(1, dt * 5);
        p.layers.halo.material.opacity = p.haloFade;
        const bodyTarget = near ? 1.0 : 2.0;
        p.bodyFade += (bodyTarget - p.bodyFade) * Math.min(1, dt * 5);
        p.layers.body.material.color.setScalar(p.atmoM * p.bodyFade);
        p.layers.halo.material.color.setScalar(p.atmoM * 1.3);

        // 辉光壳透明度随相机距离衰减(聚焦距离 5.5R 下 0.25 → 贴脸 0.1),光球不糊成白饼
        const shellF = Math.min(1, dCam / (p.radius * 5.5));
        const shellOp = (0.1 + 0.15 * shellF) * mul;
        p.shells[0].material.opacity = shellOp;
        p.shells[1].material.opacity = shellOp * 0.4;
      }
      // 连线端点跟随(仅 flag 开启时)
      for (const lk of links) {
        const pa = planets[lk.a].group.position;
        const pb = planets[lk.b].group.position;
        _va.copy(pa); _vb.copy(pb);
        _mid.addVectors(_va, _vb).multiplyScalar(0.5);
        _mid.y += _va.distanceTo(_vb) * 0.18 + 1.2;
        _curve.v0.copy(_va); _curve.v1.copy(_mid); _curve.v2.copy(_vb);
        const attr = lk.line.geometry.attributes.position;
        for (let s = 0; s <= lk.segs; s++) {
          const pt = _curve.getPoint(s / lk.segs);
          attr.setXYZ(s, pt.x, pt.y, pt.z);
        }
        attr.needsUpdate = true;
        lk.line.material.opacity = params.linkOpacity;
      }
    },

    getPlanetById(id) { return planets.find((p) => p.id === id); },

    getProxies() { return planets.map((p) => p.proxy); },

    // 年轮圈信息(底部年份导航用)
    getRings() { return ringLines; },

    // 点击年份节点:该圈线亮起 0.25 持续 2 秒后渐回
    flashRing(r, now) {
      const rl = ringLines.find((x) => x.r === r);
      if (rl) rl.flashUntil = now + 2;
    },

    setHovered(id) {
      for (const p of planets) p.hovered = (p.id === id);
    },

    // 原"大气辉光强度"参数 → 亮度倍率(存到 p.atmoM,由 update 与距离衰减合成)
    setAtmosphereIntensity(v) {
      const m = Math.min(2, Math.max(0, v));
      for (const p of planets) p.atmoM = m;
    },

    // flyTo 聚焦后:同 seed 分帧重生成 4096px 高清贴图(避免一次性主线程卡顿)
    // 注:coreType 恒为 'none',core 层为空,不再生成
    upgradeToHD(id) {
      const p = this.getPlanetById(id);
      if (!p || p.hdLayers) return;
      p.hdLayers = {};
      const target = p.hdLayers;
      const jobs = [
        ['body', ['L2', 'L3', 'SUB', 'ACCENT']],
        ['halo', ['L4', 'L5']],
      ];
      const runNext = () => {
        if (p.hdLayers !== target) return; // 已被 releaseHD 放弃(用户已飞走),不再写入
        const job = jobs.shift();
        if (!job) return;
        const tex = makeCloudTexture({ ...p.cloudParams, size: 4096, maxN: 60000, layers: job[1] });
        p.hdLayers[job[0]] = tex;
        p.layers[job[0]].material.map = tex;
        p.layers[job[0]].material.needsUpdate = true;
        setTimeout(runNext, 30); // 每层让出一帧
      };
      setTimeout(runNext, 120);   // 落地先渲染,再逐层换高清
    },

    // 相机拉远:全部换回基准 2048px 并释放高清纹理
    releaseHD() {
      for (const p of planets) {
        if (!p.hdLayers) continue;
        if (p.hdLayers.body) {
          p.layers.body.material.map = p.baseLayers.body;
          p.layers.body.material.needsUpdate = true;
          p.hdLayers.body.dispose();
        }
        if (p.hdLayers.halo) {
          p.layers.halo.material.map = p.baseLayers.halo;
          p.layers.halo.material.needsUpdate = true;
          p.hdLayers.halo.dispose();
        }
        if (p.hdLayers.core) p.hdLayers.core.dispose();
        p.hdLayers = null;
      }
    },

    // 风格筛选:不匹配的整体调暗(styles 为新模型的风格标签数组,兼容旧 industry 字段)
    setFilter(style) {
      for (const p of planets) {
        const match = !style || (p.data.styles ? p.data.styles.includes(style) : p.data.industry === style);
        p.dimmed = !match;
        p.layers.body.material.opacity = match ? 1 : 0.15;
        for (const r of p.haloRings || []) r.material.opacity = match ? 1 : 0.12;
      }
    },

    // 调试线框:显示拾取代理球轮廓
    setWireframe(on) {
      for (const p of planets) {
        p.proxy.material.wireframe = on;
        p.proxy.material.colorWrite = on;
      }
    },

    setDebugView(v) {
      const showAll = v === 0 || v === 5 || v === 6;
      const planetVisible = showAll || v === 3 || v === 4;
      const linkVisible = showAll || v === 4;
      for (const p of planets) p.group.visible = planetVisible;
      for (const lk of links) lk.line.visible = linkVisible;
    },
  };

  return api;
}
