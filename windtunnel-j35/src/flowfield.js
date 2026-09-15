// 流场求解（章节 12.1）—— 解析近似：势流（源汇偶极）+ 涡格（马蹄涡）+ 脱体涡 + 尾流 + 激波修正
// 世界系速度场分块烘焙到三维网格，供粒子/切片/表面压力快速三线性采样。
import * as THREE from 'three';
import { S, AIRCRAFT as AC } from './state.js';
// fix: P0-4  翼面几何常量从 aircraft.js 引入，yMid 跟随 aircraft.js（0.02 而非 0.05）
import { WING_DEF, STAB_DEF, VTAIL_DEF } from './aircraft.js';
// fix: P1-6  共享 AERO.VORTEX_ALPHA_START/FULL 阈值，与 physics.js / visualizers.js 对齐
import { AERO } from './physics.js';

// —— 几何布局（机体系：机头 -X，尾 +X，上 +Y，右 +Z；单位 m）——
// 向后兼容别名（旧代码可能 import GEO.*）
export const GEO = { wing: WING_DEF, stab: STAB_DEF, vtail: VTAIL_DEF };

/** 翼面展向位置 → 前缘 x / 弦长 */
export function planform(surf, z) {
  const tt = Math.max(0, Math.min(1, (Math.abs(z) - surf.zRoot) / (surf.zTip - surf.zRoot)));
  const le = surf.xLERoot + surf.leSlope * tt * (surf.zTip - surf.zRoot);
  const c = surf.cRoot + (surf.cTip - surf.cRoot) * tt;
  return { le, c, te: le + c };
}

// —— 涡系缓存（参数变化时重建）——
let horseshoes = []; // 依附涡段 {ax,ay,az,bx,by,bz,gamma}
let trailingSegs = []; // 尾涡线 {ax,ay,az,bx,by,bz,gamma}
let levSegs = [];      // 脱体涡线段
const jetSrc = [];

// 视觉标定增益：2.0 时翼面上方/下方扰动速度约 ±12–25% U，色标利用充分
const VORTEX_GAIN = 2.0;

export function rebuildVortices() {
  horseshoes = []; trailingSegs = []; levSegs = []; jetSrc.length = 0;
  const CL = S.aero.CL || 0;
  const U = Math.max(S.U, 1);
  const G = VORTEX_GAIN;
  const FARX = 42;

  const pushHorseshoe = (surf, z0, z1, gamma, yMid) => {
    const p0 = planform(surf, z0), p1 = planform(surf, z1);
    const x0 = p0.le + 0.25 * p0.c, x1 = p1.le + 0.25 * p1.c;
    for (const s of [1, -1]) {
      const ax = x0, az = s * z0, bx = x1, bz = s * z1;
      horseshoes.push({ ax, ay: yMid, az, bx, by: yMid, bz, gamma });
      // 两条拖曳涡沿 +X
      trailingSegs.push({ ax, ay: yMid, az, bx: FARX, by: yMid, bz: az, gamma });
      trailingSegs.push({ ax: bx, ay: yMid, az: bz, bx: FARX, by: yMid, bz, gamma });
    }
  };

  // 主翼：每侧 5 面元，椭圆环量分布
  const nPan = 5;
  for (let i = 0; i < nPan; i++) {
    const z0 = GEO.wing.zRoot + (i / nPan) * (GEO.wing.zTip - GEO.wing.zRoot);
    const z1 = GEO.wing.zRoot + ((i + 1) / nPan) * (GEO.wing.zTip - GEO.wing.zRoot);
    const zc = (z0 + z1) / 2;
    const ell = Math.sqrt(Math.max(1 - Math.pow(zc / GEO.wing.zTip, 2), 0.05));
    pushHorseshoe(GEO.wing, z0, z1, G * CL * U * AC.MAC * ell / nPan * 2.2, GEO.wing.yMid);
  }
  // 全动平尾：δe 联动环量
  // fix: P0-3  原式 γT = -k·δe：+δe（后缘下偏）→ γT 负 → 反向环量 → 减小下洗 → 全机升力减小
  // 实际 +δe 应使全机抬头 → CL↑，与主翼同向环量为正（无负号）。
  // δe → +CL 的方向约定与 aircraft.js: setElevator(deg) 的视觉一致。
  const gammaT = 1.0 * U * AC.MAC * (S.deltaE * Math.PI / 180) * 0.9;
  for (let i = 0; i < 3; i++) {
    const z0 = GEO.stab.zRoot + (i / 3) * (GEO.stab.zTip - GEO.stab.zRoot);
    const z1 = GEO.stab.zRoot + ((i + 1) / 3) * (GEO.stab.zTip - GEO.stab.zRoot);
    pushHorseshoe(GEO.stab, z0, z1, gammaT / 3, GEO.stab.yMid);
  }
  // 垂尾（侧滑 β）——直接给出外倾前缘上的附着涡
  const gammaF = 0.8 * U * 3.5 * (S.beta * Math.PI / 180);
  const vt = GEO.vtail, cn = Math.cos(vt.cant), sn = Math.sin(vt.cant);
  for (const s of [1, -1]) {
    const a = { ax: vt.xLERoot + 0.9, ay: 1.0 + 0.9 * cn, az: s * (0.9 + 0.9 * sn), bx: vt.xLERoot + 2.8, by: 1.0 + 2.4 * cn, bz: s * (0.9 + 2.4 * sn), gamma: gammaF * 0.5 };
    horseshoes.push(a);
    // 拖曳涡：两条，从垂尾两端向远后方延伸
    trailingSegs.push({ ...a, bx: FARX, by: a.by, bz: a.az });  // 从 a 端
    trailingSegs.push({ ax: a.bx, ay: a.by, az: a.bz, bx: FARX, by: a.by, bz: a.bz, gamma: a.gamma });  // 从 b 端
  }
  // fix: P1-6  脱体涡启动/完全展开 α 与 physics.js 共享常量
  const aEx = Math.max(S.alpha - AERO.VORTEX_ALPHA_START, 0) / (AERO.VORTEX_ALPHA_FULL - AERO.VORTEX_ALPHA_START);
  if (aEx > 0.01) {
    const gl = 2.4 * U * AC.MAC * Math.min(aEx, 1.4) * 0.8;
    for (const s of [1, -1]) {
      const pts = [
        [-1.6, 0.42, 1.9], [0.8, 0.75, 2.15], [3.4, 1.25, 2.5], [6.0, 1.55, 2.75], [FARX, 1.4, 2.6],
      ].map((p) => ({ x: p[0], y: p[1], z: s * p[2] }));
      for (let i = 0; i < pts.length - 1; i++) {
        levSegs.push({ ax: pts[i].x, ay: pts[i].y, az: pts[i].z, bx: pts[i + 1].x, by: pts[i + 1].y, bz: pts[i + 1].z, gamma: gl * s });
      }
    }
  }
  // 喷流源（双发）
  jetSrc.push({ x: 8.7, y: 0.05, z: 0.72 }, { x: 8.7, y: 0.05, z: -0.72 });
}

// —— 基元 ——
/** 有限直线涡段（Lamb 公式 + 软化核）：v = Γ/4π · (r1×r2)/|r1×r2|² · L·(r̂1 − r̂2) */
function lineVortex(px, py, pz, s, out) {
  const r1x = px - s.ax, r1y = py - s.ay, r1z = pz - s.az;
  const r2x = px - s.bx, r2y = py - s.by, r2z = pz - s.bz;
  const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
  const cross2 = cx * cx + cy * cy + cz * cz;
  if (cross2 < 1e-10) return;
  const r1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z) + 1e-9;
  const r2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z) + 1e-9;
  const Lx = s.bx - s.ax, Ly = s.by - s.ay, Lz = s.bz - s.az;
  const Ldot = Lx * (r1x / r1 - r2x / r2) + Ly * (r1y / r1 - r2y / r2) + Lz * (r1z / r1 - r2z / r2);
  const L2 = Lx * Lx + Ly * Ly + Lz * Lz + 1e-9;
  const denom = cross2 + 0.32 * L2; // core ≈ 0.57 m
  const k = (s.gamma / (4 * Math.PI)) * Ldot / denom;
  out.x += k * cx; out.y += k * cy; out.z += k * cz;
}

function sourceSink(px, py, pz, x0, y0, z0, Q, ry, rz, out) {
  const dx = px - x0, dy = (py - y0) / ry, dz = (pz - z0) / rz;
  const r2 = dx * dx + dy * dy + dz * dz;
  const r = Math.sqrt(r2) + 1e-6;
  const k = Q / (4 * Math.PI * r2 * r);
  out.x += k * dx; out.y += k * dy / ry; out.z += k * dz / rz;
}

/** 机身：Rankine 偶极对（升力体机身近似）。
 * 强度标定：源汇 Q ≈ 4π·U·d² 使机头滞点附近 v≈k·U，
 * 原系数 0.5U 过弱 200×，导致流线笔直穿过——按几何半径显式标定。 */
function bodyField(px, py, pz, U, out) {
  const L = AC.length;
  const FOUR_PI = 4 * Math.PI;
  // 主体：源/汇各距机头/机尾 ~3m，k=0.62（不追求完全滞止，避免奇点过强）
  const qMain = FOUR_PI * U * 2.9 * 2.9 * 0.62;
  sourceSink(px, py, pz, -L * 0.32, 0, 0, qMain, 0.62, 0.78, out);
  sourceSink(px, py, pz, L * 0.30, 0, 0, -qMain, 0.62, 0.78, out);
  // 机背整流
  const qSpine = FOUR_PI * U * 0.55 * 0.55 * 0.6;
  sourceSink(px, py, pz, 0.6, 0.5, 0, qSpine, 0.5, 1.2, out);
  sourceSink(px, py, pz, 3.2, 0.45, 0, -qSpine, 0.5, 1.2, out);
  // 座舱
  const qCanopy = FOUR_PI * U * 0.45 * 0.45 * 0.6;
  sourceSink(px, py, pz, -3.8, 0.72, 0, qCanopy, 0.55, 0.62, out);
  sourceSink(px, py, pz, -2.9, 0.72, 0, -qCanopy, 0.55, 0.62, out);
}

/** 尾流亏损 + 双发喷流 + 跨音速激波带 */
function wakeAndShock(px, py, pz, U, out) {
  if (px > 3.4 && Math.abs(pz) < 6.4) {
    const decay = Math.exp(-Math.max(px - 4.4, 0) * 0.045);
    const dY = py - 0.08;
    out.x -= 0.16 * U * Math.exp(-dY * dY / 0.5) * decay * (1 - Math.abs(pz) / 7);
  }
  if (px > 8.2) {
    const r2 = (py * py) / 0.72 + (pz * pz) / 1.82;
    out.x -= 0.42 * U * Math.exp(-Math.max(px - 8.2, 0) * 0.05) * Math.exp(-r2);
  }
  for (const js of jetSrc) {
    const dx = px - js.x, dy = py - js.y, dz = pz - js.z;
    if (dx > -0.3 && dx < 26) {
      const rr = dy * dy + dz * dz;
      out.x += 0.55 * U * Math.exp(-rr / 0.405) * Math.exp(-Math.max(dx, 0) * 0.09);
    }
  }
  if (S.M > 0.85) {
    const k = Math.min((S.M - 0.85) / 0.2, 1.3);
    if (Math.abs(pz) < 6.2 && px > -1.8 && px < 4.6 && py > -0.2 && py < 3.4) {
      const xs = 1.6 + 0.35 * py;
      const sig = 1 / (1 + Math.exp(-(px - xs) / 0.22));
      out.x *= 1 - 0.20 * k * sig;
    }
  }
}

// —— 姿态（世界↔机体）——
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
export function setAttitude(pitchDeg, betaDeg, rollDeg) {
  const e = new THREE.Euler(
    -rollDeg * Math.PI / 180,
    betaDeg * Math.PI / 180,
    -pitchDeg * Math.PI / 180,
    'ZYX'
  );
  _q.setFromEuler(e);
  _qInv.copy(_q).invert();
}
export function getAttitudeQ() { return _q; }

const _vinfB = new THREE.Vector3();
export function freestream() {
  _vinfB.set(S.U, 0, 0).applyQuaternion(_qInv);
  return _vinfB;
}

/** 世界系解析速度场（流线积分 / 表面压力采样用） */
export function fieldWorld(x, y, z, out) {
  const pb = _v1.set(x, y, z).applyQuaternion(_qInv);
  const d = _v2.set(0, 0, 0);
  const U = Math.max(S.U, 1);
  bodyField(pb.x, pb.y, pb.z, U, d);
  for (let i = 0; i < horseshoes.length; i++) lineVortex(pb.x, pb.y, pb.z, horseshoes[i], d);
  for (let i = 0; i < trailingSegs.length; i++) lineVortex(pb.x, pb.y, pb.z, trailingSegs[i], d);
  for (let i = 0; i < levSegs.length; i++) lineVortex(pb.x, pb.y, pb.z, levSegs[i], d);
  wakeAndShock(pb.x, pb.y, pb.z, U, d);
  const vf = freestream();
  out.x = d.x + vf.x; out.y = d.y + vf.y; out.z = d.z + vf.z;
  return out;
}
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// —— 网格烘焙 ——
export const GRID = {
  x0: -16, x1: 16, y0: -6, y1: 6.5, z0: -7.2, z1: 7.2,
  nx: 76, ny: 38, nz: 38,
  vel: null, speed: null, vort: null,
  version: 0, baking: false, _row: 0,
};
GRID.n = GRID.nx * GRID.ny * GRID.nz;

export function startBake() { GRID.baking = true; GRID._row = 0; }

const _gv = new THREE.Vector3();
/** 每帧烘焙若干行；返回 true 表示本帧完成全部烘焙 */
export function bakeStep(rows = 4) {
  const g = GRID;
  if (!g.vel) {
    g.vel = new Float32Array(g.n * 3);
    g.speed = new Float32Array(g.n);
    g.vort = new Float32Array(g.n);
    g._row = 0;
  }
  const done = Math.min(g._row + rows, g.ny);
  const dx = (g.x1 - g.x0) / (g.nx - 1), dy = (g.y1 - g.y0) / (g.ny - 1), dz = (g.z1 - g.z0) / (g.nz - 1);
  for (let j = g._row; j < done; j++) {
    const y = g.y0 + j * dy;
    for (let k = 0; k < g.nz; k++) {
      const z = g.z0 + k * dz;
      for (let i = 0; i < g.nx; i++) {
        fieldWorld(g.x0 + i * dx, y, z, _gv);
        const idx = (j * g.nz + k) * g.nx + i;
        g.vel[idx * 3] = _gv.x; g.vel[idx * 3 + 1] = _gv.y; g.vel[idx * 3 + 2] = _gv.z;
        g.speed[idx] = Math.hypot(_gv.x, _gv.y, _gv.z);
      }
    }
  }
  g._row = done;
  if (done >= g.ny) {
    computeVortGrid();
    g.baking = false;
    g.version++;
    return true;
  }
  return false;
}

// fix: P0-1a  修正三个分量的偏导索引
// 索引约定：c=0 → u (x方向)，c=1 → v (y方向)，c=2 → w (z方向)
// ω_x = ∂w/∂y − ∂v/∂z
// ω_y = ∂u/∂z − ∂w/∂x
// ω_z = ∂v/∂x − ∂u/∂y
function computeVortGrid() {
  const g = GRID;
  const dx = (g.x1 - g.x0) / (g.nx - 1), dy = (g.y1 - g.y0) / (g.ny - 1), dz = (g.z1 - g.z0) / (g.nz - 1);
  const vi = (i, j, k, c) => {
    i = i < 0 ? 0 : i > g.nx - 1 ? g.nx - 1 : i;
    j = j < 0 ? 0 : j > g.ny - 1 ? g.ny - 1 : j;
    k = k < 0 ? 0 : k > g.nz - 1 ? g.nz - 1 : k;
    return g.vel[((j * g.nz + k) * g.nx + i) * 3 + c];
  };
  for (let j = 0; j < g.ny; j++) {
    for (let k = 0; k < g.nz; k++) {
      for (let i = 0; i < g.nx; i++) {
        // ∂w/∂y - ∂v/∂z
        const wx = (vi(i, j + 1, k, 2) - vi(i, j - 1, k, 2)) / (2 * dy)
                 - (vi(i, j, k + 1, 1) - vi(i, j, k - 1, 1)) / (2 * dz);
        // ∂u/∂z - ∂w/∂x
        const wy = (vi(i, j, k + 1, 0) - vi(i, j, k - 1, 0)) / (2 * dz)
                 - (vi(i + 1, j, k, 2) - vi(i - 1, j, k, 2)) / (2 * dx);
        // ∂v/∂x - ∂u/∂y
        const wz = (vi(i + 1, j, k, 1) - vi(i - 1, j, k, 1)) / (2 * dx)
                 - (vi(i, j + 1, k, 0) - vi(i, j - 1, k, 0)) / (2 * dy);
        g.vort[(j * g.nz + k) * g.nx + i] = Math.hypot(wx, wy, wz);
      }
    }
  }
}

// —— 三线性采样 ——
const _sc = { i: 0, j: 0, k: 0, fx: 0, fy: 0, fz: 0 };
function gridClamp(x, y, z) {
  const g = GRID;
  _sc.i = Math.floor(Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / (g.x1 - g.x0) * (g.nx - 1))));
  _sc.j = Math.floor(Math.max(0, Math.min(g.ny - 1.001, (y - g.y0) / (g.y1 - g.y0) * (g.ny - 1))));
  _sc.k = Math.floor(Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / (g.z1 - g.z0) * (g.nz - 1))));
  _sc.fx = Math.max(0, Math.min(g.nx - 1, (x - g.x0) / (g.x1 - g.x0) * (g.nx - 1))) - _sc.i;
  _sc.fy = Math.max(0, Math.min(g.ny - 1, (y - g.y0) / (g.y1 - g.y0) * (g.ny - 1))) - _sc.j;
  _sc.fz = Math.max(0, Math.min(g.nz - 1, (z - g.z0) / (g.z1 - g.z0) * (g.nz - 1))) - _sc.k;
}

export function sampleVel(x, y, z, out) {
  const g = GRID;
  if (!g.vel) { out.x = S.U; out.y = 0; out.z = 0; return out; }
  gridClamp(x, y, z);
  const { i, j, k, fx, fy, fz } = _sc;
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let dj = 0; dj < 2; dj++) for (let dk = 0; dk < 2; dk++) for (let di = 0; di < 2; di++) {
      const w = (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz) * (di ? fx : 1 - fx);
      v += w * g.vel[(((j + dj) * g.nz + (k + dk)) * g.nx + (i + di)) * 3 + c];
    }
    if (c === 0) out.x = v; else if (c === 1) out.y = v; else out.z = v;
  }
  return out;
}

export function sampleSpeed(x, y, z) {
  const g = GRID;
  if (!g.speed) return S.U;
  gridClamp(x, y, z);
  const { i, j, k, fx, fy, fz } = _sc;
  let v = 0;
  for (let dj = 0; dj < 2; dj++) for (let dk = 0; dk < 2; dk++) for (let di = 0; di < 2; di++) {
    const w = (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz) * (di ? fx : 1 - fx);
    v += w * g.speed[((j + dj) * g.nz + (k + dk)) * g.nx + (i + di)];
  }
  return v;
}

export function sampleVort(x, y, z) {
  const g = GRID;
  if (!g.vort) return 0;
  gridClamp(x, y, z);
  const { i, j, k, fx, fy, fz } = _sc;
  let v = 0;
  // fix: P0-2  索引公式错误。原 (k+dk)*g.nx + (i+di) 把 * g.nx 只乘在 k 上，
  // 等价于把 k 和 nx 当成同维度相加 —— 索引完全错乱，sampleVort 采样到错误位置。
  // 正确：((j+dj)*g.nz + (k+dk))*g.nx + (i+di)，与 sampleSpeed / sampleVel 一致。
  // 影响：模式 3 涡量图、模式 6 纹影局部梯度、picking.js 涡量探针全部数据错乱。
  for (let dj = 0; dj < 2; dj++) for (let dk = 0; dk < 2; dk++) for (let di = 0; di < 2; di++) {
    const w = (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz) * (di ? fx : 1 - fx);
    v += w * g.vort[((j + dj) * g.nz + (k + dk)) * g.nx + (i + di)];
  }
  return v;
}

/** 表面点压力系数（伯努利，可压缩修正） */
export function cpAt(x, y, z) {
  const sp = sampleSpeed(x, y, z);
  const ratio = sp / Math.max(S.U, 1);
  let cp = 1 - ratio * ratio;
  if (S.M > 0.3) cp *= 1 + 0.25 * Math.min(S.M, 1) * Math.abs(cp); // 粗略压缩性放大
  return cp;
}
