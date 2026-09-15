// 风洞测试间场景（章节二）—— 收缩段 · 测试段 · 扩散段 · 风扇 · 支架 · 工业照明
import * as THREE from 'three';

export const TUNNEL = {
  // 测试段（模型区）
  test: { x0: -13, x1: 13, halfH: 6.6, halfW: 7.4 },
  contractionLen: 9,
  diffuserLen: 14,
  fanRadius: 6.8,
  fanX: 30,
};

export function buildTunnel(scene) {
  const tunnelGroup = new THREE.Group();
  const T = TUNNEL;

  // —— 透明测试舱壁（菲涅尔感：MeshPhysical + 低透明度 + 高反光）——
  const wallMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fc4d8, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.07,
    side: THREE.DoubleSide, envMapIntensity: 1.5, depthWrite: false,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x39424e, metalness: 0.7, roughness: 0.4 });

  // 舱壁（上下左右四面 + 收口环）
  const segs = 2; // 分段便于后续扩展
  for (let i = 0; i < segs; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(T.test.x1 - T.test.x0, T.test.halfH * 2), wallMat);
    w.rotation.y = Math.PI / 2;
    w.position.set(T.test.x0 + (i + 0.5) * (T.test.x1 - T.test.x0) / segs, 0, T.test.halfW);
    tunnelGroup.add(w);
    const w2 = w.clone(); w2.position.z = -T.test.halfW; tunnelGroup.add(w2);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(T.test.x1 - T.test.x0, T.test.halfW * 2), wallMat);
    top.rotation.x = Math.PI / 2;
    top.position.set(T.test.x0 + (i + 0.5) * (T.test.x1 - T.test.x0) / segs, T.test.halfH, 0);
    tunnelGroup.add(top);
    const bot = top.clone(); bot.rotation.x = -Math.PI / 2; bot.position.y = -T.test.halfH; tunnelGroup.add(bot);
  }

  // 纵向加强肋（框位）
  for (let x = T.test.x0; x <= T.test.x1 + 0.1; x += 4.33) {
    // fix: P1-2  原代码创建了 TorusGeometry 但未 add，留下 7 个泄漏 mesh
    const rect = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, T.test.halfW * 2), frameMat);
    rect.position.set(x, T.test.halfH, 0); tunnelGroup.add(rect);
    const rect2 = rect.clone(); rect2.position.y = -T.test.halfH; tunnelGroup.add(rect2);
    const rect3 = new THREE.Mesh(new THREE.BoxGeometry(0.16, T.test.halfH * 2, 0.16), frameMat);
    rect3.position.set(x, 0, T.test.halfW); tunnelGroup.add(rect3);
    const rect4 = rect3.clone(); rect4.position.z = -T.test.halfW; tunnelGroup.add(rect4);
  }

  // —— 收缩段（入口锥）——
  const contr = new THREE.Mesh(
    new THREE.CylinderGeometry(T.test.halfH * 1.35, T.test.halfH, T.contractionLen, 4, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2c343f, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide, flatShading: true })
  );
  contr.rotation.z = Math.PI / 2;
  contr.position.set(T.test.x0 - T.contractionLen / 2, 0, 0);
  tunnelGroup.add(contr);

  // —— 扩散段 ——
  const diff = new THREE.Mesh(
    new THREE.CylinderGeometry(T.test.halfH, T.test.halfH * 1.75, T.diffuserLen, 4, 1, true),
    contr.material
  );
  diff.rotation.z = Math.PI / 2;
  diff.position.set(T.test.x1 + T.diffuserLen / 2, 0, 0);
  tunnelGroup.add(diff);

  // —— 大型风扇（叶片可见旋转）——
  const fanGroup = new THREE.Group();
  fanGroup.position.set(T.fanX, 0, 0);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshStandardMaterial({ color: 0x23282f, metalness: 0.8, roughness: 0.35 }));
  fanGroup.add(hub);
  const blades = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x525c68, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  // fix: P2-2  风扇叶片几何调整：
  // 原叶片长 4.6 m，中心在 r=3.4 → 叶片从 r=1.1 延伸到 r=5.7。
  // 但 hub 球半径 1.1，叶片根部与 hub 视觉重叠。
  // 调整：根部从 r=1.4 起始，叶片总长 4.0 → 范围 r=1.4..5.4，避开 hub 且不超出风扇整流罩。
  // 同时把 rotation.y 的 0.42 rad 改为 0.35（约 20°）—— 这是大型轴流风扇的典型叶片角。
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.0, 0.85), bladeMat);
    const a = (i / 9) * Math.PI * 2;
    b.position.set(0, Math.sin(a) * 3.4, Math.cos(a) * 3.4);
    b.rotation.x = -a;
    b.rotation.y = 0.35;
    blades.add(b);
  }
  fanGroup.add(blades);
  // 整流罩
  const fair = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, 3.4, 12), new THREE.MeshStandardMaterial({ color: 0x2c343f, metalness: 0.6, roughness: 0.5 }));
  fair.rotation.z = Math.PI / 2;
  fair.position.x = -3.2;
  fanGroup.add(fair);
  tunnelGroup.add(fanGroup);

  // —— 地面 / 测试间 ——
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.9, metalness: 0.1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 90), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -T.test.halfH - 2.2;
  floor.receiveShadow = true;
  tunnelGroup.add(floor);

  // 地面防滑网格
  const grid = new THREE.GridHelper(150, 60, 0x2a3340, 0x202833);
  grid.position.set(0, floor.position.y + 0.01, 0);
  tunnelGroup.add(grid);

  // 远处标尺
  const rulerMat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.8 });
  for (let i = -7; i <= 7; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), rulerMat);
    post.position.set(i * 4, floor.position.y + 0.7, -22);
    tunnelGroup.add(post);
  }

  // 警戒带（黄黑）
  const stripeMat = new THREE.MeshStandardMaterial({ map: makeHazardTexture(), roughness: 0.8 });
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(150, 1.0), stripeMat);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, floor.position.y + 0.02, -20);
  tunnelGroup.add(stripe);
  const stripe2 = stripe.clone(); stripe2.position.z = 20; tunnelGroup.add(stripe2);

  // —— 模型支架（腹撑单支杆）——
  const stingMat = new THREE.MeshStandardMaterial({ color: 0x4a4e56, metalness: 0.75, roughness: 0.35 });
  const sting = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, T.test.halfH + 0.9, 12), stingMat);
  sting.position.set(1.4, -T.test.halfH / 2 + 0.1, 0);
  sting.castShadow = true;
  tunnelGroup.add(sting);
  const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 6, 10), stingMat);
  fairing.rotation.z = Math.PI / 2;
  fairing.position.set(1.4, 0.18, 0);
  tunnelGroup.add(fairing);
  // 斜撑
  const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10.5, 8), stingMat);
  brace.position.set(5.4, -T.test.halfH / 2 - 0.5, 0);
  brace.rotation.z = 0.44;
  tunnelGroup.add(brace);

  // —— 工业照明（提亮 + 双侧青/琥珀补光，增强纵深）——
  scene.add(new THREE.AmbientLight(0x8ea6c0, 0.75));
  const hemi = new THREE.HemisphereLight(0x9db8d6, 0x1a212b, 0.9);
  scene.add(hemi);
  for (const lx of [-8, 0, 8]) {
    const spot = new THREE.SpotLight(0xeaf2ff, 260, 46, Math.PI / 5, 0.42, 1.6);
    spot.position.set(lx, T.test.halfH + 4.5, 5);
    spot.target.position.set(lx * 0.5, 0.6, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    scene.add(spot);
    scene.add(spot.target);
    // 灯具外形（自发光面板，消除"悬浮黑块"感）
    const lampBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.35, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.6 })
    );
    lampBody.position.set(lx, T.test.halfH + 5.2, 5);
    tunnelGroup.add(lampBody);
    const lampGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xd8ecff })
    );
    lampGlow.position.set(lx, T.test.halfH + 5.0, 5);
    tunnelGroup.add(lampGlow);
  }
  const rim = new THREE.DirectionalLight(0x6fd8ff, 0.7);
  rim.position.set(-18, 8, -14);
  scene.add(rim);
  const fillCyan = new THREE.DirectionalLight(0x3ec8e8, 0.35);
  fillCyan.position.set(10, -4, 16);
  scene.add(fillCyan);
  const fillAmber = new THREE.DirectionalLight(0xffb668, 0.22);
  fillAmber.position.set(-12, 3, -16);
  scene.add(fillAmber);

  scene.add(tunnelGroup);
  return { tunnelGroup, blades };
}

function makeHazardTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a227'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#14181e';
  for (let i = -32; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 32); g.lineTo(i + 16, 0); g.lineTo(i + 32, 0); g.lineTo(i + 16, 32);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(24, 1);
  return tex;
}
