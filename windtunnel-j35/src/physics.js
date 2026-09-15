// 简化气动力模型（章节 12.2）—— 查表/拟合 + 失速/跨音速/δe 修正
import { S, AIRCRAFT as AC } from './state.js';

const d2r = Math.PI / 180;
const STALL_BAND = 8;   // 距失速的归一化带宽（°），liftCoeff 与 computeAero 共用
// fix: P1-6  抽 α>10° 涡启动阈值为常量，供 physics.js / flowfield.js / visualizers.js 共用
// —— 避免四处硬编码 10° 漂移
export const AERO = {
  VORTEX_ALPHA_START: 10,    // 涡升力 / 脱体涡启动 α（°）
  VORTEX_ALPHA_FULL:  33,    // 涡升力 / 脱体涡完全展开 α（°），与 AIRCRAFT.alphaStall 对齐
};
const VORTEX_RANGE = AERO.VORTEX_ALPHA_FULL - AERO.VORTEX_ALPHA_START;

/** CL(α, δe, M)：线性 + 涡升力 + 失速 + 压缩性 + 平尾增量 */
function liftCoeff(alphaDeg, deltaEDeg, M) {
  // fix: P0-2  去掉重复赋值与负号矛盾。
  // 压缩性修正（Prandtl-Glauert 简化），M≥0.95 时 PG 截断
  const pg = M < 0.95
    ? 1 / Math.sqrt(Math.max(1 - M * M, 0.1))
    : 1 / Math.sqrt(0.0975);   // = 1/sqrt(1-0.95²) ≈ 3.20
  const clA = AC.CLalpha * Math.min(pg, 1.6);   // 上限放宽到 1.6，保留跨音速效应
  const a = alphaDeg;
  const d = deltaEDeg * 0.42;                   // 平尾效率
  // +δe 后缘下偏 → 抬头 → CL↑（系数取正）
  const linear = clA * (a * d2r) + clA * 0.24 * (d * d2r);
  // 涡升力（边条/机翼脱体涡，α>10° 渐增）
  const vortex = Math.max(a - AERO.VORTEX_ALPHA_START, 0) * d2r * 1.35 * Math.min(a / AERO.VORTEX_ALPHA_FULL, 1);
  // 失速修正（α_stall 前 4° 开始衰减）
  let cl = linear + vortex;
  const as = AC.alphaStall;
  if (a > as - 4) {
    const over = (a - (as - 4)) / STALL_BAND;   // 0→1 across stall
    const decay = 1 - 0.55 * Math.min(Math.pow(Math.max(over, 0), 2), 1);
    cl *= decay;
  }
  return Math.max(cl, -0.9);
}

/** CD(α, M, Re, 粗糙度)：零升阻力 + 诱导 + 波阻 */
function dragCoeff(cl, alphaDeg, M, roughPct) {
  const cd0_base = 0.021;
  const rough = cd0_base * (1 + roughPct / 100 * 1.6);
  const re = S.aero.Re || 1e7;
  const reFac = Math.max(0.82, Math.min(1.0, 0.55 + 0.062 * Math.log10(Math.max(re, 1e5) / 1e5)));
  const cd0 = rough * reFac;
  const induced = cl * cl / (Math.PI * AC.eOswald * AC.AR);
  // 波阻（M > 0.85 显著）
  let wave = 0;
  if (M > 0.82) wave = 20 * Math.pow(M - 0.82, 3.1);
  // 大攻角分离阻力
  const sep = Math.max(alphaDeg - 20, 0) * d2r * 0.9 * Math.max(alphaDeg / 33, 0.4);
  return cd0 + induced + wave + sep;
}

/** 主计算：每帧或参数变化时调用 */
export function computeAero() {
  const rho = S.density, U = S.U;
  const q = 0.5 * rho * U * U; // Pa
  const Re = (rho * U * AC.MAC) / S.viscosity;
  const M = S.M;
  const alpha = S.alpha, beta = S.beta, deltaE = S.deltaE;

  const CL = liftCoeff(alpha, deltaE, M);
  const CD = dragCoeff(CL, alpha, M, S.roughness);
  const CY = -1.15 * beta * d2r; // 垂尾+机身侧力

  const L = CL * q * AC.S / 1000;  // kN
  const D = CD * q * AC.S / 1000;
  const Y = CY * q * AC.S / 1000;

  // 力矩（简化）
  const cl0 = liftCoeff(0, 0, M);
  const Cm0 = 0.015;
  const CmAlpha = -0.085; // /deg（静稳定）
  const CmDe = -0.022;    // /deg
  // fix: P1-5  stallPitch 分母与 liftCoeff 共享 STALL_BAND
  const stallPitch = alpha > AC.alphaStall - 4
    ? -Math.pow((alpha - (AC.alphaStall - 4)) / STALL_BAND, 2) * 0.5
    : 0;
  const Cm = Cm0 + CmAlpha * (alpha - 2) + CmDe * deltaE + stallPitch;
  const m = Cm * q * AC.S * AC.MAC / 1000; // kN·m

  // fix: P1-6  去掉冗余的 * d2r * 57.3（等价 ×1），折算成常数 Cnβ
  // 原式 = (0.092 * 0.02 + 0.0011) * beta ≈ 0.00294 * beta（/deg）
  const Cn = 0.00294 * beta;             // 偏航恢复
  const n = Cn * q * AC.S * AC.span / 1000;
  const Cl_roll = -0.0075 * beta; // 滚转交联
  const l = Cl_roll * q * AC.S * AC.span / 1000;

  // fix: P0-4  压力中心（Cm/CL 反解，CL 小于阈值时钳到 0.35 避免爆炸）
  // 原代码 Math.max(0.35, 1) 永为 1，导致 CL→0 时 xcp→∞
  let xcp = 0.25;
  const clSafe = Math.max(Math.abs(CL), 0.35);
  if (Math.abs(CL) > 0.05) {
    xcp = 0.25 - (Cm - Cm0) / clSafe;
  }
  xcp = Math.max(0.02, Math.min(1.1, xcp));

  const stallMargin = AC.alphaStall - alpha;
  const TuWake = S.Tu + 9 * Math.pow(Math.max(CL, 0) / AC.CLmax, 2) + 1.5;

  S.aero = {
    Re, CL, CD, CY, L, D, Y, Cm, m, n, l, xcp, stallMargin, TuWake,
    pMax: 0, pMin: 0, // 由压力云图采样填充
    LD: D > 1e-4 ? L / D : 0,
  };
  return S.aero;
}
