// 歼-35 舰载机程序化建模（章节三）—— 双发 · DSI 进气道 · 外倾双垂尾 · 全动平尾
// 舰载特征：弹射牵引杆 / 着舰尾钩 / 机翼折叠线。仅示意外形，不含任何内部结构。
import * as THREE from 'three';
import { S } from './state.js';

// fix: P2-1  AIRCRAFT 从 state.js 搬到 aircraft.js（aircraft 才是它的逻辑拥有者）
// 通过 state.js 重导出保持向后兼容，physics.js / flowfield.js / visualizers.js 无需改
// —— 材质 ——

// —— 机型数据库（公开资料外观数据估算，仅教育用途）——
export const AIRCRAFT = {
  name: 'J-35',
  nameCN: '歼-35 舰载机',
  length: 17.3,     // m
  span: 12.0,       // m（翼展）
  spanFolded: 7.4,  // 折叠后
  S: 45.0,          // 机翼参考面积 m²
  MAC: 4.0,         // 平均气动弦长 m
  AR: 3.2,          // 展弦比
  eOswald: 0.78,
  alphaStall: 33,   // 失速攻角（含涡升力）°
  CLalpha: 3.6,     // /rad
  CLmax: 1.65,
};
const AC = AIRCRAFT;   // 内部别名，与原代码兼容
function makePanelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  // 舰载灰蓝底色
  g.fillStyle = '#78828e'; g.fillRect(0, 0, 1024, 512);
  // 细微噪点（使用痕迹）
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * 0.05;
    g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(20,26,34,${a})`;
    g.fillRect(Math.random() * 1024, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // 蒙皮接缝（框位）
  g.strokeStyle = 'rgba(30,38,48,0.38)'; g.lineWidth = 1.2;
  for (let x = 40; x < 1024; x += 58 + (x % 3) * 6) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
  }
  for (let y = 30; y < 512; y += 66) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke();
  }
  // 检修口盖
  g.strokeStyle = 'rgba(30,38,48,0.30)'; g.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const x = 30 + Math.random() * 950, y = 20 + Math.random() * 470;
    const w = 24 + Math.random() * 60, h = 16 + Math.random() * 42;
    g.strokeRect(x, y, w, h);
  }
  // 低可视度机徽（灰阶圆标）
  g.save(); g.translate(300, 128); g.strokeStyle = 'rgba(40,48,60,0.55)'; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(40,48,60,0.45)';
  g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let panelTex = null;

export const MATS = {};
function buildMaterials() {
  if (MATS.built) return;
  panelTex = makePanelTexture();
  MATS.body = new THREE.MeshStandardMaterial({
    map: panelTex, metalness: 0.35, roughness: 0.55, envMapIntensity: 0.9, vertexColors: true,
  });
  MATS.wing = new THREE.MeshStandardMaterial({
    color: 0x7d8792, metalness: 0.32, roughness: 0.5, envMapIntensity: 0.85, vertexColors: true, flatShading: true,
  });
  MATS.wingSmooth = new THREE.MeshStandardMaterial({
    color: 0x7d8792, metalness: 0.3, roughness: 0.5, envMapIntensity: 0.85, vertexColors: true,
  });
  MATS.canopy = new THREE.MeshPhysicalMaterial({
    color: 0x6b5a22, metalness: 1.0, roughness: 0.1, transparent: true, opacity: 0.72,
    envMapIntensity: 2.2, clearcoat: 1, side: THREE.DoubleSide,
  });
  MATS.cockpit = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.9 });
  MATS.dark = new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.85, vertexColors: true });
  MATS.nozzle = new THREE.MeshStandardMaterial({ color: 0x34363c, metalness: 0.85, roughness: 0.4, vertexColors: true });
  MATS.steel = new THREE.MeshStandardMaterial({ color: 0x4a4e56, metalness: 0.7, roughness: 0.45, vertexColors: true });
  MATS.marking = new THREE.MeshStandardMaterial({ color: 0x565f6a, roughness: 0.7, vertexColors: true });
  MATS.built = true;
}

// —— 机身站位（棱线隐身截面 loft）——
// 每站：[x, top, bottom, halfWidth, chineY]
const STATIONS = [
  [-8.65, 0.02, -0.02, 0.05, 0.0],
  [-8.3, 0.16, -0.10, 0.20, 0.0],
  [-7.7, 0.38, -0.20, 0.38, -0.02],
  [-6.9, 0.60, -0.30, 0.52, -0.03],
  [-6.0, 0.76, -0.40, 0.64, -0.04],
  [-5.0, 0.86, -0.48, 0.74, -0.05],
  [-4.2, 0.72, -0.56, 0.92, -0.06],
  [-3.4, 0.60, -0.62, 1.12, -0.08],
  [-2.4, 0.56, -0.66, 1.30, -0.10],
  [-1.2, 0.56, -0.70, 1.44, -0.12],
  [0.4, 0.60, -0.72, 1.50, -0.14],
  [2.4, 0.66, -0.72, 1.50, -0.15],
  [4.4, 0.60, -0.68, 1.42, -0.14],
  [6.0, 0.50, -0.56, 1.26, -0.12],
  [7.4, 0.38, -0.42, 1.05, -0.10],
  [8.3, 0.28, -0.28, 0.84, -0.08],
  [8.65, 0.22, -0.22, 0.76, -0.07],
];

/** 单站截面轮廓（14 点：顶中 → 右上肩 → 右棱线 → 右下肩 → 底中 → 镜像左侧） */
function sectionPoints(st) {
  const [x, top, bot, w, cy] = st;
  const pts = [
    [0, top],
    [w * 0.5, top * 0.78],
    [w * 0.92, cy + top * 0.18],
    [w, cy],
    [w * 0.92, cy - Math.abs(bot) * 0.28],
    [w * 0.55, bot * 0.72],
    [0, bot],
    [-w * 0.55, bot * 0.72],
    [-w * 0.92, cy - Math.abs(bot) * 0.28],
    [-w, cy],
    [-w * 0.92, cy + top * 0.18],
    [-w * 0.5, top * 0.78],
  ];
  return pts.map(([z, y]) => [x, y, z]);
}

function loftFuselage() {
  const positions = [], uvs = [], indices = [];
  const rings = STATIONS.map(sectionPoints);
  const N = rings[0].length;
  for (let s = 0; s < rings.length; s++) {
    const v = s / (rings.length - 1);
    for (let i = 0; i < N; i++) {
      const p = rings[s][i];
      positions.push(p[0], p[1], p[2]);
      uvs.push(i / N, v * 2.0);
    }
  }
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < N; i++) {
      const a = s * N + i, b = s * N + (i + 1) % N;
      const c = (s + 1) * N + (i + 1) % N, d = (s + 1) * N + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  // 尾端封口
  const lastRing = rings[rings.length - 1];
  const centerIdx = positions.length / 3;
  positions.push(8.65, 0, 0); uvs.push(0.5, 1);
  for (let i = 0; i < N; i++) {
    const a = (rings.length - 1) * N + i, b = (rings.length - 1) * N + (i + 1) % N;
    indices.push(a, b, centerIdx);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  addVertexColors(geo);
  return geo;
}

function addVertexColors(geo) {
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3).fill(1);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

/** 通用翼面构建：outline 平面内 [x, y] 序列，法向厚度渐变 */
function buildFinLike(outline, thicknessRoot, thicknessTip, axis) {
  // outline: [[x,y]...] 逆时针；沿 outline 法向偏移形成上下表面
  const positions = [], indices = [], uvs = [];
  const n = outline.length;
  // 上下表面
  // fix: P1-4  删除死函数 push（原 const push = (arr, tri) => arr.push(...tri); 定义后未使用）
  const top = [], bot = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = outline[i];
    // 展向比例（用 y 归一）
    const tSpan = (y - outline[0][1]) / (outline[n - 1][1] - outline[0][1] || 1);
    const th = (thicknessRoot + (thicknessTip - thicknessRoot) * Math.max(0, Math.min(1, tSpan))) / 2;
    top.push([x, y, th]); bot.push([x, y, -th]);
  }
  const V = (p) => { positions.push(p[0], p[1], p[2]); };
  for (let i = 0; i < n; i++) { V(top[i]); uvs.push(i / n, 1); }
  for (let i = 0; i < n; i++) { V(bot[i]); uvs.push(i / n, 0); }
  for (let i = 1; i < n - 1; i++) {
    indices.push(i, i + 1, n + i + 1, i, n + i + 1, n + i); // 上表面
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(n + i, n + i + 1, i + 1, n + i, i + 1, i); // 下表面
  }
  // 前后缘封边（近似：直接连上下对应点形成窄条）
  for (let i = 0; i < n - 1; i++) {
    // 只封外侧轮廓边（前后缘），跳过根部/尖部直边
    indices.push(i, i + 1, n + i + 1);
    indices.push(i, n + i + 1, n + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  addVertexColors(geo);
  return geo;
}

/** 水平翼面（翼/平尾）：梯形 + 圆角前后缘，弦向 20 站、展向 14 站翼型厚度 */
function buildLiftingSurface(surf, tRoot, tTip, washoutDeg) {
  // fix: P0-1  上/下表面需各自携带 UV。原代码仅 push 上表面 UV，
  // 下表面 UV 缺失 —— 导致下表面纹理采样错乱（slice 截断后 uv 数组长度 < 顶点数 × 2）
  const positions = [], uvs = [], indices = [];
  const nChord = 16, nSpan = 14;
  // 翼型（相对弦长）：上表面 y+，下表面 y-
  const airfoil = (s) => {
    // s: 0(LE) → 1(TE)，简单对称翼型带弯度
    const th = 0.5 * Math.pow(Math.sin(Math.PI * Math.min(s, 1)), 0.62);
    const camber = 0.04 * Math.sin(Math.PI * s);
    return { up: camber + th * 0.5, dn: camber - th * 0.5 };
  };
  const ringTop = [], ringBot = [];
  const uvTop = [], uvBot = [];
  for (let j = 0; j <= nSpan; j++) {
    const t = j / nSpan;
    const z = surf.zRoot + t * (surf.zTip - surf.zRoot);
    const { le, c } = planformOf(surf, z);
    const twist = washoutDeg * t * Math.PI / 180;
    const th = tRoot + (tTip - tRoot) * t;
    const yBase = surf.yMid;
    for (let i = 0; i <= nChord; i++) {
      const s = i / nChord;
      const x = le + c * s;
      const a = airfoil(s);
      const yt = yBase + a.up * th + (x - le) * Math.sin(twist) * 0.15;
      const yb = yBase + a.dn * th + (x - le) * Math.sin(twist) * 0.15;
      ringTop.push([x, yt, z]);
      ringBot.push([x, yb, z]);
      uvTop.push(s * 2, t);
      uvBot.push(s * 2, 1 - t);    // 下表面：t 反向以避免镜像后纹理翻转
    }
  }
  const W = nChord + 1;
  const idx = (row, col) => row * W + col;
  // 上表面：先 push 顶点，再 push UV
  for (const p of ringTop) positions.push(p[0], p[1], p[2]);
  for (const u of uvTop) uvs.push(u);
  for (let j = 0; j < nSpan; j++) {
    for (let i = 0; i < nChord; i++) {
      const a = idx(j, i), b = idx(j, i + 1), c = idx(j + 1, i + 1), d = idx(j + 1, i);
      indices.push(a, b, c, a, c, d); // 上
    }
  }
  // 下表面（再复制一份反向）
  const total = ringTop.length;
  for (const p of ringBot) positions.push(p[0], p[1], p[2]);
  for (const u of uvBot) uvs.push(u);
  for (let j = 0; j < nSpan; j++) {
    for (let i = 0; i < nChord; i++) {
      const a = total + idx(j, i), b = total + idx(j, i + 1), c = total + idx(j + 1, i + 1), d = total + idx(j + 1, i);
      indices.push(a, c, b, a, d, c); // 下（反向绕序）
    }
  }
  // 前后缘封条
  for (let j = 0; j < nSpan; j++) {
    const le1 = idx(j, 0), le2 = idx(j + 1, 0);
    indices.push(le1, total + le2, total + le1);
    indices.push(le1, le2, total + le2);
    const te1 = idx(j, nChord), te2 = idx(j + 1, nChord);
    indices.push(te1, total + te1, total + te2);
    indices.push(te1, total + te2, te2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  addVertexColors(geo);
  return geo;
}

function planformOf(surf, z) {
  const tt = Math.max(0, Math.min(1, (Math.abs(z) - surf.zRoot) / (surf.zTip - surf.zRoot)));
  const le = surf.xLERoot + surf.leSlope * tt * (surf.zTip - surf.zRoot);
  const c = surf.cRoot + (surf.cTip - surf.cRoot) * tt;
  return { le, c };
}

// —— DSI 进气道（caret 收口 + 鼓包）——
function buildInlet(side) {
  const grp = new THREE.Group();
  // 外罩：六棱台 loft
  const shape = new THREE.Shape();
  const pts = [[-2.0, 0.42], [-0.6, 0.5], [0.9, 0.34], [0.9, -0.34], [-0.6, -0.62], [-2.0, -0.5]];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
  geo.rotateY(Math.PI / 2); // depth → -X 方向进深
  addVertexColors(geo);
  const duct = new THREE.Mesh(geo, MATS.wingSmooth);
  duct.position.set(-1.0, -0.12, side * 1.52);
  grp.add(duct);
  // DSI 鼓包（半椭球）
  const bump = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), MATS.wingSmooth);
  bump.scale.set(1.35, 0.62, 0.42);
  bump.position.set(-3.15, -0.02, side * 1.22);
  bump.rotation.y = side * 0.35;
  addVertexColors(bump.geometry);
  grp.add(bump);
  // 进气口唇缘（深色内衬）
  const lip = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 6), MATS.dark);
  lip.rotation.y = Math.PI / 2;
  lip.scale.set(1, 0.62, 0.85);
  lip.position.set(-3.05, -0.12, side * 1.52);
  grp.add(lip);
  return grp;
}

// —— 锯齿喷口（双发）——
function buildNozzle() {
  const grp = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.40, 1.25, 14, 1, true), MATS.nozzle);
  cyl.rotation.z = Math.PI / 2;
  cyl.position.x = 7.95;
  addVertexColors(cyl.geometry);
  grp.add(cyl);
  // 锯齿修形环
  const teeth = 12;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.55) / teeth) * Math.PI * 2;
    const r = 0.44;
    const g = new THREE.BufferGeometry();
    const p1 = [8.58, Math.sin(a0) * r, Math.cos(a0) * r];
    const p2 = [8.58, Math.sin(a1) * r, Math.cos(a1) * r];
    const p3 = [8.42, (Math.sin(a0) + Math.sin(a1)) / 2 * r * 1.04, (Math.cos(a0) + Math.cos(a1)) / 2 * r * 1.04];
    g.setAttribute('position', new THREE.Float32BufferAttribute([...p1, ...p2, ...p3], 3));
    g.computeVertexNormals();
    addVertexColors(g);
    const t = new THREE.Mesh(g, MATS.nozzle);
    t.material = MATS.nozzle;
    grp.add(t);
  }
  // 内部暗盘
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.40, 14), new THREE.MeshStandardMaterial({ color: 0x14090a, roughness: 0.9 }));
  cap.rotation.y = Math.PI / 2;
  cap.position.x = 7.36;
  grp.add(cap);
  return grp;
}

// —— 着舰尾钩 ——
function buildHook() {
  const grp = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.22), MATS.steel);
  arm.position.set(7.35, -0.86, 0);
  arm.rotation.z = -0.18;
  addVertexColors(arm.geometry);
  grp.add(arm);
  const hookCurve = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.075, 8, 12, Math.PI * 0.9), MATS.steel);
  hookCurve.position.set(8.2, -1.02, 0);
  hookCurve.rotation.y = Math.PI / 2;
  addVertexColors(hookCurve.geometry);
  grp.add(hookCurve);
  return grp;
}

// —— 弹射牵引杆 ——
function buildLaunchBar() {
  const grp = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.5, 8), MATS.steel);
  bar.rotation.z = Math.PI / 2 + 0.35;
  bar.position.set(-5.15, -0.98, 0);
  addVertexColors(bar.geometry);
  grp.add(bar);
  const T = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.5), MATS.steel);
  T.position.set(-5.85, -0.68, 0);
  addVertexColors(T.geometry);
  grp.add(T);
  return grp;
}

// —— 主装配 ——
// fix: P0-4  翼面几何常量统一源（被 flowfield.js 引用）
export const WING_DEF = { zRoot: 1.25, zTip: 6.0, xLERoot: -1.2, leSlope: 0.781, cRoot: 5.6, cTip: 1.7, yMid: 0.02 };
export const STAB_DEF = { zRoot: 1.05, zTip: 4.25, xLERoot: 4.3, leSlope: 0.9, cRoot: 2.6, cTip: 1.15, yMid: 0.0 };
export const VTAIL_DEF = { zRoot: 0.95, xLERoot: 3.1, cRoot: 4.0, cTip: 1.5, tipY: 3.55, cant: 25 * Math.PI / 180 };

export const PARTS = {};
export const pickMeshes = [];
// fix: P1-3  去除 elevatorL/R 死变量（未被赋值也未被读取）
let aircraftGroup, elevatorPivotL, elevatorPivotR;

function regPart(obj, id) {
  // 部件级材质克隆（悬停高亮按部件隔离）
  const mats = new Set();
  obj.traverse?.((o) => {
    if (o.isMesh) {
      o.userData.partId = id;
      if (o.material && !o.material._keepShared) {
        o.material = o.material.clone();
        o.material._keepShared = true;
      }
      mats.add(o.material);
      pickMeshes.push(o);
    }
  });
  if (obj.isMesh && !pickMeshes.includes(obj)) {
    obj.userData.partId = id;
    pickMeshes.push(obj);
  }
  PARTS[id] = obj;
}

export function buildAircraft(scene) {
  buildMaterials();
  // fix: P1-1  pickMeshes / PARTS 累积——多次 buildAircraft 会重复 push 与上一次的 mesh
  pickMeshes.length = 0;
  for (const k of Object.keys(PARTS)) delete PARTS[k];
  aircraftGroup = new THREE.Group();
  aircraftGroup.position.set(0, 1.1, 0); // 风洞测试段中心（重心）

  // 机身
  const fus = new THREE.Mesh(loftFuselage(), MATS.body);
  regPart(fus, 'fuselage');
  aircraftGroup.add(fus);

  // 机背整流（脊线）
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 5.2, 6, 10), MATS.wingSmooth);
  spine.rotation.z = Math.PI / 2;
  spine.scale.set(1, 0.62, 1.5);
  spine.position.set(1.6, 0.72, 0);
  addVertexColors(spine.geometry);
  regPart(spine, 'spine');
  aircraftGroup.add(spine);

  // 座舱
  const canopyGeo = new THREE.SphereGeometry(1, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const canopy = new THREE.Mesh(canopyGeo, MATS.canopy);
  canopy.scale.set(1.65, 0.72, 0.78);
  canopy.position.set(-3.75, 0.62, 0);
  canopy.rotation.z = -0.06;
  // fix: P2-3  删除 PARTS.canopy = canopy 重复赋值。regPart 内已 PARTS[id] = obj，
  // 外层再赋一次是冗余的（且若 buildAircraft 被调用两次，外层赋值会引用旧 mesh）。
  regPart(canopy, 'canopy');
  aircraftGroup.add(canopy);
  // 座舱剪影
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.5), MATS.cockpit);
  seat.position.set(-3.4, 0.72, 0);
  seat.rotation.z = 0.12;
  aircraftGroup.add(seat);

  // DSI 进气道 ×2
  for (const side of [1, -1]) {
    const inlet = buildInlet(side);
    regPart(inlet, side > 0 ? 'inletR' : 'inletL');
    PARTS[side > 0 ? 'inletR' : 'inletL'] = inlet;
    aircraftGroup.add(inlet);
  }

  // 主翼 ×2（含舰载折叠整流罩）
  for (const side of [1, -1]) {
    const wgeo = buildLiftingSurface(WING_DEF, 0.34, 0.09, -2.2);
    if (side < 0) mirrorGeometryZ(wgeo);
    const wing = new THREE.Mesh(wgeo, MATS.wing);
    regPart(wing, side > 0 ? 'wingR' : 'wingL');
    PARTS[side > 0 ? 'wingR' : 'wingL'] = wing;
    aircraftGroup.add(wing);
    // 折叠线整流罩（约 55% 半展长 z≈3.86）
    for (const [x, len] of [[-0.1, 0.85], [3.75, 0.7]]) {
      const fair = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.34), MATS.wing);
      const pp = planformOf(WING_DEF, 3.86);
      fair.position.set(x > 0 ? pp.le + 0.82 * pp.c : pp.le + 0.18 * pp.c, 0.02, side * 3.86);
      addVertexColors(fair.geometry);
      regPart(fair, side > 0 ? 'foldR' : 'foldL');
      aircraftGroup.add(fair);
    }
  }

  // 全动平尾 ×2（δe 联动）
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(5.15, 0.0, side * 1.05);
    const sgeo = buildLiftingSurface({ ...STAB_DEF, zRoot: 0 }, 0.2, 0.06, 0);
    // 平移使铰点位于枢轴
    sgeo.translate(-5.15, 0, -side * 1.05);
    if (side < 0) mirrorGeometryZ(sgeo);
    const stab = new THREE.Mesh(sgeo, MATS.wing);
    regPart(stab, side > 0 ? 'stabR' : 'stabL');
    PARTS[side > 0 ? 'stabR' : 'stabL'] = stab;
    pivot.add(stab);
    aircraftGroup.add(pivot);
    if (side > 0) elevatorPivotR = pivot; else elevatorPivotL = pivot;
  }

  // 外倾双垂尾 ×2
  for (const side of [1, -1]) {
    const outline = [
      [3.1, 0.0], [3.9, 0.5], [4.9, 1.6], [5.9, 2.6], [6.45, 2.6], [6.6, 2.55], [7.15, 1.4], [7.25, 0.0],
    ];
    const vgeo = buildFinLike(outline, 0.24, 0.07);
    const fin = new THREE.Mesh(vgeo, MATS.wing);
    const cant = 25 * Math.PI / 180;
    fin.rotation.x = side * cant;
    fin.position.set(0, 0.85, side * 0.98);
    regPart(fin, side > 0 ? 'vtailR' : 'vtailL');
    PARTS[side > 0 ? 'vtailR' : 'vtailL'] = fin;
    aircraftGroup.add(fin);
  }

  // 喷口 ×2
  for (const side of [1, -1]) {
    const nz = buildNozzle();
    nz.position.set(0, 0.05, side * 0.72);
    regPart(nz, side > 0 ? 'nozzleR' : 'nozzleL');
    PARTS[side > 0 ? 'nozzleR' : 'nozzleL'] = nz;
    aircraftGroup.add(nz);
  }

  // 舰载：尾钩 + 弹射杆
  const hook = buildHook();
  regPart(hook, 'hook');
  PARTS.hook = hook;
  aircraftGroup.add(hook);
  const lb = buildLaunchBar();
  regPart(lb, 'launchBar');
  PARTS.launchBar = lb;
  aircraftGroup.add(lb);

  scene.add(aircraftGroup);
  return aircraftGroup;
}

function mirrorGeometryZ(geo) {
  // fix: P0-2  原代码只 swap (a, b) 不足以反转面绕序
  // 镜像 z 后三角形的 (a,b,c) 变为 (a,b,c')，其中 c' = c 镜像。
  // 法向量反向需交换 a 与 c（而不是 a 与 b）来让三角形顶点顺序完全反转。
  // 因为顶点不共享（buildLiftingSurface 每个面元独立），computeVertexNormals
  // 只基于单三角形，无法靠法向修正绕序，必须显式反转面索引。
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -pos.getZ(i));
  const idx = geo.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), c = idx.getX(i + 2);
      idx.setX(i, c); idx.setX(i + 2, a);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** 平尾偏转联动（+δe 后缘下偏 → 抬头 → CL↑）
 *  与 physics.js liftCoeff（+δe → CL↑）和 flowfield.js γT（+δe → 同向环量）保持一致
 *  绕 z 轴正向旋转让 y>0 顶点向 +x 方向偏 → 后缘向下、抬头
 */
export function setElevator(deg) {
  const r = deg * Math.PI / 180;
  if (elevatorPivotL) elevatorPivotL.rotation.z = r;
  if (elevatorPivotR) elevatorPivotR.rotation.z = r;
}

export function getAircraftGroup() { return aircraftGroup; }
