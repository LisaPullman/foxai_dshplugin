// 模拟音效引擎 —— 分层合成（章节十八·可选增强：风扇声/风切声/失速抖振/激波）
// 层次：①宽频风噪（棕噪声+低通）②风啸（带通共振）③风扇叶片通过声（锯齿谐波）
//      ④失速抖振（低频隆隆声，LFO 调制）⑤跨音速激波爆音（单次触发）
import { S } from './state.js';

let ctx = null;
let master, windGain, windLP, whistleGain, whistleBP, fanGain, osc1, osc2, buffetGain, buffetLP;
let running = false, inited = false;
let lastM = 0;

function makeNoiseBuffer(seconds = 2.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = 0.975 * last + 0.025 * white; // 棕噪声
    d[i] = last * 3.6;
  }
  return buf;
}

function init() {
  if (inited) return;
  inited = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer();
  noise.loop = true;

  // ① 风噪层
  windLP = ctx.createBiquadFilter();
  windLP.type = 'lowpass';
  windLP.frequency.value = 400;
  windLP.Q.value = 0.7;
  windGain = ctx.createGain();
  windGain.gain.value = 0;
  noise.connect(windLP).connect(windGain).connect(master);

  // ② 风啸层（同一噪声源，带通提升）
  whistleBP = ctx.createBiquadFilter();
  whistleBP.type = 'bandpass';
  whistleBP.frequency.value = 1200;
  whistleBP.Q.value = 6;
  whistleGain = ctx.createGain();
  whistleGain.gain.value = 0;
  noise.connect(whistleBP).connect(whistleGain).connect(master);

  // ③ 风扇叶片通过声（基频 + 2 次谐波，轻微失谐）
  fanGain = ctx.createGain();
  fanGain.gain.value = 0;
  osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 16;
  const osc1LP = ctx.createBiquadFilter();
  osc1LP.type = 'lowpass';
  osc1LP.frequency.value = 240;
  osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = 32;
  osc1.connect(osc1LP).connect(fanGain);
  osc2.connect(fanGain);
  fanGain.connect(master);
  osc1.start(); osc2.start();

  // ④ 失速抖振（窄带低频隆隆）
  buffetLP = ctx.createBiquadFilter();
  buffetLP.type = 'lowpass';
  buffetLP.frequency.value = 120;
  buffetGain = ctx.createGain();
  buffetGain.gain.value = 0;
  noise.connect(buffetLP).connect(buffetGain).connect(master);

  noise.start();
}

function boom() {
  // ⑤ 激波爆音：短促带通噪声脉冲
  if (!ctx || !running) return;
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(0.4);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 320;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.5, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.55);
}

export const sound = {
  /** 浏览器要求首次用户手势后才能出声：main 在首个 pointerdown 时调用 */
  userGesture() {
    init();
    if (ctx.state === 'suspended') ctx.resume();
    if (S.soundOn) this._rampMaster();
  },

  toggle(on) {
    init();
    if (on) {
      ctx.resume();
      running = true;
      this._rampMaster();
    } else {
      running = false;
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
    }
  },

  _rampMaster() {
    running = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.6);
  },

  update() {
    if (!inited || !running || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const U = S.U, Mn = S.M;
    const uFrac = Math.min(U / 500, 1);

    // ① 风噪：截止频率与增益随风速
    windLP.frequency.linearRampToValueAtTime(150 + U * 5.2, t + 0.08);
    windGain.gain.linearRampToValueAtTime(Math.pow(uFrac, 0.75) * 0.5, t + 0.08);

    // ② 风啸：高速段渐显
    whistleBP.frequency.linearRampToValueAtTime(700 + U * 3.6, t + 0.08);
    whistleGain.gain.linearRampToValueAtTime(Math.pow(uFrac, 2.2) * 0.055, t + 0.08);

    // ③ 风扇：叶片通过频率（9 叶，角速度与渲染端 blades 同步）
    const omega = 0.4 + U * 0.05; // rad/s（tunnel.js 中 blades 用同一式）
    const bpf = omega / (2 * Math.PI) * 9;
    osc1.frequency.linearRampToValueAtTime(bpf, t + 0.08);
    osc2.frequency.linearRampToValueAtTime(bpf * 2.02, t + 0.08);
    fanGain.gain.linearRampToValueAtTime(0.05 + uFrac * 0.045, t + 0.08);

    // ④ 失速抖振：失速裕度 < 6° 渐入，8 Hz 脉动
    const margin = S.aero.stallMargin ?? 30;
    const buffet = margin < 6 ? (1 - Math.max(margin, 0) / 6) : 0;
    const pulse = buffet > 0 ? 0.55 + 0.45 * Math.sin(performance.now() / 1000 * 2 * Math.PI * 8) : 0;
    buffetGain.gain.linearRampToValueAtTime(buffet * pulse * 0.4 * Math.pow(uFrac, 0.5), t + 0.03);

    // ⑤ 跨音速：M 越过 0.85 触发一次爆音
    if (lastM < 0.85 && Mn >= 0.85) boom();
    lastM = Mn;
  },
};

// 页面隐藏时暂停（省电 + 避免后台噪声）
document.addEventListener('visibilitychange', () => {
  if (!inited) return;
  if (document.hidden) ctx.suspend();
  else if (running) ctx.resume();
});
