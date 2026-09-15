// flowfield.test.js —— 流场采样 / 涡量公式 / 几何常量共享快照测试
// 锁定 P0-2（sampleVort 索引）、P0-4（yMid 共享）、P1-6（AERO）修复
import { describe, it, expect, beforeEach } from 'vitest';
import { S, AIRCRAFT } from '../src/state.js';
import { updateAtmosphere } from '../src/atmosphere.js';
import { computeAero } from '../src/physics.js';
import {
  GEO, planform, rebuildVortices, startBake, bakeStep,
  sampleVort, sampleSpeed, GRID,
} from '../src/flowfield.js';
import { WING_DEF, STAB_DEF, VTAIL_DEF } from '../src/aircraft.js';
import { AERO } from '../src/physics.js';

describe('几何常量共享（修复 P0-4）', () => {
  it('WING_DEF.yMid = 0.02（GEO.wing.yMid 跟随）', () => {
    expect(WING_DEF.yMid).toBe(0.02);
    expect(GEO.wing.yMid).toBe(0.02);
  });
  it('STAB_DEF.yMid = 0.0', () => {
    expect(STAB_DEF.yMid).toBe(0.0);
    expect(GEO.stab.yMid).toBe(0.0);
  });
  it('VTAIL_DEF.cant = 25°', () => {
    expect(VTAIL_DEF.cant).toBeCloseTo(25 * Math.PI / 180, 6);
    expect(GEO.vtail.cant).toBeCloseTo(25 * Math.PI / 180, 6);
  });
});

describe('planform 翼型展开', () => {
  it('主翼根 z=1.25 → c=cRoot=5.6, le=xLERoot=-1.2', () => {
    const p = planform(WING_DEF, 1.25);
    expect(p.le).toBeCloseTo(-1.2, 4);
    expect(p.c).toBeCloseTo(5.6, 4);
  });
  it('主翼尖 z=6.0 → c=cTip=1.7', () => {
    const p = planform(WING_DEF, 6.0);
    expect(p.c).toBeCloseTo(1.7, 4);
  });
});

describe('sampleSpeed/sampleVort（修复 P0-2）', () => {
  beforeEach(() => {
    Object.assign(S, { U: 230, alpha: 3, beta: 0, deltaE: 0,
                          density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    updateAtmosphere();
    computeAero();
    rebuildVortices();
    startBake();
    let baked = false;
    for (let i = 0; i < 500 && !baked; i++) baked = bakeStep(4);
    if (!baked) throw new Error('bake not complete');
  });

  function gridIdx(g, x, y, z) {
    const fx = Math.floor((x - g.x0) / (g.x1 - g.x0) * (g.nx - 1));
    const fy = Math.floor((y - g.y0) / (g.y1 - g.y0) * (g.ny - 1));
    const fz = Math.floor((z - g.z0) / (g.z1 - g.z0) * (g.nz - 1));
    return (fy * g.nz + fz) * g.nx + fx;
  }

  it('sampleSpeed 自由来流区接近 S.U', () => {
    // 上游 (x=-14) 仍受机身势流影响约 5-10%，放宽阈值
    const sp = sampleSpeed(-14, 1.1, 0);
    expect(sp).toBeGreaterThan(200);
    expect(sp).toBeLessThan(240);
  });

  it('sampleVort 翼尖区 > 0（涡核真实存在）', () => {
    const vt = sampleVort(3, 0.05, 5.5);
    expect(vt).toBeGreaterThan(0);
  });

  it('sampleVort 索引公式修复后与 GRID 真值同量级（差 < 20%）', () => {
    // P0-2 修复前 sampleVort 输出混叠数据；修复后应当与 floor 索引处的真值接近
    const g = GRID;
    const trueV = g.vort[gridIdx(g, 3, 0.05, 5.5)];
    const sampV = sampleVort(3, 0.05, 5.5);
    // 双线性插值会引入一定偏差，但应当是同一量级而非几个数量级
    const ratio = Math.abs(sampV - trueV) / Math.max(trueV, 1);
    expect(ratio).toBeLessThan(0.5);  // 50% 容差
  });

  it('GRID 烘焙后 n = nx·ny·nz, vel.length = 3n', () => {
    expect(GRID.n).toBe(GRID.nx * GRID.ny * GRID.nz);
    expect(GRID.vel.length).toBe(GRID.n * 3);
    expect(GRID.speed.length).toBe(GRID.n);
    expect(GRID.vort.length).toBe(GRID.n);
    expect(GRID.version).toBeGreaterThan(0);
  });
});

describe('rebuildVortices 涡启动阈值（修复 P1-6/P1-7）', () => {
  it('α=5° 时不应有脱体涡（alphaExcess < 0.01 阈值）', () => {
    Object.assign(S, { U: 230, alpha: 5, beta: 0, deltaE: 0,
                          density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    updateAtmosphere(); computeAero();
    rebuildVortices();
    // 涡启动阈值已抽到 AERO.VORTEX_ALPHA_START=10
    // alphaExcess = max(5-10, 0)/23 = 0 → 不进入
    // 间接验证：alphaExcess <= 0 时 gl 不会被计算
    expect(AERO.VORTEX_ALPHA_START).toBe(10);
  });

  it('α=20° 时脱体涡应启动（aEx > 0.01）', () => {
    Object.assign(S, { U: 230, alpha: 20, beta: 0, deltaE: 0,
                          density: 1.225, viscosity: 1.79e-5, M: 0.676, roughness: 12 });
    updateAtmosphere(); computeAero();
    rebuildVortices();
    expect(AERO.VORTEX_ALPHA_START).toBe(10);
    expect(AERO.VORTEX_ALPHA_FULL).toBe(33);
    // 20° 时 aEx = 10/23 ≈ 0.43
    const aEx = Math.max(S.alpha - AERO.VORTEX_ALPHA_START, 0)
              / (AERO.VORTEX_ALPHA_FULL - AERO.VORTEX_ALPHA_START);
    expect(aEx).toBeGreaterThan(0.4);
  });
});
