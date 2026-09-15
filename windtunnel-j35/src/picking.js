// 交互拾取（章节 9.1 / 十一）—— 单击局部参数探针 · 双击部件聚焦 · 悬停高亮 + 标签
import * as THREE from 'three';
import { S, emit } from './state.js';
import { pickMeshes, PARTS } from './aircraft.js';
import { sampleSpeed, sampleVort, cpAt } from './flowfield.js';
import { i18n } from './i18n.js';

const _origEmissiveStore = new Map(); // material → 原始 emissive

export class Picking {
  constructor(camera, canvas, rig, tooltipEl, probeEl) {
    this.camera = camera;
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.canvas = canvas;
    this.rig = rig;
    this.tooltip = tooltipEl;
    this.probe = probeEl;
    this.hoverPart = null;
    // fix: P1-4  删除死 Map this._origEmissive；模块级 _origEmissiveStore 才是真存储。
    this._downAt = 0;
    this._lastHover = 0;

    canvas.addEventListener('pointerdown', (e) => { this._downAt = performance.now(); this._dx = e.clientX; this._dy = e.clientY; });
    canvas.addEventListener('pointerup', (e) => {
      const dt = performance.now() - this._downAt;
      const moved = Math.hypot(e.clientX - this._dx, e.clientY - this._dy);
      if (dt < 260 && moved < 6) this.click(e);
    });
    canvas.addEventListener('dblclick', (e) => this.dblclick(e));
    canvas.addEventListener('pointermove', (e) => this.hover(e));
  }

  cast(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(pickMeshes, false);
    return hits.length ? hits[0] : null;
  }

  click(e) {
    const hit = this.cast(e);
    if (!hit) { this.probe.style.display = 'none'; return; }
    const p = hit.point;
    const sp = sampleSpeed(p.x, p.y, p.z);
    const vort = sampleVort(p.x, p.y, p.z);
    const cp = cpAt(p.x, p.y, p.z);
    const pLocal = S.pStatic + 0.5 * S.density * S.U * S.U * cp / 1000;
    const part = hit.object.userData.partId || 'fuselage';
    this.probe.innerHTML = `
      <div class="probe-title">${i18n.t('pickTitle')} · ${i18n.t('parts.' + part)}</div>
      <div class="probe-grid">
        <span>${i18n.t('pickCp')}</span><b>${cp.toFixed(3)}</b>
        <span>${i18n.t('pickV')}</span><b>${sp.toFixed(1)} ${i18n.t('m_s')}</b>
        <span>${i18n.t('pickVort')}</span><b>${vort.toFixed(1)}</b>
        <span>${i18n.t('pickP')}</span><b>${pLocal.toFixed(2)} ${i18n.t('kPa')}</b>
      </div>`;
    this.probe.style.display = 'block';
    this.probe.style.left = Math.min(e.clientX + 14, window.innerWidth - 280) + 'px';
    this.probe.style.top = (e.clientY + 14) + 'px';
  }

  dblclick(e) {
    const hit = this.cast(e);
    if (!hit) return;
    const partId = hit.object.userData.partId;
    // 求该部件所有 mesh 的联合包围盒
    const box = new THREE.Box3();
    let found = false;
    for (const m of pickMeshes) {
      if (m.userData.partId === partId) {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        box.union(b);
        found = true;
      }
    }
    if (found) this.rig.focusOn(box);
    emit('focusPart', partId);
  }

  hover(e) {
    const now = performance.now();
    if (now - this._lastHover < 90) return;
    this._lastHover = now;
    const hit = this.cast(e);
    const partId = hit ? (hit.object.userData.partId || 'fuselage') : null;
    if (partId !== this.hoverPart) {
      // 恢复旧高亮
      this.setHighlight(this.hoverPart, false);
      this.hoverPart = partId;
      this.setHighlight(partId, true);
    }
    if (hit) {
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = (e.clientX + 16) + 'px';
      this.tooltip.style.top = (e.clientY - 10) + 'px';
      this.tooltip.innerHTML = `<b>${i18n.t('parts.' + partId)}</b><br><span>${i18n.t('partDesc.' + partId)}</span>`;
    } else {
      this.tooltip.style.display = 'none';
    }
  }

  setHighlight(partId, on) {
    if (!partId) return;
    for (const m of pickMeshes) {
      if (m.userData.partId !== partId) continue;
      const mat = m.material;
      if (!mat || !mat.emissive) continue;
      if (on) {
        if (!_origEmissiveStore.has(mat)) {
          _origEmissiveStore.set(mat, mat.emissive.getHex());
          mat.emissive.setHex(0x2a5a66);
        }
      } else {
        const orig = _origEmissiveStore.get(mat);
        if (orig !== undefined) {
          mat.emissive.setHex(orig);
          _origEmissiveStore.delete(mat);
        }
      }
    }
  }
}
