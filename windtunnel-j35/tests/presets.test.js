// presets.test.js —— 预设数据 + mach 反算 U
// 锁定 P2-4 + P1-1 修复（PRESETS 不再被 mutate）
import { describe, it, expect } from 'vitest';
import { PRESETS, resolvePresetParams } from '../src/presets.js';

describe('PRESETS 数据', () => {
  it('10 个预设', () => {
    expect(PRESETS).toHaveLength(10);
  });
  it('每个 preset 有 id, nameKey, params', () => {
    for (const p of PRESETS) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('nameKey');
      expect(p).toHaveProperty('params');
    }
  });
  it('preset 7 含 mach=0.96（跨音速演示）', () => {
    expect(PRESETS[6].params.mach).toBe(0.96);
  });
  it('preset 7 的 U=313 也显式存在', () => {
    expect(PRESETS[6].params.U).toBe(313);
  });
});

describe('resolvePresetParams（修复 P1-1/P2-4）', () => {
  it('有 U 优先 U（不覆盖）', () => {
    const r = resolvePresetParams(PRESETS[6], 340);
    expect(r.U).toBe(313);
  });

  it('mach 反算 U（无 U 时）', () => {
    const fake = { params: { mach: 0.5 } };
    const r = resolvePresetParams(fake, 340);
    expect(r.U).toBeCloseTo(170, 1);
  });

  it('返回新对象（不 mutate PRESETS）', () => {
    const before = JSON.stringify(PRESETS[6].params);
    resolvePresetParams(PRESETS[6], 999);
    const after = JSON.stringify(PRESETS[6].params);
    expect(after).toBe(before);
  });

  it('结果不含 mach 字段', () => {
    const r = resolvePresetParams(PRESETS[6], 340);
    expect(r.mach).toBeUndefined();
  });

  it('speedOfSound<=0 时保留 U=null（不反算）', () => {
    const fake = { params: { mach: 0.5 } };
    const r = resolvePresetParams(fake, 0);
    expect(r.U).toBeUndefined();
  });
});
