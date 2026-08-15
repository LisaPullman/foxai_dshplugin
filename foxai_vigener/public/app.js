/**
 * foxai_vigener 前端逻辑
 * - 加载配置 + 模型注册表
 * - 表单提交 → SSE 生成 → 进度/日志/完成
 * - 完成档画廊(图片/视频/音频预览)+ 弹层
 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  models: [],
  grouped: {},
  defaults: {},
  selectedModel: null,
  selectedRefs: new Set(),
  references: [],
};

// ---- 初始化 ----
async function init() {
  bindEvents();
  await Promise.all([loadConfig(), loadModels(), loadReferences(), loadOutputs(), loadCustomModels()]);
}

function bindEvents() {
  $("#model").addEventListener("change", onModelChange);
  $("#generateBtn").addEventListener("click", onGenerate);
  $("#refUploadBtn").addEventListener("click", () => $("#refUpload").click());
  $("#refUpload").addEventListener("change", onUploadReference);
  $("#refClearBtn").addEventListener("click", () => {
    state.selectedRefs.clear();
    renderReferences();
  });
  $("#refreshOutputs").addEventListener("click", loadOutputs);
  $("#lightboxClose").addEventListener("click", closeLightbox);
  $("#lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });

  // 自定义模型
  $("#addCustomBtn").addEventListener("click", () => openCustomModal());
  $("#customModalClose").addEventListener("click", closeCustomModal);
  $("#customCancel").addEventListener("click", closeCustomModal);
  $("#customModal").addEventListener("click", (e) => {
    if (e.target.id === "customModal") closeCustomModal();
  });
  $("#customForm").addEventListener("submit", onSaveCustomModel);
}

async function loadConfig() {
  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    const el = $("#status");
    if (cfg.hasFalKey) {
      el.textContent = `✓ 已配置 · ${cfg.modelCount} 个模型`;
      el.className = "status ok";
    } else {
      el.textContent = "⚠ FAL_KEY 未配置 · 请在 .env 设置";
      el.className = "status warn";
    }
  } catch (err) {
    $("#status").textContent = "✗ 无法连接到服务";
  }
}

async function loadModels() {
  const data = await fetch("/api/models").then((r) => r.json());
  state.models = [];
  state.grouped = data.grouped;
  state.defaults = data.defaults;
  // 按 image → video → audio → other 顺序平铺
  const order = ["image", "video", "audio", "other"];
  const list = [];
  for (const t of order) {
    for (const m of data.grouped[t] ?? []) list.push(m);
  }
  state.models = list;
  renderModelSelect(list);
  if (list.length > 0) {
    state.selectedModel = list[0];
    onModelChange();
  }
}

function renderModelSelect(list) {
  const sel = $("#model");
  const order = ["image", "video", "audio", "other"];
  const labels = { image: "🖼 图片", video: "🎬 视频", audio: "🔊 音频", other: "📦 其他" };
  sel.innerHTML = "";
  for (const type of order) {
    const items = list.filter((m) => m.type === type);
    if (items.length === 0) continue;
    const og = document.createElement("optgroup");
    og.label = labels[type] ?? type;
    for (const m of items) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.label}${m.isDefault ? "  ★默认" : ""}`;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
}

function onModelChange() {
  const id = $("#model").value;
  state.selectedModel = state.models.find((m) => m.id === id);
  if (!state.selectedModel) return;
  $("#modelHint").textContent = state.selectedModel.notes ?? "";
  $("#durationField").hidden = state.selectedModel.type !== "video";
  // 切换模型后,参考图选择若不再支持就清掉
  if (!state.selectedModel.referenceImages && state.selectedRefs.size > 0) {
    state.selectedRefs.clear();
    renderReferences();
  }
}

// ---- 参考图 ----
async function loadReferences() {
  const data = await fetch("/api/references").then((r) => r.json());
  state.references = data.files ?? [];
  renderReferences();
}

function renderReferences() {
  const wrap = $("#refList");
  wrap.innerHTML = "";
  for (const r of state.references) {
    const chip = document.createElement("span");
    chip.className = "ref-chip" + (state.selectedRefs.has(r.name) ? " selected" : "");
    chip.textContent = r.name;
    if (state.selectedRefs.has(r.name)) {
      const x = document.createElement("span");
      x.className = "x";
      x.textContent = "✕";
      chip.appendChild(x);
    }
    chip.addEventListener("click", () => {
      if (state.selectedRefs.has(r.name)) state.selectedRefs.delete(r.name);
      else state.selectedRefs.add(r.name);
      renderReferences();
    });
    wrap.appendChild(chip);
  }
}

async function onUploadReference(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/references", { method: "POST", body: fd });
  if (!res.ok) {
    alert("上传失败");
    return;
  }
  e.target.value = "";
  await loadReferences();
}

// ---- 生成 ----
async function onGenerate() {
  const m = state.selectedModel;
  if (!m) return;
  const prompt = $("#prompt").value.trim();
  if (!prompt) {
    alert("请填写提示词");
    return;
  }

  const body = {
    model: m.id,
    prompt,
    referenceImages: [...state.selectedRefs],
    aspectRatio: $("#aspectRatio").value,
    numImages: Number($("#numImages").value) || 1,
  };
  if (m.type === "video") {
    body.duration = Number($("#duration").value) || 5;
  }
  const extraText = $("#extraInput").value.trim();
  if (extraText) {
    try {
      body.extraInput = JSON.parse(extraText);
    } catch {
      alert("高级参数不是合法 JSON");
      return;
    }
  }

  const btn = $("#generateBtn");
  const prog = $("#progress");
  const logBox = $("#logBox");
  const errBox = $("#errorBox");
  btn.disabled = true;
  prog.hidden = false;
  logBox.hidden = true;
  errBox.hidden = true;
  logBox.textContent = "";
  errBox.textContent = "";
  $("#progressStatus").textContent = "提交中…";
  $("#progressPosition").textContent = "";

  let res;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    btn.disabled = false;
    errBox.hidden = false;
    errBox.textContent = `请求失败:${err.message}`;
    return;
  }
  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    const j = await res.json();
    btn.disabled = false;
    errBox.hidden = false;
    errBox.textContent = j.error ?? `HTTP ${res.status}`;
    return;
  }
  if (!res.body) {
    btn.disabled = false;
    errBox.hidden = false;
    errBox.textContent = "响应无 body";
    return;
  }

  // 解析 SSE 流
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      parseSse(chunk);
    }
  }

  btn.disabled = false;
  await loadOutputs();
}

function parseSse(chunk) {
  const lines = chunk.split("\n");
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return;
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }

  if (event === "progress") {
    const map = {
      IN_QUEUE: "排队中",
      IN_PROGRESS: "生成中",
      COMPLETED: "已完成",
      starting: "提交中",
    };
    $("#progressStatus").textContent = map[payload.status] ?? payload.status;
    if (payload.queuePosition) {
      $("#progressPosition").textContent = `队列位置:${payload.queuePosition}`;
    }
  } else if (event === "log") {
    $("#logBox").hidden = false;
    const msg = typeof payload === "string" ? payload : payload.message ?? JSON.stringify(payload);
    $("#logBox").textContent += msg + "\n";
    $("#logBox").scrollTop = $("#logBox").scrollHeight;
  } else if (event === "done") {
    $("#progressStatus").textContent = `✓ 已生成 ${payload.files.length} 个产物`;
    $("#progressPosition").textContent = "";
  } else if (event === "error") {
    $("#errorBox").hidden = false;
    $("#errorBox").textContent = payload.message ?? "未知错误";
  }
}

// ---- 完成档画廊 ----
async function loadOutputs() {
  const data = await fetch("/api/outputs").then((r) => r.json());
  const wrap = $("#outputs");
  wrap.innerHTML = "";
  for (const f of data.files ?? []) {
    const card = document.createElement("div");
    card.className = "output-card";
    const thumb = document.createElement("div");
    thumb.className = "output-thumb";
    if (f.kind === "image") {
      const img = document.createElement("img");
      img.src = f.url;
      img.alt = f.name;
      img.loading = "lazy";
      thumb.appendChild(img);
    } else if (f.kind === "video") {
      const v = document.createElement("video");
      v.src = f.url;
      v.muted = true;
      thumb.appendChild(v);
    } else if (f.kind === "audio") {
      thumb.textContent = "🔊";
    } else {
      thumb.textContent = "📦";
    }
    const meta = document.createElement("div");
    meta.className = "output-meta";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.name;
    const size = document.createElement("span");
    size.textContent = formatSize(f.size);
    meta.appendChild(name);
    meta.appendChild(size);
    card.appendChild(thumb);
    card.appendChild(meta);
    card.addEventListener("click", () => openLightbox(f));
    wrap.appendChild(card);
  }
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function openLightbox(f) {
  const body = $("#lightboxBody");
  body.innerHTML = "";
  let el;
  if (f.kind === "image") {
    el = document.createElement("img");
    el.src = f.url;
  } else if (f.kind === "video") {
    el = document.createElement("video");
    el.src = f.url;
    el.controls = true;
    el.autoplay = true;
  } else if (f.kind === "audio") {
    el = document.createElement("audio");
    el.src = f.url;
    el.controls = true;
    el.autoplay = true;
  } else {
    el = document.createElement("a");
    el.href = f.url;
    el.textContent = f.name;
    el.target = "_blank";
  }
  body.appendChild(el);
  $("#lightbox").hidden = false;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  $("#lightboxBody").innerHTML = "";
}

// ---- 自定义模型 ----
async function loadCustomModels() {
  const data = await fetch("/api/custom-models").then((r) => r.json());
  state.customModels = data.models ?? [];
  renderCustomModels();
}

function renderCustomModels() {
  const wrap = $("#customList");
  wrap.innerHTML = "";
  for (const m of state.customModels ?? []) {
    const row = document.createElement("div");
    row.className = "custom-row";
    const idEl = document.createElement("span");
    idEl.className = "cm-id";
    idEl.textContent = m.id;
    idEl.title = m.id;
    const typeEl = document.createElement("span");
    typeEl.className = "cm-type";
    typeEl.textContent = `${typeIcon(m.type)} ${m.type}`;
    const del = document.createElement("button");
    del.className = "cm-del";
    del.textContent = "✕";
    del.title = "删除";
    del.addEventListener("click", () => onDeleteCustomModel(m.id));
    row.appendChild(idEl);
    row.appendChild(typeEl);
    row.appendChild(del);
    wrap.appendChild(row);
  }
}

function typeIcon(t) {
  return { image: "🖼", video: "🎬", audio: "🔊", other: "📦" }[t] ?? "📦";
}

function openCustomModal(prefill) {
  $("#customModalTitle").textContent = prefill ? "编辑自定义模型" : "添加自定义模型";
  $("#cm-id").value = prefill?.id ?? "";
  $("#cm-id").disabled = Boolean(prefill);
  $("#cm-label").value = prefill?.label ?? "";
  $("#cm-type").value = prefill?.type ?? "image";
  $("#cm-kind").value = prefill?.kind ?? "text-to-image";
  $("#cm-prompt").value = prefill?.promptParam ?? "prompt";
  $("#cm-ref-param").value = prefill?.referenceImages?.param ?? "";
  // 设置参考图 radio
  const refMode = prefill?.referenceImages?.multiple
    ? "multiple"
    : prefill?.referenceImages
    ? "single"
    : "none";
  document.querySelector(`input[name="cm-ref"][value="${refMode}"]`).checked = true;
  $("#cm-ar").value = prefill?.aspectRatio?.param ?? "";
  $("#cm-num").value = prefill?.numImages?.param ?? "";
  $("#cm-notes").value = prefill?.notes ?? "";
  $("#customModal").hidden = false;
}

function closeCustomModal() {
  $("#customModal").hidden = true;
}

async function onSaveCustomModel(e) {
  e.preventDefault();
  const id = $("#cm-id").value.trim();
  const label = $("#cm-label").value.trim();
  if (!id || !label) {
    alert("id 和 label 必填");
    return;
  }
  const refMode = document.querySelector('input[name="cm-ref"]:checked').value;
  const refParam = $("#cm-ref-param").value.trim();
  const ref =
    refMode === "none" || !refParam
      ? null
      : { param: refParam, multiple: refMode === "multiple" };
  const arParam = $("#cm-ar").value.trim();
  const numParam = $("#cm-num").value.trim();

  const model = {
    id,
    label,
    type: $("#cm-type").value,
    kind: $("#cm-kind").value,
    isDefault: false,
    promptParam: $("#cm-prompt").value.trim() || "prompt",
    referenceImages: ref,
    aspectRatio: arParam ? { param: arParam } : null,
    numImages: numParam ? { param: numParam } : null,
    duration: null,
    notes: $("#cm-notes").value.trim() || undefined,
  };

  const res = await fetch("/api/custom-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    alert(`保存失败:${j.error ?? res.status}`);
    return;
  }
  closeCustomModal();
  await Promise.all([loadModels(), loadCustomModels()]);
  // 自动选中新模型
  $("#model").value = id;
  onModelChange();
}

async function onDeleteCustomModel(id) {
  if (!confirm(`删除自定义模型 ${id}?`)) return;
  const res = await fetch(
    `/api/custom-models/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    alert(`删除失败:${j.error ?? res.status}`);
    return;
  }
  await Promise.all([loadModels(), loadCustomModels()]);
}

init();