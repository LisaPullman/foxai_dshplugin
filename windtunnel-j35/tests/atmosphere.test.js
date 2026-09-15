// atmosphere.test.js —— ISA 大气模型数值快照测试
// 锁定前三轮修复后的物理数值：分层、换算、M 计算
import { describe, it, expect, beforeEach } from 'vitest';
import { isa, updateAtmosphere } from '../src/atmosphere.js';
import { S } from '../src/state.js';

describe('ISA 分层（修复 P0-3）', () => {
  it('h=0 海平面标准值', () => {
    const r = isa(0);
    expect(r.T).toBeCloseTo(288.15, 2);
    expect(r.p).toBeCloseTo(101325, 0);
    expect(r.rho).toBeCloseTo(1.225, 3);
    expect(r.a).toBeCloseTo(340.3, 1);
    expect(r.mu).toBeCloseTo(1.789e-5, 7);
  });

  it('h=11000 m 对流层顶', () => {
    const r = isa(11000);
    expect(r.T).toBeCloseTo(216.65, 1);
    expect(r.p).toBeCloseTo(22632, 0);
    expect(r.a).toBeCloseTo(295.07, 1);
  });

  it('h=20000 m 平流层下层', () => {
    const r = isa(20000);
    expect(r.T).toBe(216.65);
    expect(r.p).toBeCloseTo(5474.9, 0);   // 标准 ~5475 Pa
  });

  it('h=30000 m 高空回退（不再崩溃到 10^-26 Pa）', () => {
    const r = isa(30000);
    expect(r.p).toBeGreaterThan(1000);   // 应保持 >1 kPa（不再 10^-26）
    expect(r.p).toBeLessThan(6000);
    expect(r.T).toBe(216.65);
  });

  it('h=50000 m 极端高空不回退到负值', () => {
    const r = isa(50000);
    expect(r.p).toBeGreaterThan(0);
    expect(Number.isFinite(r.p)).toBe(true);
  });
});

describe('updateAtmosphere（修复 P1-3/P1-4）', () => {
  beforeEach(() => {
    // 重置 S 到默认
    Object.assign(S, {
      atmoLinked: true, altitude: 0, temperature: 288.15,
      density: 1.225, viscosity: 1.79e-5,
      U: 230, alpha: 3, beta: 0, deltaE: 0,
    });
  });

  it('atmoLinked=true 默认应刷 S.a=340.3, S.M=0.676, S.q=32.4', () => {
    updateAtmosphere();
    expect(S.a).toBeCloseTo(340.3, 1);
    expect(S.M).toBeCloseTo(230 / 340.3, 3);
    expect(S.q).toBeCloseTo(0.5 * 1.225 * 230 * 230 / 1000, 1);
    expect(S.density).toBeCloseTo(1.225, 3);
  });

  it('U=0 时 M=0（修复 P1-4：原 S.a>1 永远为真）', () => {
    S.U = 0;
    updateAtmosphere();
    expect(S.M).toBe(0);
  });

  it('atmoLinked=false 也能刷新 M 和 q（修复 P1-3b）', () => {
    S.atmoLinked = false;
    S.density = 1.0;
    S.U = 100;
    updateAtmosphere();
    expect(S.M).toBeCloseTo(100 / 340.3, 3);
    expect(S.q).toBeCloseTo(0.5 * 1.0 * 100 * 100 / 1000, 1);  // 5.0 kPa
  });

  it('非 ISA 温度（atmoLinked=true）正确换算（修复 P1-3）', () => {
    S.temperature = 300;  // 用户实测 300K（非 ISA 288.15）
    S.altitude = 5000;
    updateAtmosphere();
    // p_h at 5km ISA = 101325 * (255.65/288.15)^5.2559 ≈ 54019 Pa
    // p = p_h * (300/255.65)^5.2559 ≈ 54019 * 2.319 ≈ 125230 Pa
    // ρ = p / (R*T) = 125230 / (287.05 * 300) ≈ 1.4542 kg/m³
    expect(S.density).toBeCloseTo(125230 / (287.05 * 300), 2);
    expect(S.density).toBeCloseTo(1.4542, 2);
  });
});
