// main.js — GALAXIA 主控:渲染循环、巡航/镜头调度、拾取交互、HUD、快捷键、URL 接口、持久化
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGalaxy } from './galaxy.js';
import { createPlanetSystem } from './planets.js';
import { createPostFX } from './postfx.js';
import { createDetailLayer } from './detail.js';
import { createAudioEngine } from './audio.js';
import { createInterior } from './interior.js';
import { DEFAULT_PARAMS, loadSettings, saveSettings, createParamsPanel } from './params.js';

// ---------- 质量档 ----------
const QUALITY = {
  standard:  { pixelRatioCap: 1.25, starCount: 4500,  bloomScale: 0.45 },
  high:      { pixelRatioCap: 2.0,  starCount: 8000,  bloomScale: 0.6 },
  cinematic: { pixelRatioCap: 2.5,  starCount: 14000, bloomScale: 0.85 },
};
const QUALITY_KEYS = Object.keys(QUALITY);

const url = new URLSearchParams(location.search);
const settings = loadSettings() || {};
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
const urlQuality = url.get('quality');
let qualityKey = QUALITY_KEYS.includes(urlQuality) ? urlQuality
  : (settings.quality && QUALITY[settings.quality]) ? settings.quality
  : (isMobile ? 'standard' : 'high');
let quality = QUALITY[qualityKey];

// 合并持久化参数
const params = { ...DEFAULT_PARAMS, ...(settings.params || {}) };

// URL 接口
const shotMode = url.has('shot');
const shotValue = url.get('shot') || 'default';
const urlClient = url.get('client');
if (shotMode) window.__SHOT_READY__ = false;

// ---------- 渲染器 / 场景 / 相机 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: shotMode });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatioCap));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0c10);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
const HOME_POS = new THREE.Vector3(0, 10, 28);
camera.position.copy(HOME_POS);

const controls = new OrbitControls(camera, canvas);
const interior = createInterior(renderer, camera);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.2;
controls.maxDistance = 160;
controls.target.set(0, 0, 0);

// ---------- 启动流程 ----------
const elLoading = document.getElementById('loading');
const elLoadingBar = document.getElementById('loading-progress');
const elLoadingText = document.getElementById('loading-text');
function setLoading(pct, text) {
  elLoadingBar.style.width = `${pct}%`;
  if (text) elLoadingText.textContent = text;
}

let galaxy = null;
let planets = null;
let postfx = null;
let clients = [];

async function boot() {
  setLoading(20, '正在读取客户数据…');
  const res = await fetch('data/clients.json');
  clients = await res.json();

  setLoading(45, '正在点亮星系…');
  galaxy = createGalaxy({ ...quality, starCount: params.starCount });
  scene.add(galaxy.group);

  setLoading(65, '正在铸造星球…');
  planets = createPlanetSystem(clients);
  scene.add(planets.group);
  planets.setAtmosphereIntensity(params.atmosphereIntensity);
  cruiseR = Math.max(...planets.getRings().map((r) => r.r)) * 1.6; // 巡航半径 = 最外年轮圈 × 1.6

  setLoading(82, '正在调校镜头…');
  postfx = createPostFX(renderer, scene, camera, quality);
  applyAllParams();

  initHUD();
  initPicking();
  initHotkeys();
  initYearNav();
  initGLRecovery();

  document.getElementById('client-count').textContent = `${clients.length} 位客户`;

  // 自动化钩子(Playwright 测试 / 外部脚本用)
  window.__galaxia = {
    interior,
    approachState: () => (approach ? { phase: approach.phase, chargeT: Number(approach.chargeT.toFixed(2)) } : null),
    openArchive(id) { // 直接打开档案卡(单击连贯进入流程下,档案入口暂挂测试钩子)
      const p = planets.getPlanetById(id);
      if (!p) return;
      detailPlanet = p;
      detail.open(p.data);
    },
    gotoClient,
    isDetailOpen: () => detail.isOpen(),
    hoveredId: () => (hoveredPlanet ? hoveredPlanet.id : null),
    cameraPos: () => camera.position.toArray().map((v) => Number(v.toFixed(2))),
    planetTextureSize(id) {
      const p = planets.getPlanetById(id);
      return p && p.layers.body.material.map && p.layers.body.material.map.image
        ? p.layers.body.material.map.image.width : 0;
    },
    spriteInfo(id) {
      const p = planets.getPlanetById(id);
      if (!p) return null;
      return {
        scale: p.layers.body.scale.toArray().map((v) => Number(v.toFixed(2))),
        pos: p.group.position.toArray().map((v) => Number(v.toFixed(2))),
        radius: Number(p.radius.toFixed(2)),
        glowBase: p.glowBase.toArray().map((v) => Number(v.toFixed(3))),
        camDist: Number(camera.position.distanceTo(p.group.position).toFixed(2)),
        targetDist: Number(controls.target.distanceTo(p.group.position).toFixed(2)),
        visible: p.layers.body.visible && p.group.visible,
      };
    },
    planetScreenPos(id) {
      const p = planets.getPlanetById(id);
      if (!p) return null;
      const v = p.group.position.clone().project(camera);
      if (v.z > 1) return null;
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    },
  };

  // URL 直达 / 截图模式机位
  // 注意:不做"自动飞回上次浏览星球"——加载完必须直接停在全景(旧逻辑会先全景再 tween 到局部,像卡顿)
  if (shotMode) {
    cruiseEnabled = false;
    applyShotCamera();
  } else if (urlClient) {
    cruiseEnabled = false;
    gotoClient(urlClient, { openDetail: true, instant: false });
  }

  requestAnimationFrame(animate);
}

function applyShotCamera() {
  if (shotValue === 'top') {
    camera.position.set(0, 70, 0.01);
    controls.target.set(0, 0, 0);
  } else if (shotValue === 'focus' && planets.planets.length) {
    const p = planets.planets[0];
    camera.position.copy(focusPosFor(p));
    controls.target.copy(p.group.position);
  } else {
    camera.position.set(6, 8, 24);
    controls.target.set(0, 0, 0);
  }
  // ?shot &client=xxx → 立即飞到该星球并打开详情
  if (urlClient && planets.getPlanetById(urlClient)) {
    gotoClient(urlClient, { openDetail: true, instant: true });
  }
}

// ---------- 巡航与镜头 tween ----------
let cruiseEnabled = !shotMode;
let lastInteraction = -1e9; // 初始即视为久未交互,巡航立即生效
let tween = null;
const IDLE_RESUME_MS = 8000;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function flyTo(toPos, toTarget, duration = 1.8, onDone = null) {
  if (planets) planets.releaseHD(); // 任何镜头移动前:换回基准贴图并释放高清纹理
  tween = null; // 打断进行中的 tween(instant 路径也必须清,否则旧 tween 会劫持相机)
  if (duration <= 0) {
    camera.position.copy(toPos);
    controls.target.copy(toTarget);
    if (onDone) onDone();
    return;
  }
  tween = {
    t0: elapsed, duration,
    fromPos: camera.position.clone(), toPos: toPos.clone(),
    fromTarget: controls.target.clone(), toTarget: toTarget.clone(),
    onDone,
  };
  controls.enabled = false;
}

let cruiseAngle = Math.atan2(camera.position.z, camera.position.x);
let cruiseR = 48;                        // 巡航半径 = 最外年轮圈 × 1.6(planets 就绪后校准)
const CRUISE_ELEV = THREE.MathUtils.degToRad(25); // 固定仰角 25°(20~30° 区间)
const _cruisePos = new THREE.Vector3();
function cruiseActive() {
  return cruiseEnabled && !tween && !approach && !detail.isOpen() && !interiorMode &&
    (performance.now() - lastInteraction > IDLE_RESUME_MS);
}
// 固定轨道环游:target 锁死年份圈几何中心,相机以固定半径/仰角绕圈,只改方位角
function updateCruise(dt) {
  cruiseAngle += dt * 0.05 * params.cruiseSpeed;
  const rXZ = cruiseR * Math.cos(CRUISE_ELEV);
  _cruisePos.set(Math.cos(cruiseAngle) * rXZ, cruiseR * Math.sin(CRUISE_ELEV), Math.sin(cruiseAngle) * rXZ);
  camera.position.lerp(_cruisePos, Math.min(1, dt * 1.5)); // 平滑切回轨道,不跳变
  controls.target.set(0, 0, 0);
  camera.lookAt(controls.target); // 巡航期间朝向同样逐帧对齐,接管/交还都无甩头
}

// 任何用户输入立即中断巡航;追赶中的 approach 一并取消
controls.addEventListener('start', () => {
  lastInteraction = performance.now();
  if (approach) cancelApproach();
});
controls.addEventListener('end', () => { lastInteraction = performance.now(); });

// 聚焦某星球的机位:目标点 = 星系中心;机位距离 = 星系半径 × 5.5(整团占屏 35~45%)
function focusPosFor(p) {
  const center = p.group.position.clone();
  const dir = camera.position.clone().sub(center).normalize();
  return center.clone().add(dir.multiplyScalar(p.radius * 5.5));
}

// ---------- 详情层 ----------
const detail = createDetailLayer();
let detailPlanet = null;
const _prevPlanetPos = new THREE.Vector3();

// ---------- 选中态(第一段:聚焦 + 名字牌) ----------
let selectedPlanet = null;
let archiveFromPlate = false;
const namePlate = document.getElementById('name-plate');

function showNamePlate(p) {
  selectedPlanet = p;
  detailPlanet = p;
  document.getElementById('np-name').textContent = p.data.name;
  document.getElementById('np-meta').textContent = `${p.data.industry} · ${p.data.tagline}`;
  namePlate.classList.remove('hidden');
  requestAnimationFrame(() => namePlate.classList.add('on'));
}
function hideNamePlateVisual() {
  namePlate.classList.remove('on');
}
function deselect() {
  if (!selectedPlanet) return;
  hideNamePlateVisual();
  selectedPlanet = null;
  detailPlanet = null;
  controls.minDistance = 1.2;
  flyTo(HOME_POS, new THREE.Vector3(0, 0, 0), 1.6);
}
document.getElementById('np-enter').addEventListener('click', () => { if (selectedPlanet) burstEnter(selectedPlanet); });
document.getElementById('np-archive').addEventListener('click', () => {
  if (!selectedPlanet) return;
  archiveFromPlate = true;
  hideNamePlateVisual();
  detail.open(selectedPlanet.data);
});
document.getElementById('np-close').addEventListener('click', deselect);

// ---------- 内部层(第二段:爆裂转场 → 进入星球) ----------
let interiorMode = false;
let suppressHomeOnce = false;
const veil = document.getElementById('veil');
const interiorBack = document.getElementById('interior-back');
let burst = null; // { pts, vel, life, dur }

// b. 从球心迸发 400~600 颗硬点粒子(主色 + 辅色,径向减速扩散并淡出 ~700ms)
function spawnBurst(p) {
  const N = 500;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const main = p.cloudParams.main, sec = p.cloudParams.patches[0];
  const c = p.group.position;
  for (let i = 0; i < N; i++) {
    pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
    const th = Math.random() * Math.PI * 2;
    const cp = Math.random() * 2 - 1;
    const sp = Math.sqrt(1 - cp * cp);
    const speed = 6 + Math.random() * 9;
    vel[i * 3] = sp * Math.cos(th) * speed;
    vel[i * 3 + 1] = cp * speed * 0.6;
    vel[i * 3 + 2] = sp * Math.sin(th) * speed;
    const cc = Math.random() < 0.65 ? main : sec;
    const b = 0.5 + Math.random() * 0.5;
    col[i * 3] = (cc[0] / 255) * b; col[i * 3 + 1] = (cc[1] / 255) * b; col[i * 3 + 2] = (cc[2] / 255) * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  burst = { pts, vel, life: 0, dur: 0.7 };
}

function updateBurst(dt) {
  if (!burst) return;
  burst.life += dt;
  const pos = burst.pts.geometry.attributes.position;
  const damp = Math.max(0, 1 - 3.2 * dt); // 径向减速
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + burst.vel[i * 3] * dt,
      pos.getY(i) + burst.vel[i * 3 + 1] * dt,
      pos.getZ(i) + burst.vel[i * 3 + 2] * dt);
    burst.vel[i * 3] *= damp;
    burst.vel[i * 3 + 1] *= damp;
    burst.vel[i * 3 + 2] *= damp;
  }
  pos.needsUpdate = true;
  burst.pts.material.opacity = Math.max(0, 1 - burst.life / burst.dur);
  if (burst.life >= burst.dur) {
    scene.remove(burst.pts);
    burst.pts.geometry.dispose();
    burst.pts.material.dispose();
    burst = null;
  }
}

// 爆裂转场:a 蓄势攀升 → b 迸发 → c 近最大时交叉淡切(无白闪)
// skipRamp:连贯进入时 0.6s 蓄势已在 approach 阶段完成,跳过自身蓄势
function burstEnter(p, { skipRamp = false } = {}) {
  if (interiorMode || !p) return;
  labelEl.classList.remove('show');
  hideNamePlateVisual();
  if (detail.isOpen()) { suppressHomeOnce = true; detail.close(); }
  if (!skipRamp) {
    // a. 0.3s 蓄势:球体亮度攀升 15%
    const t0 = performance.now();
    const ramp = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / 300);
      p.burstBoost = 0.15 * k;
      if (k >= 1) clearInterval(ramp);
    }, 30);
  }
  // b. 迸发粒子
  spawnBurst(p);
  // c. 粒子扩散近最大(500ms)时,交叉淡切 300ms 进二级场景
  setTimeout(() => {
    veil.classList.add('on');
    setTimeout(() => {
      enterInteriorDirect(p);
      p.burstBoost = 0;
      veil.classList.remove('on');
    }, 300);
  }, 500);
}

function enterInteriorDirect(p) {
  interiorMode = true;
  controls.target.set(0, 0, 0);
  const fromDir = camera.position.clone().sub(p.group.position).normalize();
  const { ringR } = interior.open({
    glowBase: p.glowBase,
    radius: p.radius * 0.09,
    seed: p.cloudParams.seed,
    fromDir,
    main: p.cloudParams.main,
    secondary: p.cloudParams.patches[0],
  });
  controls.minDistance = ringR * 0.7; // 允许推进,但不贴脸
  interiorBack.classList.remove('hidden');
}

function exitInterior() {
  if (!interiorMode) return;
  veil.classList.add('on');
  setTimeout(() => {
    interior.close();
    interiorMode = false;
    closeNodeCard();
    interiorBack.classList.add('hidden');
    veil.classList.remove('on');
    // 相机回到该星系选中位(连贯进入的抵达位姿,无名牌)
    const p = selectedPlanet;
    if (p) {
      controls.minDistance = Math.max(0.3, p.radius * 5.5 * 0.7);
      flyTo(focusPosFor(p), p.group.position.clone(), 1.4);
    } else {
      controls.minDistance = 1.2;
      flyTo(HOME_POS, new THREE.Vector3(0, 0, 0), 1.6);
    }
  }, 300);
}

// ---------- 节点占位内容卡 ----------
function openNodeCard(def) {
  document.getElementById('node-card-title').textContent = def.label;
  document.getElementById('node-card-body').textContent =
    `「${def.label}」的内容即将归档。这里会安放与${def.label}相关的全部素材:照片、文字、片段与注脚。`;
  document.getElementById('node-card').classList.remove('hidden');
}
function closeNodeCard() {
  document.getElementById('node-card').classList.add('hidden');
}
document.getElementById('node-card-close').addEventListener('click', closeNodeCard);
interiorBack.addEventListener('click', exitInterior);
document.getElementById('detail-enter').addEventListener('click', () => { if (detailPlanet) burstEnter(detailPlanet); });

// ---------- 连贯进入:点击 → 阻尼追赶(无固定时长)→ 蓄势 → 自动爆裂 ----------
// approach 终点位姿即追赶目标本身,严禁动画结束后对 camera/target 做一次性硬赋值
let approach = null; // { pos, target, planet, phase: 'fly'|'charge', chargeT }

function startApproach(p) {
  selectedClientId = p.id;
  saveSettings({ lastClientId: p.id });
  selectedPlanet = p;
  controls.minDistance = Math.max(0.3, p.radius * 5.5 * 0.7);
  approach = {
    pos: focusPosFor(p),
    target: p.group.position.clone(),
    planet: p,
    phase: 'fly',
    chargeT: 0,
  };
  controls.enabled = false; // 追赶期间禁手动;任何输入经 controls 'start' 事件取消
}

function cancelApproach() {
  if (!approach) return;
  approach = null;
  controls.enabled = true;
  lastInteraction = -1e9; // 立即平滑回巡航(lerp 回轨道,不跳变)
}

function updateApproach(dt) {
  if (!approach) return;
  // 阻尼追赶:帧率无关收敛系数(60fps 时 k=0.085,低帧率自动加大,手感一致不瞬移)
  const k = 1 - Math.pow(1 - 0.085, dt * 60);
  camera.position.lerp(approach.pos, k);
  controls.target.lerp(approach.target, k);
  camera.lookAt(controls.target); // 朝向随目标点连续插值:星球一路滑进画面中心,杜绝交还控制权时的一帧甩头
  const focusDist = Math.max(0.001, approach.pos.distanceTo(approach.target));
  if (approach.phase === 'fly') {
    const errP = camera.position.distanceTo(approach.pos) / focusDist;
    const errT = controls.target.distanceTo(approach.target) / focusDist;
    if (errP < 0.005 && errT < 0.005) {
      approach.phase = 'charge'; // 抵达判定(位姿误差 < 0.5%)→ 停顿蓄势
      approach.chargeT = 0;
      planets.upgradeToHD(approach.planet.id); // 蓄势期间分帧换高清
    }
  } else {
    // 停顿 0.6s 蓄势:星球亮度爬升 15%
    approach.chargeT += dt;
    approach.planet.burstBoost = 0.15 * Math.min(1, approach.chargeT / 0.6);
    if (approach.chargeT >= 0.6) {
      const p = approach.planet;
      approach = null;
      controls.enabled = true;
      burstEnter(p, { skipRamp: true }); // 自动触发爆裂转场
    }
  }
}

function gotoClient(id, { instant = false } = {}) {
  const p = planets.getPlanetById(id);
  if (!p) return;
  if (instant) {
    tween = null; // 打断进行中的 tween,否则瞬移后旧 tween 继续劫持相机
    camera.position.copy(focusPosFor(p));
    controls.target.copy(p.group.position);
    camera.updateMatrixWorld(); // 瞬移后立即刷新矩阵,避免下一帧投影用旧位姿
    selectedPlanet = p;
    selectedClientId = id;
    return;
  }
  startApproach(p);
}

detail.onClose(() => {
  // burstEnter 主动关卡片进入内部层:跳过回家飞行
  if (suppressHomeOnce) {
    suppressHomeOnce = false;
    detailPlanet = null;
    return;
  }
  // 从名字牌打开的档案:关闭后回到该星系选中位(无名牌)
  if (archiveFromPlate && selectedPlanet) {
    archiveFromPlate = false;
    controls.minDistance = Math.max(0.3, selectedPlanet.radius * 5.5 * 0.7);
    flyTo(focusPosFor(selectedPlanet), selectedPlanet.group.position.clone(), 1.4);
    return;
  }
  detailPlanet = null;
  controls.minDistance = 1.2;
  flyTo(HOME_POS, new THREE.Vector3(0, 0, 0), 1.6);
});

// 详情打开期间,相机与目标跟随仍在公转的星球
const _trackDelta = new THREE.Vector3();
function updateDetailTracking(dt) {
  if (!detail.isOpen() || !detailPlanet || tween) return;
  const pp = detailPlanet.group.position;
  _trackDelta.subVectors(pp, _prevPlanetPos);
  camera.position.add(_trackDelta);
  controls.target.lerp(pp, Math.min(1, dt * 4));
  _prevPlanetPos.copy(pp);
}

// ---------- 拾取:悬停高亮 + 名称标签 + 点击/轻点 ----------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2(-2, -2);
let hoveredPlanet = null;
let selectedClientId = null;
let pointerDirty = false;

const labelEl = document.createElement('div');
labelEl.className = 'planet-label';
document.getElementById('labels').appendChild(labelEl);

function initPicking() {
  canvas.addEventListener('pointermove', (e) => {
    pointerNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointerDirty = true;
    // 内部层:节点悬停放大变亮 + 光标
    if (interiorMode) {
      const def = interior.pickAt(e.clientX, e.clientY);
      canvas.style.cursor = def ? 'pointer' : '';
      return;
    }
  });

  // 区分点击与拖拽:位移小、时长短才算选中
  let downX = 0, downY = 0, downT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; downT = performance.now();
  });
  canvas.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved > 6 || performance.now() - downT > 600) return;
    // 内部层:本轮点击不展开内容(占位发光点已换成五个小星系,内容下一轮)
    if (interiorMode) {
      interior.pickAt(e.clientX, e.clientY);
      return;
    }
    // 追赶途中:点击空白处 = 取消,相机平滑回漫游
    if (approach) {
      pointerNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      updateHover();
      if (!hoveredPlanet) cancelApproach();
      return;
    }
    pointerNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    updateHover(); // 触控端无悬停,点按前即时拾取
    // 单击连贯进入:命中即开始阻尼追赶(后续自动 蓄势→爆裂→二级)
    if (hoveredPlanet) startApproach(hoveredPlanet);
  });
}

function updateHover() {
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(planets.getProxies(), false);
  const hit = hits.length ? hits[0].object.userData.planetId : null;
  hoveredPlanet = hit ? planets.getPlanetById(hit) : null;
  planets.setHovered(hit);
  canvas.style.cursor = hit ? 'pointer' : '';
  pointerDirty = false;
}

const _proj = new THREE.Vector3();
function updateLabel() {
  if (!hoveredPlanet || detail.isOpen()) {
    labelEl.classList.remove('show');
    return;
  }
  _proj.copy(hoveredPlanet.group.position).project(camera);
  if (_proj.z > 1) { labelEl.classList.remove('show'); return; }
  const x = (_proj.x * 0.5 + 0.5) * innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * innerHeight;
  labelEl.style.left = `${x}px`;
  labelEl.style.top = `${y}px`;
  labelEl.innerHTML = `${hoveredPlanet.data.name}<span class="industry">${hoveredPlanet.data.industry}</span>`;
  labelEl.classList.add('show');
}

// ---------- 底部年份导航(轨道节点,叙世者金色系) ----------
let yearNavTimer = 0;
function initYearNav() {
  const nav = document.getElementById('year-nav');
  planets.getRings().forEach((rl) => {
    const btn = document.createElement('button');
    btn.className = 'year-node';
    btn.dataset.r = rl.r;
    btn.innerHTML = `<span class="year-dot"></span><span class="year-num">${rl.year}</span>`;
    btn.addEventListener('click', () => {
      cruiseEnabled = false;
      flyTo(new THREE.Vector3(0, rl.r * 1.7, rl.r * 1.05), new THREE.Vector3(0, 0, 0), 1.8);
      planets.flashRing(rl.r, elapsed);
    });
    nav.appendChild(btn);
  });
}
// 相机当前所在年轮圈(XZ 半径最近者)节点高亮
function updateYearNavActive(dt) {
  yearNavTimer += dt;
  if (yearNavTimer < 0.3) return;
  yearNavTimer = 0;
  const camR = Math.hypot(camera.position.x, camera.position.z);
  let best = null, bestD = Infinity;
  planets.getRings().forEach((rl) => {
    const d = Math.abs(camR - rl.r);
    if (d < bestD) { bestD = d; best = rl; }
  });
  document.querySelectorAll('.year-node').forEach((n) =>
    n.classList.toggle('active', best !== null && Number(n.dataset.r) === best.r));
}

// ---------- HUD:搜索 / 行业筛选 / 按钮 / 预设 ----------
function initHUD() {
  // 客户计数已填;行业下拉
  const industries = [...new Set(clients.map((c) => c.industry))];
  const sel = document.getElementById('industry-filter');
  industries.forEach((ind) => {
    const opt = document.createElement('option');
    opt.value = ind; opt.textContent = ind;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => planets.setFilter(sel.value));

  // 搜索
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  function doSearch() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.add('hidden'); return; }
    const matched = clients.filter((c) =>
      c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q) || c.tagline.toLowerCase().includes(q)
    ).slice(0, 8);
    results.innerHTML = matched.length
      ? matched.map((c) => `<div class="search-item" data-id="${c.id}"><span>${c.name}</span><span class="ind">${c.industry}</span></div>`).join('')
      : '<div class="search-empty">没有匹配的客户星球</div>';
    results.classList.remove('hidden');
    results.querySelectorAll('.search-item').forEach((el) => {
      el.addEventListener('pointerdown', () => {
        results.classList.add('hidden');
        input.blur();
        gotoClient(el.dataset.id, { openDetail: true });
      });
    });
  }
  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('.search-item');
      if (first) {
        results.classList.add('hidden');
        input.blur();
        gotoClient(first.dataset.id, { openDetail: true });
      }
    }
    e.stopPropagation(); // 搜索框内不触发全局快捷键
  });
  input.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 200));

  // 音乐开关
  const audio = createAudioEngine();
  window.__audio = audio;
  const btnAudio = document.getElementById('btn-audio');
  btnAudio.addEventListener('click', () => {
    const on = audio.toggle();
    if (on) audio.setVolume(params.volume);
    btnAudio.textContent = on ? '♪ 音乐 开' : '♪ 音乐 关';
    btnAudio.classList.toggle('on', on);
  });

  // 参数面板
  const panel = document.getElementById('params-panel');
  const btnParams = document.getElementById('btn-params');
  btnParams.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    btnParams.classList.toggle('on', !panel.classList.contains('hidden'));
  });
  paramsPanel = createParamsPanel({ container: panel, params, handlers: paramHandlers });

  // 视角预设
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
}

function applyPreset(name) {
  document.querySelectorAll('.preset-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.preset === name));
  if (name === 'top') {
    cruiseEnabled = false;
    flyTo(new THREE.Vector3(0, 70, 0.01), new THREE.Vector3(0, 0, 0), 1.8);
  } else if (name === 'cruise') {
    cruiseEnabled = true;
    lastInteraction = -1e9;
  } else if (name === 'random') {
    const p = planets.planets[Math.floor(Math.random() * planets.planets.length)];
    cruiseEnabled = false;
    selectedClientId = p.id;
    flyTo(focusPosFor(p), p.group.position.clone(), 2.0);
  } else if (name === 'focus') {
    const id = selectedClientId || (settings.lastClientId) || (clients[0] && clients[0].id);
    const p = planets.getPlanetById(id) || planets.planets[0];
    cruiseEnabled = false;
    flyTo(focusPosFor(p), p.group.position.clone(), 1.8);
  }
}

// ---------- 参数面板 handlers ----------
let paramsPanel = null;
const paramHandlers = {
  nebulaDensity: (v) => galaxy.setNebulaDensity(v),
  nebulaHue: (v) => galaxy.setNebulaHue(v),
  starCount: (v) => galaxy.setStarCount(v),
  bloom: () => postfx.setBloom({ strength: params.bloomStrength, radius: params.bloomRadius, threshold: params.bloomThreshold }),
  grade: () => postfx.setGrade({ vignette: params.vignette, grain: params.grain, aberration: params.aberration }),
  exposure: (v) => { renderer.toneMappingExposure = v; },
  atmosphere: (v) => planets.setAtmosphereIntensity(v),
  volume: (v) => { if (window.__audio) window.__audio.setVolume(v); },
  applyAll: () => applyAllParams(),
};
function applyAllParams() {
  galaxy.setNebulaDensity(params.nebulaDensity);
  galaxy.setNebulaHue(params.nebulaHue);
  galaxy.setStarCount(params.starCount);
  postfx.setBloom({ strength: params.bloomStrength, radius: params.bloomRadius, threshold: params.bloomThreshold });
  postfx.setGrade({ vignette: params.vignette, grain: params.grain, aberration: params.aberration });
  renderer.toneMappingExposure = params.exposure;
  planets.setAtmosphereIntensity(params.atmosphereIntensity);
}
addEventListener('beforeunload', () => { if (paramsPanel) paramsPanel.persist(); });

// ---------- 快捷键与调试视图 ----------
let debugView = 0;       // 0 正常;1 仅星空;2 仅星云;3 仅星球;4 仅连线;5 无后处理;6 线框
let debugInfoMode = 0;   // 0 隐藏;7/8/9 对应信息层
const elDebug = document.getElementById('debug-info');

function setDebugView(v) {
  debugView = v;
  galaxy.setDebugView(v);
  planets.setDebugView(v);
  planets.setWireframe(v === 6);
}

function initHotkeys() {
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      cruiseEnabled = !cruiseEnabled;
      if (cruiseEnabled) lastInteraction = -1e9;
    } else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (e.key === 'h' || e.key === 'H') {
      document.body.classList.toggle('hud-hidden');
    } else if (e.key === 'Escape') {
      // 分层退出:节点卡 → 内部层 → 追赶中 → 详情层
      if (!document.getElementById('node-card').classList.contains('hidden')) closeNodeCard();
      else if (interiorMode) exitInterior();
      else if (approach) cancelApproach();
      else if (detail.isOpen()) detail.close();
    } else if (e.key === 'q' || e.key === 'Q') {
      cycleQuality();
    } else if (/^[0-9]$/.test(e.key)) {
      const n = Number(e.key);
      if (n >= 7) {
        debugInfoMode = debugInfoMode === n ? 0 : n;
        elDebug.classList.toggle('hidden', debugInfoMode === 0);
      } else {
        setDebugView(n);
      }
    }
  });
}

function cycleQuality() {
  const idx = QUALITY_KEYS.indexOf(qualityKey);
  qualityKey = QUALITY_KEYS[(idx + 1) % QUALITY_KEYS.length];
  quality = QUALITY[qualityKey];
  saveSettings({ quality: qualityKey });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatioCap));
  params.starCount = quality.starCount;
  galaxy.setStarCount(quality.starCount);
  onResize(); // Bloom 分辨率按新档比例在下次加载生效;此处先同步画布尺寸
}

let fpsEMA = 60;
let debugTimer = 0;
function updateDebugInfo(dt) {
  if (!debugInfoMode) return;
  debugTimer += dt;
  if (debugTimer < 0.25) return;
  debugTimer = 0;
  if (debugInfoMode === 7) {
    const info = renderer.info.render;
    elDebug.textContent =
      `FPS ${fpsEMA.toFixed(0)}\n` +
      `draw calls ${info.calls}\n三角形 ${info.triangles}\n` +
      `相机 (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})\n` +
      `质量档 ${qualityKey} · 像素比 ${renderer.getPixelRatio().toFixed(2)}\n` +
      `巡航 ${cruiseEnabled ? '开' : '关'} · 调试视图 ${debugView}`;
  } else if (debugInfoMode === 8) {
    elDebug.textContent = JSON.stringify(params, null, 2);
  } else {
    elDebug.textContent = planets.planets.map((p) => {
      const q = p.group.position;
      return `${p.data.name} (${p.id})\n  行业 ${p.data.industry} · 位置 (${q.x.toFixed(1)}, ${q.y.toFixed(1)}, ${q.z.toFixed(1)})`;
    }).join('\n');
  }
}

// ---------- WebGL 上下文恢复 ----------
function initGLRecovery() {
  const overlay = document.getElementById('gl-overlay');
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // 允许浏览器自动恢复
    overlay.classList.remove('hidden');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    overlay.classList.add('hidden');
    onResize();
  });
}

// ---------- 主循环 ----------
const _zero = new THREE.Vector3();
const clock = new THREE.Clock();
let elapsed = 0;
let firstFrame = true;
let shotFrames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  fpsEMA += ((dt > 0 ? 1 / dt : 60) - fpsEMA) * 0.05;

  // 镜头调度:approach 追赶优先,其次 tween,再次巡航
  if (approach) {
    updateApproach(dt);
  } else if (tween) {
    const k = Math.min(1, (elapsed - tween.t0) / tween.duration);
    const e = easeInOutCubic(k);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    camera.lookAt(controls.target); // 同款修复:tween 全程朝向连续,结束交还 OrbitControls 无跳变
    if (k >= 1) {
      const done = tween.onDone;
      tween = null;
      controls.enabled = true;
      if (done) done();
    }
  } else if (cruiseActive()) {
    updateCruise(dt);
  } else {
    controls.update();
  }
  updateDetailTracking(dt);

  // 内部层:相机调度照跑(tween 推近/OrbitControls),其余交给内部场景
  if (interiorMode) {
    interior.update(dt, elapsed);
    interior.render(elapsed);
    updateDebugInfo(dt);
    return;
  }

  // 场景更新
  const pixelRatio = renderer.getPixelRatio();
  galaxy.update(dt, elapsed, pixelRatio);
  planets.update(dt, elapsed, params, camera);
  postfx.update(elapsed);

  // 拾取与标签
  if (pointerDirty && !detail.isOpen()) updateHover();
  updateLabel();

  // 爆裂粒子推进(选中 → 进入星球的转场)
  updateBurst(dt);

  // 渲染(调试视图 5 绕过后处理)
  if (debugView === 5) renderer.render(scene, camera);
  else postfx.composer.render();

  updateDebugInfo(dt);

  // 底部年份导航高亮
  updateYearNavActive(dt);

  // 首帧后撤掉加载层
  if (firstFrame) {
    firstFrame = false;
    setLoading(100, '完成');
    elLoading.classList.add('fade');
    setTimeout(() => elLoading.remove(), 900);
  }

  // 截图自动化:稳定渲染 30 帧后置就绪标记
  if (shotMode && !window.__SHOT_READY__) {
    shotFrames++;
    if (shotFrames >= 30) window.__SHOT_READY__ = true;
  }
}

// ---------- 自适应 ----------
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (postfx) postfx.setSize(innerWidth, innerHeight);
  interior.resize();
}
addEventListener('resize', onResize);

boot().catch((err) => {
  // 启动失败:加载层给出明确提示,不静默黑屏
  setLoading(100, `启动失败:${err.message}`);
  elLoadingText.style.color = '#ff9a7a';
});
