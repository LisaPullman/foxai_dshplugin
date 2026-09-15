// 全局状态（章节六/九/十二：参数、模式、录制）
// fix: P2-1  AIRCRAFT 已搬至 aircraft.js，这里只做向后兼容重导出。
// 避免物理/流场/可视化等多个文件改动 import 路径，依赖 ESM 实时绑定。
export { AIRCRAFT } from './aircraft.js';

export const S = {
  // 气流
  U: 230,            // 风速 m/s
  // 姿态
  alpha: 3,          // 攻角 °
  beta: 0,           // 侧滑角 °
  deltaE: 0,         // 平尾偏转 δe °
  roll: 0,           // 滚转（仅视觉）°
  // 大气
  atmoLinked: true,
  altitude: 0,       // m
  temperature: 288.15, // K
  density: 1.225,    // kg/m³
  viscosity: 1.79e-5,  // Pa·s
  Tu: 1.0,           // 末端湍流强度 %
  // 模型
  roughness: 12,     // 表面粗糙度 %
  // 可视化
  particlePct: 55,   // 粒子数量 10–100%
  streamSegs: 30,    // 流线长度 4–40 段（步长自适应，总长恒 34 m）
  visRate: 1.0,      // 可视化速度倍率 0.1–3
  mode: 0,           // 可视化模式 0-6
  // 截面查看器
  sliceType: 0,      // 0 速度云图 / 1 纹影
  sliceHorizontal: true,
  slicePos: 0,       // -1..1 归一化
  // 画质
  resScale: 1.0,
  antialias: true,
  shadows: true,
  fpsLimit: 0,       // 0=无限制
  soundOn: true,     // 首次用户交互后自动启动（浏览器自动播放策略）
  // 求解
  solver: 'analytic', // analytic | numeric
  // 采样与录制
  sampling: true,
  recording: true,
  sampleHz: 20,
  // UI
  panelsHidden: false,
  lang: 'zh',
  // 派生量（每帧刷新）
  a: 340.3, M: 0.676, pStatic: 101.325, q: 32.4,
  // 气动结果
  aero: {},
  // 时间历程数据
  t: 0,
};

// 简单事件总线
// fix: P2-2  补 off() 返回解绑函数；emit 用 try/catch 防止单个订阅者崩溃影响其他订阅者
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, []);
  listeners.get(evt).push(fn);
  return () => off(evt, fn);
}
export function off(evt, fn) {
  const l = listeners.get(evt);
  if (!l) return;
  const i = l.indexOf(fn);
  if (i >= 0) l.splice(i, 1);
}
export function emit(evt, ...args) {
  const l = listeners.get(evt);
  if (l) l.forEach((fn) => { try { fn(...args); } catch (e) { console.error('[emit]', evt, e); } });
}
