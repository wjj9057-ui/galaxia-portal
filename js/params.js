// params.js — 参数面板(lil-gui)+ localStorage 持久化
import GUI from '../vendor/lil-gui.esm.js';

// v2:2026-07-24 设计师定稿基准参数上线,升版本号让所有老访客的旧存档失效、统一吃到新默认值
const STORAGE_KEY = 'galaxia:settings:v2';

// 2026-07-24 设计师定稿视觉基准(卷人工调校),改动任何一项须卷拍板
export const DEFAULT_PARAMS = {
  // 银河
  nebulaDensity: 0.57,      // 星云密度
  nebulaHue: 0,             // 星云色相偏移(度)
  starCount: 8000,          // 星点数量
  // 后处理(定稿基准:Bloom 中低阈值+中强度服务整体氛围;grain 颗粒保留加分)
  bloomStrength: 1.06,
  bloomRadius: 0.55,
  bloomThreshold: 0.32,
  vignette: 0.55,           // 暗角强度
  grain: 0.05,              // 颗粒强度
  aberration: 0.0016,       // 色散强度
  exposure: 1,              // 曝光(定稿:Bloom 提亮后不再需要额外曝光补偿)
  // 运动
  cruiseSpeed: 1.65,        // 巡航速度倍率
  rotationSpeed: 2.35,      // 星球自转速度倍率
  // 星球
  atmosphereIntensity: 2.4, // 星系亮度倍率(body ×2.0 / halo ×1.3 在此基础上)
  linkOpacity: 0.27,        // 连线透明度
  // 音频
  volume: 0.5,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSettings(patch) {
  try {
    const prev = loadSettings() || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch { /* 隐私模式等场景下静默失败 */ }
}

export function createParamsPanel({ container, params, handlers }) {
  const gui = new GUI({ container, title: '星系参数', width: 280 });

  const fGalaxy = gui.addFolder('银河背景');
  fGalaxy.add(params, 'nebulaDensity', 0, 1, 0.01).name('星云密度').onChange(handlers.nebulaDensity);
  fGalaxy.add(params, 'nebulaHue', 0, 360, 1).name('星云色相').onChange(handlers.nebulaHue);
  fGalaxy.add(params, 'starCount', 1000, 16000, 500).name('星点数量').onFinishChange(handlers.starCount);

  const fPost = gui.addFolder('后处理');
  fPost.add(params, 'bloomStrength', 0, 3, 0.01).name('Bloom 强度').onChange(handlers.bloom);
  fPost.add(params, 'bloomRadius', 0, 1.5, 0.01).name('Bloom 半径').onChange(handlers.bloom);
  fPost.add(params, 'bloomThreshold', 0, 1, 0.01).name('Bloom 阈值').onChange(handlers.bloom);
  fPost.add(params, 'vignette', 0, 1, 0.01).name('暗角强度').onChange(handlers.grade);
  fPost.add(params, 'grain', 0, 0.25, 0.005).name('颗粒强度').onChange(handlers.grade);
  fPost.add(params, 'aberration', 0, 0.008, 0.0001).name('色散强度').onChange(handlers.grade);
  fPost.add(params, 'exposure', 0.2, 2.5, 0.01).name('曝光').onChange(handlers.exposure);

  const fMotion = gui.addFolder('运动与星球');
  fMotion.add(params, 'cruiseSpeed', 0, 3, 0.05).name('巡航速度');
  fMotion.add(params, 'rotationSpeed', 0, 4, 0.05).name('自转速度');
  fMotion.add(params, 'atmosphereIntensity', 0, 3, 0.01).name('大气辉光强度').onChange(handlers.atmosphere);
  fMotion.add(params, 'linkOpacity', 0, 1, 0.01).name('连线透明度');

  const fAudio = gui.addFolder('音频');
  fAudio.add(params, 'volume', 0, 1, 0.01).name('音量').onChange(handlers.volume);

  const actions = {
    恢复默认: () => {
      Object.assign(params, DEFAULT_PARAMS);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      handlers.applyAll();
    },
  };
  gui.add(actions, '恢复默认');

  fGalaxy.close(); fPost.close(); fMotion.close(); fAudio.close();

  let saveTimer = null;
  function persistDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSettings({ params }), 400);
  }
  gui.onFinishChange(persistDebounced);

  return { gui, persist: () => saveSettings({ params }) };
}
