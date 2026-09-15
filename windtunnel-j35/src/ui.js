// UI 框架（章节四/六/七/八/九）—— 顶部菜单 · 左控制面板 · 右参数面板 · 底部状态栏
import { S, emit } from './state.js';
import { i18n, I18N } from './i18n.js';
import { PRESETS, resolvePresetParams } from './presets.js';
import { CAMERA_ORDER } from './camera.js';
import { isa } from './atmosphere.js';
import { Gauge } from './gauges.js';

const $ = (id) => document.getElementById(id);
let gauges = null;

// —— 滑块构造 ——
function slider(parent, opt) {
  const row = document.createElement('div');
  row.className = 'ctl-row';
  row.innerHTML = `
    <label data-i18n="${opt.i18nKey || ''}">${opt.label}</label>
    <input type="range" min="${opt.min}" max="${opt.max}" step="${opt.step}" value="${opt.get()}">
    <span class="ctl-val">${opt.fmt ? opt.fmt(opt.get()) : opt.get()}</span>`;
  const input = row.querySelector('input');
  const val = row.querySelector('.ctl-val');
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    opt.set(v);
    val.textContent = opt.fmt ? opt.fmt(v) : v;
    emit('param');
  });
  parent.appendChild(row);
  return {
    refresh() {
      input.value = opt.get();
      val.textContent = opt.fmt ? opt.fmt(opt.get()) : opt.get();
    },
    label: row.querySelector('label'),
  };
}

function checkbox(parent, opt) {
  const row = document.createElement('div');
  row.className = 'ctl-row chk';
  row.innerHTML = `<label><input type="checkbox" ${opt.get() ? 'checked' : ''}> <span>${opt.label}</span></label>`;
  const input = row.querySelector('input');
  input.addEventListener('change', () => { opt.set(input.checked); emit('param'); });
  parent.appendChild(row);
  return { refresh: () => { input.checked = opt.get(); }, span: row.querySelector('span') };
}

function section(parent, titleKey, titleText) {
  const sec = document.createElement('div');
  sec.className = 'panel-sec';
  sec.innerHTML = `<div class="sec-title" data-i18n="${titleKey}">${titleText}</div>`;
  parent.appendChild(sec);
  return sec;
}

let refreshers = [];

export function buildLeftPanel() {
  const panel = $('leftPanel');
  // fix: R4-3  切语言时 applyLangUI 会重建 panel，原代码不清理 → DOM 节点累积、
  // 事件监听器重复触发。统一每次重建前清空。
  if (panel) panel.innerHTML = '';
  refreshers = [];

  // 预设
  const secP = section(panel, 'presetsTitle', i18n.t('presetsTitle'));
  const grid = document.createElement('div');
  grid.className = 'preset-grid';
  grid.id = 'presetGrid';
  secP.appendChild(grid);
  PRESETS.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.dataset.preset = i;
    btn.textContent = `${i + 1}. ${i18n.t('presets.' + i)}`;
    btn.addEventListener('click', () => applyPreset(i));
    grid.appendChild(btn);
  });

  // 气流
  const secF = section(panel, 'flowTitle', i18n.t('flowTitle'));
  refreshers.push(slider(secF, { label: i18n.t('windSpeed'), i18nKey: 'windSpeed', min: 0, max: 500, step: 1, get: () => S.U, set: (v) => { S.U = v; }, fmt: (v) => v.toFixed(0) + ' m/s' }));

  // 姿态
  const secA = section(panel, 'attitudeTitle', i18n.t('attitudeTitle'));
  refreshers.push(slider(secA, { label: i18n.t('aoa'), min: -10, max: 35, step: 0.5, get: () => S.alpha, set: (v) => { S.alpha = v; }, fmt: (v) => v.toFixed(1) + '°' }));
  refreshers.push(slider(secA, { label: i18n.t('aos'), min: -15, max: 15, step: 0.5, get: () => S.beta, set: (v) => { S.beta = v; }, fmt: (v) => v.toFixed(1) + '°' }));
  refreshers.push(slider(secA, { label: i18n.t('elevator'), min: -25, max: 25, step: 0.5, get: () => S.deltaE, set: (v) => { S.deltaE = v; }, fmt: (v) => v.toFixed(1) + '°' }));

  // 大气
  const secAtm = section(panel, 'atmoTitle', i18n.t('atmoTitle'));
  refreshers.push(checkbox(secAtm, { label: i18n.t('atmoLink'), get: () => S.atmoLinked, set: (v) => { S.atmoLinked = v; syncAtmoInputs(); } }));
  refreshers.push(slider(secAtm, { label: i18n.t('altitude'), min: 0, max: 12000, step: 100, get: () => S.altitude, set: (v) => { S.altitude = v; if (S.atmoLinked) syncTempFromAlt(); }, fmt: (v) => v.toFixed(0) + ' m' }));
  refreshers.push(slider(secAtm, { label: i18n.t('temperature'), min: 210, max: 330, step: 0.5, get: () => S.temperature, set: (v) => { S.temperature = v; }, fmt: (v) => v.toFixed(1) + ' K' }));
  refreshers.push(slider(secAtm, { label: i18n.t('density'), min: 0.2, max: 1.5, step: 0.005, get: () => S.density, set: (v) => { if (!S.atmoLinked) S.density = v; }, fmt: (v) => v.toFixed(3) }));
  refreshers.push(slider(secAtm, { label: i18n.t('viscosity'), min: 1.2, max: 2.2, step: 0.01, get: () => S.viscosity * 1e5, set: (v) => { if (!S.atmoLinked) S.viscosity = v * 1e-5; }, fmt: (v) => v.toFixed(2) + 'e-5' }));
  refreshers.push(slider(secAtm, { label: i18n.t('turbulence'), min: 0, max: 30, step: 0.5, get: () => S.Tu, set: (v) => { S.Tu = v; }, fmt: (v) => v.toFixed(1) + ' %' }));

  // 模型
  const secM = section(panel, 'modelTitle', i18n.t('modelTitle'));
  refreshers.push(slider(secM, { label: i18n.t('roughness'), min: 0, max: 100, step: 1, get: () => S.roughness, set: (v) => { S.roughness = v; }, fmt: (v) => v.toFixed(0) + ' %' }));

  // 可视化
  const secV = section(panel, 'visTitle', i18n.t('visTitle'));
  refreshers.push(slider(secV, { label: i18n.t('particleCount'), min: 10, max: 100, step: 5, get: () => S.particlePct, set: (v) => { S.particlePct = v; }, fmt: (v) => v.toFixed(0) + ' %' }));
  refreshers.push(slider(secV, { label: i18n.t('streamlineLen'), min: 4, max: 40, step: 1, get: () => S.streamSegs, set: (v) => { S.streamSegs = v; }, fmt: (v) => v.toFixed(0) }));
  refreshers.push(slider(secV, { label: i18n.t('speedRate'), min: 0.1, max: 3, step: 0.1, get: () => S.visRate, set: (v) => { S.visRate = v; }, fmt: (v) => '×' + v.toFixed(1) }));

  // 派生量（只读）
  const secD = section(panel, 'derivedTitle', i18n.t('derivedTitle'));
  for (const [id, key] of [['dvSound', 'soundSpeed'], ['dvMach', 'mach'], ['dvP', 'staticPressure']]) {
    const row = document.createElement('div');
    row.className = 'ctl-row readonly';
    row.innerHTML = `<label data-i18n="${key}">${i18n.t(key)}</label><span id="${id}">—</span>`;
    secD.appendChild(row);
  }

  // 截面查看器
  const secS = section(panel, 'sliceTitle', i18n.t('sliceTitle'));
  const sliceRow = document.createElement('div');
  sliceRow.className = 'ctl-row';
  sliceRow.innerHTML = `<label data-i18n="sliceType">${i18n.t('sliceType')}</label>
    <select id="sliceTypeSel"><option>速度云图</option><option>纹影</option></select>`;
  secS.appendChild(sliceRow);
  // fix: P1-4  删除死代码 `$('sliceTypeSel') && null;` —— 表达式求值后未赋给任何变量
  const sel = sliceRow.querySelector('#sliceTypeSel');
  sel.addEventListener('change', () => {
    S.sliceType = sel.selectedIndex;
    S.mode = sel.selectedIndex === 0 ? 5 : 6;
    emit('mode');
  });
  refreshers.push(checkbox(secS, { label: i18n.t('slicePlaneXZ'), get: () => S.sliceHorizontal, set: (v) => { S.sliceHorizontal = v; emit('param'); } }));
  refreshers.push(slider(secS, { label: i18n.t('slicePos'), min: -1, max: 1, step: 0.02, get: () => S.slicePos, set: (v) => { S.slicePos = v; }, fmt: (v) => (v * 13).toFixed(1) + ' m' }));

  // 画质
  const secQ = section(panel, 'qualityTitle', i18n.t('qualityTitle'));
  refreshers.push(slider(secQ, { label: i18n.t('resolution'), min: 0.5, max: 2, step: 0.25, get: () => S.resScale, set: (v) => { S.resScale = v; emit('quality'); }, fmt: (v) => '×' + v.toFixed(2) }));
  refreshers.push(checkbox(secQ, { label: i18n.t('antialias'), get: () => S.antialias, set: (v) => { S.antialias = v; emit('quality'); } }));
  refreshers.push(checkbox(secQ, { label: i18n.t('shadows'), get: () => S.shadows, set: (v) => { S.shadows = v; emit('quality'); } }));
  const fpsRow = document.createElement('div');
  fpsRow.className = 'ctl-row';
  // fix: P1-2  原代码 `${i === 0 ? '' : ''}` 永远是空字符串，结果 4 个 option 都未 selected，
  // 默认 selectedIndex=0（"30 fps"），但 S.fpsLimit 默认 0（无限制）—— UI 与状态不一致。
  // 改为按 S.fpsLimit 实际值匹配 selected。
  fpsRow.innerHTML = `<label data-i18n="fpsLimit">${i18n.t('fpsLimit')}</label>
    <select id="fpsSel">${[30, 60, 120, 0].map((v, i) => `<option value="${v}" ${v === S.fpsLimit ? 'selected' : ''}>${i18n.t('fpsOptions.' + i)}</option>`).join('')}</select>`;
  secQ.appendChild(fpsRow);
  fpsRow.querySelector('#fpsSel').addEventListener('change', (e) => { S.fpsLimit = parseInt(e.target.value) || 0; });

  // 声音
  const secSnd = section(panel, '', i18n.t('sound'));
  refreshers.push(checkbox(secSnd, { label: i18n.t('sound'), get: () => S.soundOn, set: (v) => { S.soundOn = v; emit('sound'); } }));
}

let _atmoSyncing = false;
function syncTempFromAlt() {
  // 联动时：海拔修改自动把温度拉到 ISA 标准值
  if (_atmoSyncing) return;
  _atmoSyncing = true;
  S.temperature = Math.max(210, Math.min(330, isa(S.altitude).T));
  _atmoSyncing = false;
}
function syncAtmoInputs() { refreshers.forEach((r) => r.refresh && r.refresh()); }

export function applyPreset(i) {
  const p = PRESETS[i];
  // fix: P1-1  不再 mutate PRESETS[i].params。原代码 pr.U = ... 直接修改模块级常量，
  // —— 多次应用同一预设会污染源数据，且 PRESETS 数组应只读。
  // 使用 presets.js 的 resolvePresetParams(preset, a) 反算 U，并清理 mach 字段。
  // 音速优先用 S.a（已由 updateAtmosphere 填好），未更新时回退 isa().
  const a = S.a || isa(S.altitude).a || 340;
  const pr = resolvePresetParams(p, a);
  Object.assign(S, {
    U: pr.U, alpha: pr.alpha, beta: pr.beta, Tu: pr.Tu, deltaE: pr.deltaE,
    mode: pr.mode ?? S.mode,
  });
  if (pr.slicePos !== undefined) S.slicePos = pr.slicePos;
  if (pr.sliceType !== undefined) { S.sliceType = pr.sliceType; }
  refreshers.forEach((r) => r.refresh && r.refresh());
  document.querySelectorAll('.preset-btn').forEach((b) => b.classList.toggle('active', +b.dataset.preset === i));
  emit('param');
  emit('mode');
  emit('preset', i);
}

// —— 顶部栏 ——
export function buildTopBar() {
  const tabs = $('modeTabs');
  tabs.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const b = document.createElement('button');
    b.className = 'mode-tab' + (i === S.mode ? ' active' : '');
    b.dataset.mode = i;
    b.textContent = i18n.t('modes.' + i);
    b.addEventListener('click', () => { S.mode = i; emit('mode'); });
    tabs.appendChild(b);
  }
  const camSel = $('camSel');
  camSel.innerHTML = CAMERA_ORDER.map((c) => `<option value="${c}">${i18n.t('cameraPresets.' + c)}</option>`).join('');
  camSel.addEventListener('change', (e) => emit('camera', e.target.value));

  $('btnHide').addEventListener('click', () => togglePanels());
  $('btnFull').addEventListener('click', () => toggleFullscreen());
  $('btnLang').addEventListener('click', () => { emit('lang', S.lang === 'zh' ? 'en' : 'zh'); });
}

export function setModeActive(m) {
  document.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('active', +b.dataset.mode === m));
}

export function togglePanels() {
  S.panelsHidden = !S.panelsHidden;
  document.body.classList.toggle('panels-hidden', S.panelsHidden);
  $('btnHide').textContent = S.panelsHidden ? i18n.t('showPanels') : i18n.t('hidePanels');
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

// —— 右侧参数面板 ——
const PARAM_KEYS = ['U', 'M', 'alpha', 'beta', 'rho', 'q', 'Re', 'L', 'D', 'Y', 'CL', 'CD', 'CY', 'LD', 'm', 'n', 'l', 'xcp', 'stallMargin', 'TuWake', 'pMax', 'pMin'];

export function buildRightPanel() {
  const list = $('paramList');
  list.innerHTML = '';
  for (const k of PARAM_KEYS) {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `<span data-i18n="p.${k}">${i18n.t('p.' + k)}</span><b id="pv_${k}">—</b>`;
    list.appendChild(row);
  }
  // 表盘
  const mk = (id, opt) => {
    const g = new Gauge($(id), opt);
    g.draw();
    return g;
  };
  gauges = {
    U: mk('gaugeU', { min: 0, max: 500, label: '', value: 0, fmt: (v) => v.toFixed(0) }),
    M: mk('gaugeM', { min: 0, max: 2, label: '', value: 0, fmt: (v) => v.toFixed(2), danger: (v) => v > 0.95 }),
    A: mk('gaugeA', { min: -10, max: 35, label: '', value: 0, fmt: (v) => v.toFixed(1) + '°', danger: (v) => v > 28 }),
  };
}

const fmts = {
  U: (v) => v.toFixed(1), M: (v) => v.toFixed(3), alpha: (v) => v.toFixed(1), beta: (v) => v.toFixed(1),
  rho: (v) => v.toFixed(3), q: (v) => v.toFixed(1), Re: (v) => v.toExponential(2).replace('e+', 'e'),
  L: (v) => v.toFixed(1), D: (v) => v.toFixed(1), Y: (v) => v.toFixed(2),
  CL: (v) => v.toFixed(3), CD: (v) => v.toFixed(4), CY: (v) => v.toFixed(3), LD: (v) => v.toFixed(2),
  m: (v) => v.toFixed(1), n: (v) => v.toFixed(1), l: (v) => v.toFixed(1),
  xcp: (v) => v.toFixed(2), stallMargin: (v) => v.toFixed(1), TuWake: (v) => v.toFixed(1),
  pMax: (v) => v.toFixed(1), pMin: (v) => v.toFixed(1),
};

export function updateReadouts() {
  const a = S.aero;
  const vals = {
    U: S.U, M: S.M, alpha: S.alpha, beta: S.beta, rho: S.density, q: S.q,
    Re: a.Re || 0, L: a.L || 0, D: a.D || 0, Y: a.Y || 0,
    CL: a.CL || 0, CD: a.CD || 0, CY: a.CY || 0, LD: a.LD || 0,
    m: a.m || 0, n: a.n || 0, l: a.l || 0, xcp: a.xcp || 0,
    stallMargin: a.stallMargin ?? 0, TuWake: a.TuWake ?? 0, pMax: a.pMax || 0, pMin: a.pMin || 0,
  };
  for (const k of PARAM_KEYS) {
    const el = $('pv_' + k);
    if (el) el.textContent = fmts[k](vals[k]);
  }
  if (gauges) {
    gauges.U.value = S.U; gauges.M.value = S.M; gauges.A.value = S.alpha;
    gauges.U.draw(); gauges.M.draw(); gauges.A.draw();
  }
  // 派生量
  const ds = $('dvSound'), dm = $('dvMach'), dp = $('dvP');
  if (ds) ds.textContent = S.a.toFixed(1) + ' m/s';
  if (dm) dm.textContent = S.M.toFixed(3);
  if (dp) dp.textContent = S.pStatic.toFixed(1) + ' kPa';
  // 状态行
  const st = $('statusTunnelVal');
  if (st) {
    if (S.U < 1) st.textContent = i18n.t('statusStandby');
    else if (S._speedChasing) st.textContent = i18n.t('statusRun');
    else st.textContent = i18n.t('statusSteady');
  }
  const phen = $('phenomenonText');
  if (phen) phen.textContent = i18n.t('phenomena.' + phenomenonKey());
}

export function phenomenonKey() {
  if (S.M > 0.92 && S.U > 50) return 'transonic';
  if (S.alpha >= 28) return 'stall';
  if (S.alpha > 16) return 'highAlpha';
  if (Math.abs(S.beta) > 8) return 'sideslip';
  if (S.U < 80 && S.U >= 1) return 'low';
  return 'cruise';
}

// —— 底部栏 ——
export function buildBottomBar(charts) {
  $('btnPause').addEventListener('click', () => {
    S.sampling = !S.sampling;
    $('btnPause').textContent = S.sampling ? i18n.t('pauseRec') : i18n.t('resumeRec');
  });
  $('btnStep').addEventListener('click', () => emit('stepOnce'));
  $('btnClear').addEventListener('click', () => charts.clear());
  // 图表标题 + 图例
  const titles = $('chartTitles');
  titles.innerHTML = i18n.t('charts').map((c, i) => `<span>${i + 1}. ${c}</span>`).join('');
}

// —— i18n 全量刷新 ——
export function applyLangUI() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const v = i18n.t(key);
    if (v !== null && typeof v !== 'object') el.textContent = v;
  });
  $('btnLang').textContent = S.lang === 'zh' ? 'EN' : '中文';
  $('btnHide').textContent = S.panelsHidden ? i18n.t('showPanels') : i18n.t('hidePanels');
  document.title = i18n.t('title');
  // 重建动态列表
  buildTopBar();
  buildLeftPanel();
  buildRightPanel();
  setModeActive(S.mode);
  document.querySelectorAll('.preset-btn').forEach((b) => {
    b.textContent = `${+b.dataset.preset + 1}. ${i18n.t('presets.' + b.dataset.preset)}`;
  });
  const titles = $('chartTitles');
  if (titles) titles.innerHTML = i18n.t('charts').map((c, i) => `<span>${i + 1}. ${c}</span>`).join('');
}

export { refreshers };
