/* ===== AI 网页 PPT 生成器 — 前端逻辑 ===== */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const el = {
    input: $("#input-text"),
    generate: $("#btn-generate"),
    stop: $("#btn-stop"),
    clear: $("#btn-clear"),
    charCount: $("#char-count"),
    modelBadge: $("#model-badge"),
    stageEmpty: $("#stage-empty"),
    deck: $("#deck"),
    pager: $("#pager"),
    progressWrap: $("#progress-wrap"),
    progressLabel: $("#progress-label"),
    progressCount: $("#progress-count"),
    progressFill: $("#progress-fill"),
    controls: $("#stage-controls"),
    prev: $("#btn-prev"),
    next: $("#btn-next"),
    fullscreen: $("#btn-fullscreen"),
    theme: $("#theme-select"),
    exportBtn: $("#btn-export"),
    pageHint: $("#page-hint"),
    toast: $("#toast"),
  };

  const state = {
    deck: null, // { title, subtitle, slides: [{title,subtitle,bullets,notes}] }
    current: 0,
    generating: false,
    abort: null,
  };

  // ---------- 工具 ----------
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2600);
  }

  function updateCharCount() {
    el.charCount.textContent = `${el.input.value.length} 字`;
  }

  // ---------- 元信息 ----------
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
      el.modelBadge.textContent = c.hasApiKey
        ? `模型:${c.model}`
        : "⚠ 未找到 API Key";
      if (!c.hasApiKey) toast("未找到 DeepSeek API Key,请检查 ~/.dsh/.credentials.yaml");
    })
    .catch(() => {
      el.modelBadge.textContent = "后端未连接";
    });

  // ---------- 幻灯片构建 ----------
  function layoutOf(index, total) {
    if (index === 0) return "cover";
    if (index === total - 1) return "end";
    const slide = state.deck.slides[index];
    if (slide && !slide.bullets?.length && slide.title) return "section";
    return "content";
  }

  function buildSlideElement(slide, index, total) {
    const layout = layoutOf(index, total);
    const elDiv = document.createElement("section");
    elDiv.className = `slide slide--${layout}`;

    const title = document.createElement("h2");
    title.className = "slide__title";
    title.textContent = slide?.title || "";

    elDiv.appendChild(title);

    if (slide?.subtitle) {
      const sub = document.createElement("p");
      sub.className = "slide__subtitle";
      sub.textContent = slide.subtitle;
      elDiv.appendChild(sub);
    }

    if (slide?.bullets?.length) {
      const ul = document.createElement("ul");
      ul.className = "slide__bullets";
      slide.bullets.forEach((b, i) => {
        const li = document.createElement("li");
        li.textContent = b;
        li.style.setProperty("--i", i);
        ul.appendChild(li);
      });
      elDiv.appendChild(ul);
    }

    if (slide?.notes) {
      const notes = document.createElement("p");
      notes.className = "slide__notes";
      notes.textContent = `🗒 ${slide.notes}`;
      elDiv.appendChild(notes);
    }

    return elDiv;
  }

  function renderDeck(deck) {
    state.deck = deck;
    state.current = 0;

    // 清空旧幻灯片(progress-wrap 已在 deck 外,不受影响)
    el.deck.querySelectorAll(".slide").forEach((s) => s.remove());
    el.deck.querySelectorAll(".deck__pager").forEach((n) => n.remove());
    // 重新挂载 pager(保持顺序在最后)
    const pager = document.createElement("div");
    pager.className = "deck__pager";
    pager.id = "pager";
    el.deck.appendChild(pager);
    el.pager = pager;

    const total = deck.slides.length;
    // 封面 + 内容页 + 结束页
    const coverSlide = { title: deck.title || "演示文稿", subtitle: deck.subtitle || "" };
    const slides = [coverSlide, ...deck.slides, { title: "谢谢观看", subtitle: "— END —" }];

    slides.forEach((s, i) => {
      const node = buildSlideElement(s, i, slides.length);
      if (i === 0) node.classList.add("is-active");
      el.deck.appendChild(node);
    });

    el.deck.hidden = false;
    el.stageEmpty.hidden = true;
    el.controls.hidden = false;
    updatePager();
  }

  function updatePager() {
    const total = el.deck.querySelectorAll(".slide").length;
    el.pageHint.textContent = `${state.current + 1} / ${total}`;
    el.pager.textContent = `${String(state.current + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    el.deck.querySelectorAll(".slide").forEach((s, i) => {
      s.classList.toggle("is-active", i === state.current);
      s.classList.toggle("is-prev", i < state.current);
    });
  }

  function goTo(index) {
    const total = el.deck.querySelectorAll(".slide").length;
    state.current = Math.max(0, Math.min(total - 1, index));
    updatePager();
  }
  function goNext() { goTo(state.current + 1); }
  function goPrev() { goTo(state.current - 1); }

  // ---------- 流式生成 ----------
  async function generate() {
    const text = el.input.value.trim();
    if (!text) { toast("请先粘贴文案"); return; }
    if (state.generating) return;

    state.generating = true;
    state.abort = new AbortController();
    el.generate.disabled = true;
    el.stop.disabled = false;
    el.stageEmpty.hidden = true;
    el.progressWrap.hidden = false;
    el.progressFill.style.width = "0%";
    el.progressLabel.textContent = "正在调用模型…";
    el.progressCount.textContent = "";

    let received = 0;
    const start = performance.now();

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: state.abort.signal,
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = raw.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          let payload;
          try { payload = JSON.parse(data); } catch { continue; }

          if (event === "meta") {
            el.progressLabel.textContent = `模型 ${payload.model} 生成中…`;
          } else if (event === "delta") {
            received += payload.text.length;
            const secs = Math.max(1, (performance.now() - start) / 1000);
            const rate = Math.round(received / secs);
            el.progressCount.textContent = `${received} 字 · ${rate} 字/秒`;
            // 无上限进度条:用字数近似
            const pct = Math.min(95, 10 + Math.log10(received + 1) * 22);
            el.progressFill.style.width = `${pct}%`;
            el.progressLabel.textContent = "模型正在拆解文案…";
          } else if (event === "done") {
            el.progressFill.style.width = "100%";
            el.progressLabel.textContent = "生成完成 ✅";
            renderDeck(payload.deck);
          } else if (event === "error") {
            throw new Error(payload.message || "生成失败");
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        toast("已停止生成");
      } else {
        console.error(err);
        toast(`生成失败:${err.message}`);
      }
    } finally {
      state.generating = false;
      el.generate.disabled = false;
      el.stop.disabled = true;
      el.progressWrap.hidden = true;
      if (!el.deck.querySelectorAll(".slide").length) {
        el.stageEmpty.hidden = false;
      }
    }
  }

  function stop() {
    state.abort?.abort();
  }

  // ---------- 主题 ----------
  function applyTheme(theme) {
    el.deck.dataset.theme = theme;
    localStorage.setItem("ppt-theme", theme);
  }

  // ---------- 全屏 ----------
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.deck.requestFullscreen?.();
    }
  }

  // ---------- 导出独立 HTML ----------
  function exportHTML() {
    if (!state.deck) { toast("请先生成 PPT"); return; }

    const theme = el.theme.value;
    const deck = state.deck;
    const cover = { title: deck.title || "演示文稿", subtitle: deck.subtitle || "" };
    const slides = [cover, ...deck.slides, { title: "谢谢观看", subtitle: "— END —" }];

    const slideHtml = slides
      .map((s, i) => {
        const layout = i === 0 ? "cover" : i === slides.length - 1 ? "end"
          : (!s.bullets?.length ? "section" : "content");
        const title = `<h2 class="slide__title">${escapeHtml(s.title || "")}</h2>`;
        const subtitle = s.subtitle ? `<p class="slide__subtitle">${escapeHtml(s.subtitle)}</p>` : "";
        const bullets = s.bullets?.length
          ? `<ul class="slide__bullets">${s.bullets.map((b, j) => `<li style="--i:${j}">${escapeHtml(b)}</li>`).join("")}</ul>`
          : "";
        const notes = s.notes ? `<p class="slide__notes">🗒 ${escapeHtml(s.notes)}</p>` : "";
        return `<section class="slide slide--${layout}${i === 0 ? " is-active" : ""}">${title}${subtitle}${bullets}${notes}</section>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(deck.title || "演示文稿")}</title>
<style>
:root{--font-deck:"PingFang SC","Microsoft YaHei",-apple-system,"Segoe UI",sans-serif;--font-mono:"SF Mono","Cascadia Code",Menlo,Consolas,monospace}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#04060d;overflow:hidden}
.deck{--w:1000;--h:600;position:relative;width:100vw;height:100vh;overflow:hidden;isolation:isolate;counter-reset:slide}
.deck[data-theme="midnight"]{--bg:#060a1a;--bg-soft:#101838;--fg:#eef2ff;--accent:#5b8cff;--accent2:#9d6bff;--grid:rgba(110,140,255,.07);--glow:rgba(91,140,255,.16);--glow-strong:rgba(91,140,255,.55);background:linear-gradient(160deg,var(--bg),var(--bg-soft));color:var(--fg)}
.deck[data-theme="ocean"]{--bg:#041822;--bg-soft:#0a3a4e;--fg:#eafcff;--accent:#22d3ee;--accent2:#4fd6b4;--grid:rgba(64,220,255,.07);--glow:rgba(34,211,238,.15);--glow-strong:rgba(34,211,238,.5);background:linear-gradient(160deg,var(--bg),var(--bg-soft));color:var(--fg)}
.deck[data-theme="sunset"]{--bg:#1c0a1e;--bg-soft:#45173a;--fg:#fff3ec;--accent:#ff7a45;--accent2:#ffc46b;--grid:rgba(255,150,100,.07);--glow:rgba(255,122,69,.15);--glow-strong:rgba(255,122,69,.5);background:linear-gradient(160deg,var(--bg),var(--bg-soft));color:var(--fg)}
.deck[data-theme="forest"]{--bg:#07180f;--bg-soft:#10391f;--fg:#eefcf3;--accent:#2ee6a8;--accent2:#a3e86a;--grid:rgba(70,230,170,.06);--glow:rgba(46,230,168,.13);--glow-strong:rgba(46,230,168,.45);background:linear-gradient(160deg,var(--bg),var(--bg-soft));color:var(--fg)}
.deck[data-theme="paper"]{--bg:#f7f9fc;--bg-soft:#e8edf6;--fg:#1c2536;--accent:#2563eb;--accent2:#7c3aed;--grid:rgba(37,99,235,.06);--glow:rgba(37,99,235,.07);--glow-strong:rgba(37,99,235,.3);--note-line:rgba(0,0,0,.12);background:linear-gradient(160deg,var(--bg),var(--bg-soft));color:var(--fg)}
.slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:8% 9%;opacity:0;pointer-events:none;transition:opacity .4s ease,transform .4s ease;transform:translateX(3%);overflow:hidden;counter-increment:slide}
.slide.is-active{opacity:1;pointer-events:auto;transform:translateX(0)}
.slide::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(65% 55% at 50% 0%,var(--glow) 0%,transparent 70%),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:100% 100%,46px 46px,46px 46px;pointer-events:none}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.slide.is-active .slide__title,.slide.is-active .slide__subtitle,.slide.is-active .slide__bullets li{animation:rise .55s cubic-bezier(.2,.7,.3,1) both}
.slide.is-active .slide__subtitle{animation-delay:.08s}
.slide.is-active .slide__bullets li{animation-delay:calc(.16s + var(--i,0)*.07s)}
.slide__title{font-family:var(--font-deck);font-weight:800;margin:0 0 .35em;line-height:1.2;letter-spacing:1px}
.slide__subtitle{opacity:.78;margin:0 0 1.2em;font-weight:500;letter-spacing:2px}
.slide__bullets{margin:0;padding-left:0;list-style:none}
.slide__bullets li{position:relative;padding-left:1.5em;margin-bottom:.65em;line-height:1.55}
.slide__bullets li::before{content:"";position:absolute;left:.1em;top:.52em;width:.4em;height:.4em;transform:rotate(45deg);background:var(--accent);box-shadow:0 0 9px var(--glow-strong)}
.slide--cover,.slide--section,.slide--end{text-align:center;align-items:center}
.slide--cover .slide__title{font-size:clamp(34px,7vw,72px);background:linear-gradient(100deg,#fff 0%,var(--accent) 48%,var(--accent2) 85%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 16px var(--glow-strong))}
.deck[data-theme="paper"] .slide--cover .slide__title{filter:none}
.slide--cover .slide__subtitle{font-size:clamp(15px,2.4vw,26px)}
.slide--cover::after{content:"";position:absolute;inset:5% 6%;pointer-events:none;opacity:.85;background:linear-gradient(var(--accent),var(--accent)) top left/26px 2px,linear-gradient(var(--accent),var(--accent)) top left/2px 26px,linear-gradient(var(--accent),var(--accent)) top right/26px 2px,linear-gradient(var(--accent),var(--accent)) top right/2px 26px,linear-gradient(var(--accent),var(--accent)) bottom left/26px 2px,linear-gradient(var(--accent),var(--accent)) bottom left/2px 26px,linear-gradient(var(--accent),var(--accent)) bottom right/26px 2px,linear-gradient(var(--accent),var(--accent)) bottom right/2px 26px;background-repeat:no-repeat}
.slide--section .slide__title{font-size:clamp(28px,5.5vw,54px)}
.slide--section::after{content:counter(slide,decimal-leading-zero);position:absolute;right:4%;bottom:2%;font-family:var(--font-mono);font-size:clamp(80px,26vw,260px);font-weight:700;line-height:1;color:var(--fg);opacity:.06;pointer-events:none}
.slide--content .slide__title{font-size:clamp(22px,4.2vw,42px)}
.slide--content .slide__title::after,.slide--section .slide__title::after{content:"";display:block;width:58px;height:3px;margin-top:.4em;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 14px var(--glow-strong)}
.slide--section .slide__title::after{margin-left:auto;margin-right:auto}
.slide--content .slide__subtitle{font-size:clamp(13px,2vw,20px)}
.slide--content .slide__bullets li{font-size:clamp(15px,2.6vw,26px)}
.slide--content::after{content:"";position:absolute;inset:4.5% 5%;pointer-events:none;opacity:.4;background:linear-gradient(var(--accent),var(--accent)) top left/14px 1px,linear-gradient(var(--accent),var(--accent)) top left/1px 14px,linear-gradient(var(--accent),var(--accent)) bottom right/14px 1px,linear-gradient(var(--accent),var(--accent)) bottom right/1px 14px;background-repeat:no-repeat}
.slide--end .slide__title{font-size:clamp(26px,5vw,50px)}
.slide--end .slide__subtitle{font-size:clamp(14px,2.4vw,24px)}
.slide__notes{position:absolute;left:9%;right:9%;bottom:4%;font-size:clamp(11px,1.4vw,13px);opacity:.55;border-top:1px solid var(--note-line,rgba(255,255,255,.15));padding-top:8px;margin:0}
.deck[data-theme="paper"] .slide__notes{border-top-color:rgba(0,0,0,.12)}
.deck__pager{position:absolute;right:4%;bottom:3%;font-family:var(--font-mono);font-size:12px;letter-spacing:1px;opacity:.65;z-index:5;color:var(--accent)}
.toolbar{position:fixed;left:12px;bottom:12px;display:flex;gap:8px;z-index:20;opacity:.45;transition:opacity .2s}
.toolbar:hover{opacity:1}
.toolbar button{font-family:var(--font-deck);font-size:12px;border:1px solid rgba(120,150,255,.4);background:rgba(4,8,18,.5);color:#eee;border-radius:6px;padding:5px 10px;cursor:pointer;backdrop-filter:blur(6px)}
.deck[data-theme="paper"] .toolbar button{background:rgba(255,255,255,.5);color:#333;border-color:rgba(60,80,140,.3)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01s!important}}
</style>
</head>
<body>
<div class="deck" id="deck" data-theme="${theme}">
${slideHtml}
<div class="deck__pager" id="pager"></div>
<div class="toolbar">
  <button onclick="toggleFull()">⛶ 全屏</button>
  <button onclick="cycleTheme()">🎨 换主题</button>
</div>
</div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll(".slide"));
  var i=0;var themes=["midnight","ocean","sunset","forest","paper"];
  function render(){slides.forEach(function(s,j){s.classList.toggle("is-active",j===i)});document.getElementById("pager").textContent=("0"+(i+1)).slice(-2)+" / "+("0"+slides.length).slice(-2)}
  function go(n){i=Math.max(0,Math.min(slides.length-1,n));render()}
  document.addEventListener("keydown",function(e){
    if(e.key==="ArrowRight"||e.key==="PageDown"||e.key===" "){e.preventDefault();go(i+1)}
    else if(e.key==="ArrowLeft"||e.key==="PageUp"){e.preventDefault();go(i-1)}
    else if(e.key==="Home"){go(0)}
    else if(e.key==="End"){go(slides.length-1)}
    else if(e.key==="f"||e.key==="F"){toggleFull()}
  });
  document.addEventListener("click",function(e){if(e.clientX>window.innerWidth*0.7)go(i+1);else if(e.clientX<window.innerWidth*0.3)go(i-1)});
  window.toggleFull=function(){var d=document.getElementById("deck");if(document.fullscreenElement)document.exitFullscreen();else d.requestFullscreen&&d.requestFullscreen()};
  window.cycleTheme=function(){var d=document.getElementById("deck");var t=themes[(themes.indexOf(d.dataset.theme)+1)%themes.length];d.dataset.theme=t};
  render();
})();
<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(deck.title || "ppt")}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已导出独立 HTML 文件");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function sanitizeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "ppt";
  }

  // ---------- 事件绑定 ----------
  el.input.addEventListener("input", updateCharCount);
  el.generate.addEventListener("click", generate);
  el.stop.addEventListener("click", stop);
  el.clear.addEventListener("click", () => {
    el.input.value = "";
    updateCharCount();
  });
  el.prev.addEventListener("click", goPrev);
  el.next.addEventListener("click", goNext);
  el.fullscreen.addEventListener("click", toggleFullscreen);
  el.exportBtn.addEventListener("click", exportHTML);
  el.theme.addEventListener("change", (e) => applyTheme(e.target.value));

  // 键盘翻页(非输入状态下)
  document.addEventListener("keydown", (e) => {
    if (!state.deck) return;
    const tag = document.activeElement?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goNext(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goPrev(); }
    else if (e.key === "Home") { goTo(0); }
    else if (e.key === "End") { goTo(el.deck.querySelectorAll(".slide").length - 1); }
    else if (e.key === "f" || e.key === "F") { toggleFullscreen(); }
  });

  // 点击舞台左右区域翻页(导出文件里也有)
  el.deck.addEventListener("click", (e) => {
    if (!state.deck) return;
    if (e.clientX > window.innerWidth * 0.7) goNext();
    else if (e.clientX < window.innerWidth * 0.3) goPrev();
  });

  // 恢复主题
  const savedTheme = localStorage.getItem("ppt-theme");
  if (savedTheme) {
    el.theme.value = savedTheme;
    el.deck.dataset.theme = savedTheme;
  }

  updateCharCount();
})();
