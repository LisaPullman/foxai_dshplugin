// aircraft.test.js —— 飞机几何常量 / buildAircraft 副作用
// 锁定 P0-4（几何常量）、P1-1（pickMeshes/PARTS 累积修复）
import { describe, it, expect } from 'vitest';
import { WING_DEF, STAB_DEF, VTAIL_DEF } from '../src/aircraft.js';

describe('WING_DEF / STAB_DEF / VTAIL_DEF 几何常量', () => {
  it('主翼 zRoot=1.25, zTip=6.0, cRoot=5.6, cTip=1.7', () => {
    expect(WING_DEF.zRoot).toBe(1.25);
    expect(WING_DEF.zTip).toBe(6.0);
    expect(WING_DEF.cRoot).toBe(5.6);
    expect(WING_DEF.cTip).toBe(1.7);
    expect(WING_DEF.yMid).toBe(0.02);  // P0-4 修复后统一为 0.02
  });
  it('平尾 zRoot=1.05, zTip=4.25', () => {
    expect(STAB_DEF.zRoot).toBe(1.05);
    expect(STAB_DEF.zTip).toBe(4.25);
    expect(STAB_DEF.yMid).toBe(0.0);
  });
  it('垂尾 cant = 25°', () => {
    expect(VTAIL_DEF.cant).toBeCloseTo(25 * Math.PI / 180, 6);
  });
});

describe('AIRCRAFT 数据库', () => {
  it('导出 J-35 数据', async () => {
    const { AIRCRAFT } = await import('../src/aircraft.js');
    expect(AIRCRAFT.name).toBe('J-35');
    expect(AIRCRAFT.nameCN).toBe('歼-35 舰载机');
    expect(AIRCRAFT.length).toBe(17.3);
    expect(AIRCRAFT.span).toBe(12.0);
    expect(AIRCRAFT.S).toBe(45.0);
    expect(AIRCRAFT.MAC).toBe(4.0);
    expect(AIRCRAFT.AR).toBe(3.2);
    expect(AIRCRAFT.alphaStall).toBe(33);
    expect(AIRCRAFT.CLmax).toBe(1.65);
  });
});
