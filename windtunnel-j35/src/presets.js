// 10 个测试预设（章节 6.1）—— 机型歼-35 舰载机
export const PRESETS = [
  { id: 1, nameKey: 0, params: { U: 60,  alpha: 3,  beta: 0, Tu: 1,  deltaE: 0,  mode: 0 } },
  { id: 2, nameKey: 1, params: { U: 230, alpha: 2,  beta: 0, Tu: 1,  deltaE: 0,  mode: 0 } },
  { id: 3, nameKey: 2, params: { U: 120, alpha: 22, beta: 0, Tu: 1,  deltaE: -6, mode: 3 } },
  { id: 4, nameKey: 3, params: { U: 90,  alpha: 30, beta: 0, Tu: 1,  deltaE: -12, mode: 4 } },
  { id: 5, nameKey: 4, params: { U: 150, alpha: 4,  beta: 18, Tu: 1, deltaE: 0,  mode: 0 } },
  { id: 6, nameKey: 5, params: { U: 150, alpha: 6,  beta: 0, Tu: 20, deltaE: 0,  mode: 2 } },
  { id: 7, nameKey: 6, params: { U: 313, alpha: 2,  beta: 0, Tu: 0.5, deltaE: 0, mode: 6, mach: 0.96 } },
  { id: 8, nameKey: 7, params: { U: 100, alpha: 14, beta: 0, Tu: 1,  deltaE: -4, mode: 3 } },
  { id: 9, nameKey: 8, params: { U: 150, alpha: 8,  beta: 0, Tu: 1,  deltaE: 0,  mode: 5, slicePos: 0.55, sliceType: 0 } },
  { id: 10, nameKey: 9, params: { U: 150, alpha: 10, beta: 0, Tu: 1,  deltaE: -3, mode: 4 } },
];

// fix: P2-4  preset.mach 字段接入：若给 mach 而未给 U，按 a * mach 反算 U
// —— 让 preset 7（跨音速演示 mach=0.96）能正确驱动跨音速效应而不只是改 U。
// 调用方在更新大气后再调（a 已知）。
export function resolvePresetParams(preset, speedOfSound) {
  const p = { ...preset.params };
  if (p.mach != null && p.U == null && speedOfSound > 0) {
    p.U = p.mach * speedOfSound;
  }
  delete p.mach;   // 不再写入 S
  return p;
}
