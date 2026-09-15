// ISA 国际标准大气模型（章节 12.3）+ 湍流模型
import { S } from './state.js';

const R = 287.05, GAMMA = 1.4, G = 9.80665;
const T0 = 288.15, L = 0.0065, P0 = 101325;
const T_TROP = 216.65;        // 对流层顶温度 K（11 km）
const H_TROP = 11000;         // 对流层顶高度 m
const G_OVER_RL = G / (R * L);// ≈ 5.2559

/** Sutherland 动力粘度（N·s/m²） */
function sutherlandMu(T) {
  return 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4);
}

// fix: P0-3  ISA 分层：对流层（≤11 km）多项式；同温层（11–20 km）指数衰减；高空回退恒压
// 返回 { T, p } —— 不在此处算 rho，避免依赖未传的 T 用户值
function isaLayer(h) {
  if (h <= H_TROP) {
    const T = T0 - L * h;
    const p = P0 * Math.pow(T / T0, G_OVER_RL);
    return { T, p };
  }
  if (h <= 20000) {
    const T = T_TROP;
    const pTrop = P0 * Math.pow(T_TROP / T0, G_OVER_RL);
    const p = pTrop * Math.exp(-G * (h - H_TROP) / (R * T));
    return { T, p };
  }
  // 20–32 km：恒压回退（避免负压 + 数值噪声）
  const pTrop = P0 * Math.pow(T_TROP / T0, G_OVER_RL);
  const p20 = pTrop * Math.exp(-G * (20000 - H_TROP) / (R * T_TROP));
  return { T: T_TROP, p: p20 };
}

/** ISA：海拔 → 温度/压强/密度/音速/粘度（h≥0 严格成立） */
export function isa(h) {
  const { T, p } = isaLayer(Math.max(0, h));
  const rho = p / (R * T);
  const a = Math.sqrt(GAMMA * R * T);
  const mu = sutherlandMu(T);
  return { T, p, rho, a, mu };
}

/** 每帧刷新大气派生量：联动时由海拔+温度推 ρ/μ/a/静压；松绑时直接用用户输入 */
export function updateAtmosphere() {
  if (S.atmoLinked) {
    // fix: P1-3  非 ISA 温度 → 用测高公式 + 等温段指数换算，避免伪物理
    const base = isa(S.altitude);             // 高度场
    const T = S.temperature;                   // 用户实测温度
    let p;
    if (S.altitude <= H_TROP) {
      // 等压换算（对流层内）：p = p_h * (T / T_h)^(g/(R·L))
      p = base.p * Math.pow(T / base.T, G_OVER_RL);
    } else {
      // 平流层内（11–20 km）：保持温度则静压不变
      p = base.p;
    }
    const rho = p / (R * T);
    const a = Math.sqrt(GAMMA * R * T);
    const mu = sutherlandMu(T);
    S.density = rho;
    S.viscosity = mu;
    S.a = a;
    S.pStatic = p / 1000; // kPa
  } else {
    // fix: P1-3b 松绑时同时刷新 M/q，否则旧值残留
    const base = isa(S.altitude);
    S.a = Math.sqrt(GAMMA * R * S.temperature);
    // 松绑时 ρ 由用户给定，p 用 p = ρ R T 自洽推
    S.pStatic = (S.density * R * S.temperature) / 1000;
  }
  // fix: P1-4  判定应为 U>0 而非 a>1（a 是 m/s，永 > 1）
  S.M = S.U > 0 && S.a > 0 ? S.U / S.a : 0;
  S.q = 0.5 * S.density * S.U * S.U / 1000; // kPa
}

/** 末端湍流：高斯随机脉动（粒子/烟线用） */
export function turbulenceFluct(tuPct, out) {
  const sigma = tuPct / 100 * 0.35;
  out[0] = (Math.random() * 2 - 1) * sigma;
  out[1] = (Math.random() * 2 - 1) * sigma;
  out[2] = (Math.random() * 2 - 1) * sigma;
  return out;
}
