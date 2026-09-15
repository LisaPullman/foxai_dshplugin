// 七种可视化模式（章节五）—— 流线 / 烟线 / 粒子 / 涡流 / 压力 / 速度 / 纹影
import * as THREE from 'three';
import { S, AIRCRAFT as AC, emit } from './state.js';
import { GRID, fieldWorld, sampleVel, sampleSpeed, sampleVort, cpAt } from './flowfield.js';
import { pickMeshes } from './aircraft.js';
// fix: P1-6  共享涡启动 α 阈值常量，避免四处硬编码漂移
import { AERO } from './physics.js';

// —— 速度比色标（0.35 → 1.5，蓝→青→绿→黄→红）——
const LUT_STOPS = [
  [0.35, 0.06, 0.19, 0.66], [0.55, 0.00, 0.45, 1.00], [0.75, 0.00, 0.85, 0.72],
  [1.00, 0.55, 0.90, 0.00], [1.25, 1.00, 0.60, 0.00], [1.50, 1.00, 0.13, 0.06],
];
export function speedColor(ratio, out) {
  const r = Math.max(0.35, Math.min(1.5, ratio));
  for (let i = 0; i < LUT_STOPS.length - 1; i++) {
    const a = LUT_STOPS[i], b = LUT_STOPS[i + 1];
    if (r <= b[0]) {
      const t = (r - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * t;
      out[1] = a[2] + (b[2] - a[2]) * t;
      out[2] = a[3] + (b[3] - a[3]) * t;
      return out;
    }
  }
  out[0] = 1; out[1] = 0.13; out[2] = 0.06;
  return out;
}

/** Cp → 颜色（蓝=低压吸力面，红=高压） */
function cpColor(cp, out) {
  const t = Math.max(-1, Math.min(1, cp / 1.6)); // -1..1
  if (t < 0) { // 低压：白→蓝
    const k = -t;
    out[0] = 1 - k * 0.85; out[1] = 1 - k * 0.45; out[2] = 1;
  } else { // 高压：白→红
    out[0] = 1; out[1] = 1 - t * 0.8; out[2] = 1 - t * 0.85;
  }
  return out;
}

// ============ 粒子系统（烟线 / 粒子示踪 / 涡流共用） ============
const MAX_PARTICLES = 60000;
const COLORMODE_GLSL = `
  vec3 lut(float r) {
    r = clamp(r, 0.35, 1.5);
    vec3 c1 = vec3(0.06,0.19,0.66), c2 = vec3(0.0,0.45,1.0), c3 = vec3(0.0,0.85,0.72);
    vec3 c4 = vec3(0.55,0.90,0.0), c5 = vec3(1.0,0.60,0.0), c6 = vec3(1.0,0.13,0.06);
    if (r < 0.55) return mix(c1, c2, (r-0.35)/0.2);
    if (r < 0.75) return mix(c2, c3, (r-0.55)/0.2);
    if (r < 1.0) return mix(c3, c4, (r-0.75)/0.25);
    if (r < 1.25) return mix(c4, c5, (r-1.0)/0.25);
    return mix(c5, c6, (r-1.25)/0.25);
  }`;

class ParticleField {
  constructor(scene) {
    this.count = MAX_PARTICLES;
    this.positions = new Float32Array(this.count * 3);
    this.aSpeed = new Float32Array(this.count);
    this.aVort = new Float32Array(this.count);
    this.ages = new Float32Array(this.count);
    this.seeds = []; // 种子区域（含权重）
    for (let i = 0; i < this.count; i++) this.respawn(i, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(this.aSpeed, 1));
    geo.setAttribute('aVort', new THREE.BufferAttribute(this.aVort, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSize: { value: 3.2 }, uColorMode: { value: 1 },
        uOpacity: { value: 0.9 }, uSoft: { value: 0.0 },
      },
      vertexShader: `
        attribute float aSpeed; attribute float aVort;
        uniform float uTime, uSize, uColorMode;
        varying float vSpeed; varying float vVort;
        void main() {
          vSpeed = aSpeed; vVort = aVort;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (140.0 / max(-mv.z, 2.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision highp float;
        uniform float uColorMode, uOpacity, uTime, uSoft;
        varying float vSpeed; varying float vVort;
        ${COLORMODE_GLSL}
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          // fix: P2-1  把 alpha<0.01 的 discard 阈值放宽到 0.005，并把 uOpacity
          // 乘到 alpha 上 —— 接近 0 的像素自然 blend 成不可见，不必强行 discard
          // （discard 会破坏 MSAA 边缘平滑度）。0.005 阈值仅剔除完全无贡献像素。
          // 注意：本注释位于 GLSL 源码内嵌于 JS 模板字符串，禁反引号！
          float alpha = uSoft > 0.5 ? smoothstep(0.5, 0.05, d) * 0.16
                                    : smoothstep(0.5, 0.32, d);
          alpha *= uOpacity;
          if (alpha < 0.005) discard;
          vec3 col;
          if (uColorMode < 0.5) col = vec3(0.95, 0.97, 1.0);           // 烟线：白
          else if (uColorMode < 1.5) col = lut(vSpeed);                // 粒子：速度比
          else col = mix(vec3(0.1,0.2,0.3), vec3(1.0,0.45,0.1), clamp(vVort/60.0, 0.0, 1.0)); // 涡量
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._v = new THREE.Vector3();
  }

  respawn(i, initial) {
    // 上游播种：环绕机身中线加密
    let y, z;
    if (Math.random() < 0.62) { y = (Math.random() * 2 - 1) * 3.6; z = (Math.random() * 2 - 1) * 5.2; }
    else { y = (Math.random() * 2 - 1) * 5.6; z = (Math.random() * 2 - 1) * 6.8; }
    this.positions[i * 3] = -14.5 + Math.random() * (initial ? 44 : 1.5);
    this.positions[i * 3 + 1] = y + 1.1;
    this.positions[i * 3 + 2] = z;
    this.ages[i] = Math.random() * 24;
  }

  update(dt) {
    const active = Math.floor(MAX_PARTICLES * S.particlePct / 100);
    const vis = S.visRate;
    const tu = S.Tu / 100;
    const geo = this.points.geometry;
    this.mat.uniforms.uTime.value += dt;
    for (let i = 0; i < this.count; i++) {
      if (i >= active) { this.positions[i * 3 + 1] = 9999; continue; }
      let x = this.positions[i * 3], y = this.positions[i * 3 + 1], z = this.positions[i * 3 + 2];
      sampleVel(x, y, z, this._v);
      // 湍流脉动
      if (tu > 0.001) {
        this._v.x += (Math.random() - 0.5) * tu * 26;
        this._v.y += (Math.random() - 0.5) * tu * 26;
        this._v.z += (Math.random() - 0.5) * tu * 26;
      }
      x += this._v.x * dt * vis;
      y += this._v.y * dt * vis;
      z += this._v.z * dt * vis;
      this.ages[i] += dt * vis;
      const sp = Math.hypot(this._v.x, this._v.y, this._v.z);
      if (x > 22 || Math.abs(y) > 7 || Math.abs(z) > 8 || this.ages[i] > 26) {
        this.respawn(i, false);
      } else {
        this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
        this.aSpeed[i] = sp / Math.max(S.U, 1);
        this.aVort[i] = sampleVort(x, y, z);
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSpeed.needsUpdate = true;
    geo.attributes.aVort.needsUpdate = true;
    geo.setDrawRange(0, this.count);
  }
}

// ============ 流线（模式 0） ============
const MAX_LINES = 320;
const MAX_SEGS = 40;
class Streamlines {
  constructor(scene) {
    this.geo = new THREE.BufferGeometry();
    const verts = MAX_LINES * MAX_SEGS * 2;
    this.positions = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 3);
    this.progs = new Float32Array(verts);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aProg', new THREE.BufferAttribute(this.progs, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.9 } },
      vertexShader: `
        attribute float aProg; varying vec3 vColor; varying float vProg;
        void main() {
          vColor = color; vProg = aProg;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime, uOpacity;
        varying vec3 vColor; varying float vProg;
        void main() {
          float pulse = pow(fract(vProg * 2.2 - uTime * 0.28), 6.0);
          vec3 c = vColor * (0.5 + 0.85 * pulse);
          gl_FragColor = vec4(c, uOpacity * (0.35 + 0.65 * pulse));
        }`,
      vertexColors: true, transparent: true, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this._dirty = true;
    this._cursor = 0;
    this._v = new THREE.Vector3();
    this._c = [0, 0, 0];
  }

  markDirty() { this._dirty = true; this._cursor = 0; }

  // 分帧重建（每帧 48 条）
  rebuildChunk() {
    const segs = Math.max(4, Math.min(40, S.streamSegs));
    // 自适应步长：无论段数多少，积分总长度恒为 34 m（贯穿整个测试段）
    // 原固定 ds=0.8 时默认 18 段只能推进 14.4 m，流线到机头就截断——绕流完全看不到
    const ds = 34 / segs;
    let n = 0;
    while (this._cursor < MAX_LINES && n < 48) {
      const li = this._cursor++;
      n++;
      // 种子：上游 X 平面（环绕机身加密）
      const dense = (li % 5) < 3;
      const y = (dense ? (Math.random() * 2 - 1) * 3.8 : (Math.random() * 2 - 1) * 5.5) + 1.1;
      const z = dense ? (Math.random() * 2 - 1) * 5.6 : (Math.random() * 2 - 1) * 6.9;
      let px = -12.5, py = y, pz = z;
      const base = li * MAX_SEGS * 2;
      for (let s = 0; s < segs; s++) {
        // RK2 中点法
        fieldWorld(px, py, pz, this._v);
        const mx = px + this._v.x * ds * 0.5, my = py + this._v.y * ds * 0.5, mz = pz + this._v.z * ds * 0.5;
        fieldWorld(mx, my, mz, this._v);
        const sp = Math.hypot(this._v.x, this._v.y, this._v.z);
        const ratio = sp / Math.max(S.U, 1);
        speedColor(ratio, this._c);
        const nx = px + this._v.x * ds, ny = py + this._v.y * ds, nz = pz + this._v.z * ds;
        const i0 = (base + s * 2) * 3, i1 = (base + s * 2 + 1) * 3;
        this.positions[i0] = px; this.positions[i0 + 1] = py; this.positions[i0 + 2] = pz;
        this.positions[i1] = nx; this.positions[i1 + 1] = ny; this.positions[i1 + 2] = nz;
        for (const ii of [i0, i1]) {
          this.colors[ii] = this._c[0]; this.colors[ii + 1] = this._c[1]; this.colors[ii + 2] = this._c[2];
        }
        this.progs[base + s * 2] = s / segs;
        this.progs[base + s * 2 + 1] = (s + 1) / segs;
        px = nx; py = ny; pz = nz;
        if (Math.abs(py) > 8 || Math.abs(pz) > 8.5 || px > 20) {
          // 线终止：剩余段折叠到末点
          for (let s2 = s + 1; s2 < segs; s2++) {
            const j0 = (base + s2 * 2) * 3;
            this.positions[j0] = px; this.positions[j0 + 1] = py; this.positions[j0 + 2] = pz;
            this.positions[j0 + 3] = px; this.positions[j0 + 4] = py; this.positions[j0 + 5] = pz;
          }
          break;
        }
      }
      // 未用段折叠
      for (let s2 = segs; s2 < MAX_SEGS; s2++) {
        const j0 = (base + s2 * 2) * 3;
        this.positions[j0] = 0; this.positions[j0 + 1] = 9999; this.positions[j0 + 2] = 0;
        this.positions[j0 + 3] = 0; this.positions[j0 + 4] = 9999; this.positions[j0 + 5] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.aProg.needsUpdate = true;
    if (this._cursor >= MAX_LINES) this._dirty = false;
  }

  update(dt) {
    this.mat.uniforms.uTime.value += dt * S.visRate;
    if (this._dirty) this.rebuildChunk();
  }
}

// ============ 涡核螺旋带（模式 3） ============
class VortexCores {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.ribbons = [];
    this._built = false;
  }

  build() {
    // 清空
    for (const r of this.ribbons) {
      r.line.geometry.dispose();
      this.group.remove(r.line);
    }
    this.ribbons = [];
    const cores = [];
    // 翼尖涡（左右）
    for (const s of [1, -1]) {
      cores.push({
        pts: [[2.8, 0.1, s * 5.85], [8, 0.0, s * 5.5], [16, -0.35, s * 5.1], [30, -0.7, s * 4.7]],
        strength: Math.min(Math.abs(S.aero.CL || 0.3) / 1.2, 1.2),
        color: [1.0, 0.62, 0.05],
      });
    }
    // 脱体涡（大攻角）
    if (S.alpha > AERO.VORTEX_ALPHA_START) {
      const k = Math.min((S.alpha - AERO.VORTEX_ALPHA_START) / (AERO.VORTEX_ALPHA_FULL - AERO.VORTEX_ALPHA_START), 1.2);
      for (const s of [1, -1]) {
        cores.push({
          pts: [[-1.6, 0.5, s * 1.95], [1.0, 0.85, s * 2.2], [3.6, 1.35, s * 2.55], [8, 1.6, s * 2.8], [16, 1.5, s * 2.9]],
          strength: k,
          color: [0.1, 0.85, 1.0],
        });
      }
    }
    const NPT = 160;
    for (const core of cores) {
      const positions = new Float32Array(NPT * 3);
      const colors = new Float32Array(NPT * 3);
      const phases = new Float32Array(NPT);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uStrength: { value: core.strength } },
        vertexShader: `
          attribute float aPhase; varying vec3 vColor; varying float vPhase;
          void main() { vColor = color; vPhase = aPhase;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uTime, uStrength; varying vec3 vColor; varying float vPhase;
          void main() {
            float rot = fract(uTime * 0.5 + vPhase * 3.0);
            float pulse = pow(0.5 + 0.5 * sin(rot * 6.2831), 2.0);
            gl_FragColor = vec4(vColor * (0.4 + 1.2 * pulse * uStrength), 0.5 + 0.4 * pulse);
          }`,
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.group.add(line);
      // 填充静态螺旋（相位随时间在 shader 中旋转视觉脉冲）
      for (let i = 0; i < NPT; i++) {
        const t = i / (NPT - 1);
        const p = samplePath(core.pts, t);
        const rad = 0.32 + 0.5 * t;
        const ang = t * 26;
        positions[i * 3] = p[0] + Math.cos(ang) * rad * 0.3;
        positions[i * 3 + 1] = p[1] + Math.sin(ang) * rad;
        positions[i * 3 + 2] = p[2] + Math.cos(ang) * rad * 0.8;
        colors[i * 3] = core.color[0]; colors[i * 3 + 1] = core.color[1]; colors[i * 3 + 2] = core.color[2];
        phases[i] = t;
      }
      geo.attributes.position.needsUpdate = true;
      this.ribbons.push({ line, mat });
    }
    this._built = true;
  }

  update(dt, t) {
    if (S.mode === 3) {
      if (this._needsRebuild === undefined || this._lastAlpha !== S.alpha || this._lastCL !== (S.aero.CL | 0)) {
        this.build();
        this._lastAlpha = S.alpha; this._lastCL = S.aero.CL | 0;
      }
      for (const r of this.ribbons) r.mat.uniforms.uTime.value += dt * S.visRate;
    }
  }
}

function samplePath(pts, t) {
  const segs = pts.length - 1;
  const f = t * segs;
  const i = Math.min(Math.floor(f), segs - 1);
  const lt = f - i;
  const a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * lt, a[1] + (b[1] - a[1]) * lt, a[2] + (b[2] - a[2]) * lt];
}

// ============ 截面查看器（模式 5 速度云图 / 模式 6 纹影） ============
class SliceViewer {
  constructor(scene) {
    this.W = 240; this.H = 120;
    this.data = new Uint8Array(this.W * this.H * 4);
    this.texture = new THREE.DataTexture(this.data, this.W, this.H, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.planeMat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.planeMat);
    this.plane.visible = false;
    scene.add(this.plane);
    this._lastVersion = -1;
    this._c = [0, 0, 0];
  }

  updateTexture() {
    const W = this.W, H = this.H;
    const horizontal = S.sliceHorizontal;
    // 平面范围
    let ex, ey, ox, oy;
    if (horizontal) { ex = 30; ey = 13.6; ox = 0; oy = 1.25 + S.slicePos * 5.0; }
    else { ex = 13.2; ey = 12.8; ox = S.slicePos * 13; oy = 1.1; }
    const useSchlieren = S.mode === 6; // 模式 6 固定纹影；模式 5 固定速度云图
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const u = i / (W - 1) - 0.5, v = j / (H - 1) - 0.5;
        const idx = (j * W + i) * 4;
        let x, y, z;
        if (horizontal) {
          x = u * ex; y = oy; z = v * ey;           // XZ 水平截面
        } else {
          x = ox; y = oy + v * ey; z = u * ex;      // YZ 竖直横流截面
        }
        const sp = sampleSpeed(x, y, z);
        const ratio = sp / Math.max(S.U, 1);
        if (!useSchlieren) {
          speedColor(ratio, this._c);
          this.data[idx] = this._c[0] * 255; this.data[idx + 1] = this._c[1] * 255; this.data[idx + 2] = this._c[2] * 255;
          this.data[idx + 3] = 235;
        } else {
          // 纹影：|∇速度| 灰度（密度梯度代理），跨音速增强
          const gx = sampleSpeed(x + 0.25, y, z) - sampleSpeed(x - 0.25, y, z);
          const gy = sampleSpeed(x, y + 0.25, z) - sampleSpeed(x, y - 0.25, z);
          const gz = sampleSpeed(x, y, z + 0.25) - sampleSpeed(x, y, z - 0.25);
          let g = Math.hypot(gx, gy, gz) / Math.max(S.U, 1);
          g *= 1 + 6 * Math.max(S.M - 0.8, 0);
          const val = Math.max(0, 1 - g * 9); // 反相：梯度处显暗纹
          this.data[idx] = val * 255; this.data[idx + 1] = val * 255; this.data[idx + 2] = val * 255;
          this.data[idx + 3] = 245;
        }
      }
    }
    this.texture.needsUpdate = true;
    // 平面几何摆位
    if (horizontal) {
      this.plane.scale.set(ex, ey, 1);
      this.plane.rotation.set(-Math.PI / 2, 0, 0);
      this.plane.position.set(0, oy, 0);
    } else {
      this.plane.scale.set(ex, ey, 1);
      this.plane.rotation.set(0, 0, 0);
      this.plane.position.set(ox, oy, 0);
    }
  }

  update() {
    if (S.mode === 5 || S.mode === 6) {
      this.plane.visible = true;
      this.planeMat.opacity = S.mode === 6 ? 0.96 : 0.9;
      if (this._lastVersion !== GRID.version || this._lastPos !== S.slicePos || this._lastType !== S.sliceType || this._lastHoriz !== S.sliceHorizontal) {
        this.updateTexture();
        this._lastVersion = GRID.version; this._lastPos = S.slicePos;
        this._lastType = S.sliceType; this._lastHoriz = S.sliceHorizontal;
      }
    } else {
      this.plane.visible = false;
    }
  }
}

// ============ 表面压力云图（模式 4） ============
class PressurePainter {
  constructor() {
    this._lastVersion = -1;
    this._c = [0, 0, 0];
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }
  paint() {
    let cpMax = -9, cpMin = 9;
    for (const mesh of pickMeshes) {
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const col = geo.attributes.color;
      if (!pos || !nor || !col) continue;
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) {
        this._p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        this._n.fromBufferAttribute(nor, i).transformDirection(mesh.matrixWorld);
        // 沿法向外偏移采样（避开自遮蔽）
        this._p.addScaledVector(this._n, 0.35);
        const cp = cpAt(this._p.x, this._p.y, this._p.z);
        cpColor(cp, this._c);
        col.setXYZ(i, this._c[0], this._c[1], this._c[2]);
        if (cp > cpMax) cpMax = cp;
        if (cp < cpMin) cpMin = cp;
      }
      col.needsUpdate = true;
    }
    const q = 0.5 * S.density * S.U * S.U / 1000; // kPa
    S.aero.pMax = S.pStatic + q * cpMax;
    S.aero.pMin = S.pStatic + q * cpMin;
    emit('aero');
  }
  clear() {
    for (const mesh of pickMeshes) {
      const col = mesh.geometry.attributes.color;
      if (!col) continue;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, 1, 1, 1);
      col.needsUpdate = true;
    }
  }
  update() {
    if (S.mode === 4) {
      if (this._lastVersion !== GRID.version) { this.paint(); this._lastVersion = GRID.version; }
    } else if (this._lastVersion !== -1) {
      this.clear();
      this._lastVersion = -1;
      S.aero.pMax = 0; S.aero.pMin = 0;
    }
  }
}

// ============ 管理器 ============
export class Visualizers {
  constructor(scene) {
    this.particles = new ParticleField(scene);
    this.streamlines = new Streamlines(scene);
    this.cores = new VortexCores(scene);
    this.slice = new SliceViewer(scene);
    this.pressure = new PressurePainter();
    this.applyMode();
  }
  applyMode() {
    const m = S.mode;
    // 粒子类模式：1 烟线 / 2 粒子 / 3 涡流
    this.particles.points.visible = (m === 1 || m === 2 || m === 3);
    const u = this.particles.mat.uniforms;
    if (m === 1) { u.uColorMode.value = 0; u.uSoft.value = 1; u.uSize.value = 10; u.uOpacity.value = 0.55; }
    if (m === 2) { u.uColorMode.value = 1; u.uSoft.value = 0; u.uSize.value = 3.4; u.uOpacity.value = 0.95; }
    if (m === 3) { u.uColorMode.value = 2; u.uSoft.value = 0; u.uSize.value = 3.0; u.uOpacity.value = 0.85; }
    this.streamlines.lines.visible = (m === 0);
    this.streamlines.markDirty();
    this.cores.group.visible = (m === 3);
    this.slice.update();
    this.pressure.update();
  }
  onFlowChanged() {
    this.streamlines.markDirty();
    this.cores._lastAlpha = undefined; // 强制重建涡核
    if (S.mode === 5 || S.mode === 6) this.slice.updateTexture();
    if (S.mode === 4) this.pressure.paint();
  }
  update(dt, t) {
    const m = S.mode;
    if (m === 0) this.streamlines.update(dt);
    if (m === 1 || m === 2 || m === 3) this.particles.update(dt);
    if (m === 3) this.cores.update(dt, t);
    if (m === 5 || m === 6) this.slice.update();
    if (m === 4) this.pressure.update();
  }
}
