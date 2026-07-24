// audio.js — WebAudio 程序化氛围音乐:振荡器 + 滤波 + 缓慢 LFO 的环境 Pad,无音频文件
export function createAudioEngine() {
  let ctx = null;
  let master = null;
  let nodes = [];
  let playing = false;
  let volume = 0.5;

  function buildGraph() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // 和弦垫:基于 A 小调九和弦的 5 个声部,极慢失谐漂移
    const freqs = [110, 164.81, 220, 261.63, 329.63];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.8;
    filter.connect(master);

    // 滤波截止频率的缓慢 LFO,营造呼吸感
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    nodes = [lfo];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (i - 2) * 4;
      const g = ctx.createGain();
      g.gain.value = 0.05 / (i * 0.4 + 1);
      // 每个声部独立振幅 LFO,相位错开
      const ampLfo = ctx.createOscillator();
      ampLfo.type = 'sine';
      ampLfo.frequency.value = 0.04 + i * 0.017;
      const ampLfoGain = ctx.createGain();
      ampLfoGain.gain.value = 0.025;
      ampLfo.connect(ampLfoGain).connect(g.gain);
      osc.connect(g).connect(filter);
      osc.start();
      ampLfo.start();
      nodes.push(osc, ampLfo);
    });

    // 极高频 shimmering 正弦,隐约的"星光"
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = 1318.5;
    const sg = ctx.createGain();
    sg.gain.value = 0.006;
    const sLfo = ctx.createOscillator();
    sLfo.frequency.value = 0.09;
    const sLfoG = ctx.createGain();
    sLfoG.gain.value = 0.005;
    sLfo.connect(sLfoG).connect(sg.gain);
    shimmer.connect(sg).connect(master);
    shimmer.start(); sLfo.start();
    nodes.push(shimmer, sLfo);
  }

  const api = {
    // 必须由用户手势触发
    toggle() {
      if (!ctx) {
        try { buildGraph(); } catch (e) { return false; }
      }
      if (ctx.state === 'suspended') ctx.resume();
      playing = !playing;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(playing ? volume * 0.6 : 0, now + 1.6);
      return playing;
    },

    setVolume(v) {
      volume = v;
      if (ctx && playing) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(volume * 0.6, ctx.currentTime + 0.3);
      }
    },

    isPlaying() { return playing; },
  };
  return api;
}
