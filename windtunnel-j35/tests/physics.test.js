// physics.test.js —— 简化气动力模型快照测试
// 锁定 liftCoeff / dragCoeff / xcp / Cn 等公式修复后的数值
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAero, AERO } from '../src/physics.js';
import { S } from '../src/state.js';

describe('AERO 常量（修复 P1-6）', () => {
  it('导出阈值常量', () => {
    expect(AERO.VORTEX_ALPHA_START).toBe(10);
    expect(AERO.VORTEX_ALPHA_FULL).toBe(33);
  });
});

describe('computeAero 默认工况', () => {
  beforeEach(() => {
    Object.assign(S, {
      U: 230, alpha: 3, beta: 0, deltaE: 0,
      density: 1.225, viscosity: 1.79e-5,
      M: 0.676, roughness: 12,
    });
    computeAero();
  });

  it('CL(α=3, M=0.676) ≈ 0.256', () => {
    // clA = 3.6 * min(1/sqrt(1-0.676²), 1.6) = 3.6 * min(1.337, 1.6) = 4.81
    // linear = 4.81 * (3°·π/180) + 4.81 * 0.24 * 0
    // vortex = max(3-10, 0) = 0  (α<10°)
    // CL ≈ 0.252..0.26
    expect(S.aero.CL).toBeCloseTo(0.256, 2);
  });

  it('CD ≈ 0.029（诱导 + 零升）', () => {
    expect(S.aero.CD).toBeCloseTo(0.029, 2);
  });

  it('L = CL · q · S / 1000 ≈ 373 kN', () => {
    expect(S.aero.L).toBeCloseTo(372.9, 0);
  });

  it('Cm0 + Cmα·(α-2) + CmDe·δe —— 默认 α=3, δe=0 → Cm ≈ 0.015 + (-0.085)·1 + 0 = -0.07', () => {
    expect(S.aero.Cm).toBeCloseTo(-0.07, 2);
  });

  it('xcp 在 [0.02, 1.1] 范围内', () => {
    expect(S.aero.xcp).toBeGreaterThanOrEqual(0.02);
    expect(S.aero.xcp).toBeLessThanOrEqual(1.1);
    // α=3 正常段：xcp ≈ 0.49
    expect(S.aero.xcp).toBeCloseTo(0.49, 1);
  });
});

describe('computeAero 大攻角失速（修复 P0-2）', () => {
  it('α=30° 接近失速：CL 显著升高（含涡升力+失速衰减）', () => {
    Object.assign(S, { U: 230, alpha: 30, beta: 0, deltaE: 0,
                        density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    computeAero();
    // 涡升力 α>10° 渐增 → vortex = 20°·π/180·1.35·1 = 1.479
    // 线性 ≈ 4.81·30°·π/180 + 0 = 2.52
    // CL ≈ 2.52 + 1.479 = 4.0，但 stall 衰减 0.55·(6/8)² ≈ 0.31 → CL ≈ 2.77
    expect(S.aero.CL).toBeGreaterThan(2.0);
    expect(S.aero.CL).toBeLessThan(3.5);
  });

  it('α=0 极低 CL 不应让 xcp 爆炸（修复 P0-4）', () => {
    Object.assign(S, { U: 230, alpha: 0, beta: 0, deltaE: 0,
                        density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    computeAero();
    // CL ≈ 0 但 |CL|<0.05 不进入分支，xcp=0.25
    expect(S.aero.xcp).toBe(0.25);
    expect(Number.isFinite(S.aero.xcp)).toBe(true);
  });
});

describe('δe 方向一致性（修复 P0-3/P0-5）', () => {
  it('+δe 应使 CL↑（全动平尾后缘下偏 → 抬头）', () => {
    Object.assign(S, { U: 230, alpha: 2, deltaE: 0, beta: 0,
                        density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    computeAero();
    const cl0 = S.aero.CL;
    Object.assign(S, { deltaE: 6 });
    computeAero();
    expect(S.aero.CL).toBeGreaterThan(cl0 + 0.04);  // +δe 应增加 >0.04
  });

  it('-δe 应使 CL↓', () => {
    Object.assign(S, { U: 230, alpha: 2, deltaE: -6, beta: 0,
                        density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    computeAero();
    expect(S.aero.CL).toBeLessThan(0.20);
  });

  it('Cn = 0.00294 · β（修复 P1-6）', () => {
    Object.assign(S, { U: 230, alpha: 0, deltaE: 0, beta: 10,
                        density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    computeAero();
    // Cn = 0.00294 * 10 = 0.0294
    // n = Cn * q * S * b / 1000 = 0.0294 * 32400 * 12 * 45 / 1000 ≈ 514.4
    // 量级合理（偏航力矩对大展弦飞机可很大）
    expect(S.aero.n).toBeGreaterThan(400);
    expect(S.aero.n).toBeLessThan(600);
    // 反算回 Cn
    const Cn = S.aero.n * 1000 / (0.5 * 1.225 * 230 * 230 * 45 * 12);
    expect(Cn).toBeCloseTo(0.0294, 3);
  });
});

describe('computeAero 跨音速（M>0.85）', () => {
  it('M=0.95 时 CL 受 PG 修正 +1.6 上限影响', () => {
    Object.assign(S, { U: 322, alpha: 3, deltaE: 0, beta: 0,
                        density: 1.225, viscosity: 1.79e-5, M: 0.95, roughness: 12 });
    computeAero();
    // M=0.95 → pg=3.20 → clA=3.6·1.6=5.76（被 1.6 截）
    // linear = 5.76 * 3°·π/180 ≈ 0.302
    // CL ≈ 0.30
    expect(S.aero.CL).toBeGreaterThan(0.20);
    expect(S.aero.CL).toBeLessThan(0.35);
  });

  it('M=0.82 临界点：波阻开始', () => {
    Object.assign(S, { U: 279, alpha: 3, deltaE: 0, beta: 0,
                        density: 1.225, viscosity: 1.79e-5, M: 0.82, roughness: 12 });
    computeAero();
    // wave = 20 · (0)³ = 0 → CD ≈ 0.029 + 0 + 0 = 0.029
    expect(S.aero.CD).toBeLessThan(0.04);
  });
});
