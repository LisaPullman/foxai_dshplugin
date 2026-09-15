// 主入口 —— 渲染循环 · 事件编排 · 键盘交互（章节九/十三）
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { S, on, emit } from './state.js';
import { i18n } from './i18n.js';
import { updateAtmosphere } from './atmosphere.js';
import { computeAero } from './physics.js';
import { buildTunnel } from './tunnel.js';
import { buildAircraft, setElevator, getAircraftGroup } from './aircraft.js';
import { setAttitude, getAttitudeQ, rebuildVortices, startBake, bakeStep, GRID } from './flowfield.js';
import { Visualizers } from './visualizers.js';
import { CameraRig } from './camera.js';
import { Charts } from './charts.js';
import { Picking } from './picking.js';
import { sound } from './sound.js';
import {
  buildLeftPanel, buildTopBar, buildRightPanel, buildBottomBar,
  updateReadouts, applyLangUI, setModeActive, togglePanels, toggleFullscreen, refreshers,
} from './ui.js';

// —— 渲染器 ——
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: S.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * S.resScale);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = S.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1017);
scene.fog = new THREE.Fog(0x0b1017, 55, 130);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
const rig = new CameraRig(camera, canvas);

// —— 场景 ——
const { blades } = buildTunnel(scene);
buildAircraft(scene);
const vis = new Visualizers(scene);

// —— UI ——
const charts = new Charts(['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']);
buildTopBar();
buildLeftPanel();
buildRightPanel();
buildBottomBar(charts);
const picking = new Picking(camera, canvas, rig, document.getElementById('tooltip'), document.getElementById('probe'));

// —— 参数管线 ——
let paramTimer = null;
function applyPhysics() {
  updateAtmosphere();
  computeAero();
  setAttitude(S.alpha, S.beta, S.roll);
  const g = getAircraftGroup();
  if (g) g.quaternion.copy(getAttitudeQ());
  setElevator(S.deltaE);
  rebuildVortices();
  startBake();
  vis.streamlines.markDirty();
}

let lastParamAt = 0;
on('param', () => {
  applyPhysicsLight();
  lastParamAt = performance.now();
  clearTimeout(paramTimer);
  paramTimer = setTimeout(applyPhysics, 140); // 停止拖动后重烘焙
});

function applyPhysicsLight() {
  updateAtmosphere();
  computeAero();
  setAttitude(S.alpha, S.beta, S.roll);
  const g = getAircraftGroup();
  if (g) g.quaternion.copy(getAttitudeQ());
  setElevator(S.deltaE);
}

on('mode', () => { setModeActive(S.mode); vis.applyMode(); });
on('camera', (name) => rig.setPreset(name));
// fix: R4-1  删除空 preset 订阅。applyPreset 已直接调用 refreshers.update + emit('param')+emit('mode')，
// emit('preset', i) 当前没有订阅者；保留空订阅占 listener slot 无意义。
on('sound', () => sound.toggle(S.soundOn));
on('lang', (lang) => {
  S.lang = lang; i18n.lang = lang;
  applyLangUI();
});
on('quality', () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * S.resScale);
  renderer.shadowMap.enabled = S.shadows;
  scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
});
on('stepOnce', () => { sampleOnce(); });

// 首次用户交互后启动音效（浏览器自动播放策略）
window.addEventListener('pointerdown', () => sound.userGesture(), { once: true });
window.addEventListener('keydown', () => sound.userGesture(), { once: true });

// —— 键盘 ——
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const nudge = (key, d, lo, hi) => {
    S[key] = Math.max(lo, Math.min(hi, S[key] + d));
    refreshers.forEach((r) => r.refresh && r.refresh());
    emit('param');
  };
  switch (k) {
    case 'w': nudge('alpha', 0.5, -10, 35); break;
    case 's': nudge('alpha', -0.5, -10, 35); break;
    case 'q': nudge('beta', 0.5, -15, 15); break;
    case 'e': nudge('beta', -0.5, -15, 15); break;
    case 'a': S.roll = (S.roll - 2 + 360) % 360; emit('param'); break;
    case 'd': S.roll = (S.roll + 2) % 360; emit('param'); break;
    case ' ': S.alpha = 3; S.beta = 0; S.roll = 0; refreshers.forEach((r) => r.refresh && r.refresh()); emit('param'); e.preventDefault(); break;
    case 'r': S.recording = !S.recording; break;
    case 'c': rig.cycle(); break;
    case 'h': togglePanels(); break;
    case 'f': toggleFullscreen(); break;
    default:
      if (k >= '1' && k <= '7') { S.mode = +k - 1; emit('mode'); }
  }
});

// —— 采样 ——
let sampleAcc = 0;
function sampleOnce() {
  charts.push(S.t, S.aero, S.alpha);
}

// fix: P1-5  删除空 focusPart 订阅。picking.js:81 emit('focusPart', partId)，
// 但 picking.dblclick 已联调 rig.focusOn(box)，无需 main.js 转发；
// 空订阅会占据 listener slot 且永不解除。

// —— 图例 ——
(function drawLegend() {
  const cv = document.getElementById('legendBar');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, cv.width, 0);
  const stops = ['#0f30a8', '#0073ff', '#00d9b8', '#8ce600', '#ff9900', '#ff2110'];
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, cv.height * 0.55);
  ctx.fillStyle = 'rgba(160,190,220,0.8)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  for (const [val, fx] of [['0.35', 0], ['0.75', 0.286], ['1.0', 0.464], ['1.5', 1]]) {
    ctx.fillText(val, Math.max(8, Math.min(cv.width - 8, fx * cv.width)), cv.height - 2);
  }
})();

// —— 主循环 ——
const clock = new THREE.Clock();
let lastVersion = -1;
let fanAngle = 0;
// fix: P0-1  frameAcc 必须在 frame() 之前声明。原代码在 line 196 才 let，
// 而 frame() 在 fpsLimit>0 时立即访问 frameAcc（line 161）—— TDZ ReferenceError，
// 用户切 fps=30/60/120 时渲染循环会立刻崩溃。
let frameAcc = 0;

function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 0.05);

  // 帧率限制
  if (S.fpsLimit > 0) {
    frameAcc += dt;
    if (frameAcc < 1 / S.fpsLimit) return;
    dt = frameAcc; frameAcc = 0;
  }

  S.t += dt;
  S._speedChasing = performance.now() - lastParamAt < 800;

  // 流场烘焙（分块）
  if (GRID.baking) {
    bakeStep(4);
    if (GRID.version !== lastVersion) {
      lastVersion = GRID.version;
      vis.onFlowChanged();
    }
  }

  // 风扇转速 ∝ 风速
  fanAngle += dt * (0.4 + S.U * 0.05);
  blades.rotation.x = fanAngle;

  vis.update(dt, S.t);
  rig.update(dt);
  sound.update();

  // 20 Hz 采样
  if (S.sampling && S.recording) {
    sampleAcc += dt;
    const step = 1 / S.sampleHz;
    while (sampleAcc >= step) { sampleAcc -= step; sampleOnce(); }
  }

  updateReadouts();
  renderer.render(scene, camera);
}

// —— 窗口自适应 ——
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// —— 启动 ——
applyPhysics();
applyLangUI();
updateReadouts();
document.getElementById('boot')?.classList.add('done');
frame();
