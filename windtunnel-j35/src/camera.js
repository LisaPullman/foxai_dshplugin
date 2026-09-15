// 相机系统（章节十）—— 8 个预设 + OrbitControls 自由相机 + 1s 平滑过渡
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CG = new THREE.Vector3(0, 1.1, 0); // 风洞测试段中心（模型重心）

const PRESET_VIEWS = {
  side:    { pos: [26, 4.5, 17],  target: [0, 1.2, 0] },
  top:     { pos: [0.5, 34, 0.01],target: [0, 1, 0] },
  bottom:  { pos: [0.5, -26, 14], target: [0, 1, 0] },
  front:   { pos: [-24, 3.5, 8],  target: [-2, 1, 0] },
  rear:    { pos: [24, 4, -10],   target: [3, 1, 0] },
  cockpit: { pos: [-7.5, 2.4, 0], target: [-16, 1.6, 0] },
  follow:  { pos: [7, 2.6, 9],    target: [0, 1.1, 0] },
  global:  { pos: [44, 24, 36],   target: [4, 0, 0] },
};
const ORDER = ['side', 'top', 'bottom', 'front', 'rear', 'cockpit', 'follow', 'global'];

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 90;
    this.controls.minDistance = 4;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.tween = null;
    this.current = 'side';
    this.setPreset('side', true);
  }

  setPreset(name, immediate = false) {
    if (!PRESET_VIEWS[name]) return;
    this.current = name;
    const v = PRESET_VIEWS[name];
    if (immediate) {
      this.camera.position.set(...v.pos);
      this.controls.target.set(...v.target);
      this.controls.update();
      return;
    }
    // 1 秒平滑过渡
    this.tween = {
      t: 0,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(...v.pos),
      fromTgt: this.controls.target.clone(),
      toTgt: new THREE.Vector3(...v.target),
    };
  }

  cycle() {
    const i = ORDER.indexOf(this.current);
    this.setPreset(ORDER[(i + 1) % ORDER.length]);
    return ORDER[(i + 1) % ORDER.length];
  }

  /** 双击部件聚焦：目标 = 部件包围盒中心，距离自适应 */
  focusOn(box, offsetDir = [1, 0.35, 1]) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = Math.max(size * 1.5, 3.2);
    const dir = new THREE.Vector3(...offsetDir).normalize();
    this.tween = {
      t: 0,
      fromPos: this.camera.position.clone(),
      toPos: center.clone().addScaledVector(dir, dist),
      fromTgt: this.controls.target.clone(),
      toTgt: center,
    };
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(tw.t + dt / 1.0, 1);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2; // easeInOutCubic
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTgt, tw.toTgt, e);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
  }
}

export { ORDER as CAMERA_ORDER, CG };
