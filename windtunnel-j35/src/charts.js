// 时间历程图表（章节八）—— 6 个折线图 + 暂停/单步/清空
const CAP = 1200; // 60 s @ 20 Hz

export class Charts {
  constructor(ids) {
    this.charts = ids.map((id, i) => ({
      cv: document.getElementById(id),
      kind: i < 2 || i >= 4 ? 'time' : 'alpha', // 1/2/5/6 时间轴；3/4 是 CL-α / CD-α
      series: { t: [], v: [] },
      color: ['#FFB300', '#FF7043', '#00E5FF', '#7CFFB2', '#B388FF', '#FFD54F'][i],
      idx: i,
    }));
    this.t = 0;
  }

  push(t, aero, alpha) {
    const vals = [aero.L, aero.D, aero.CL, aero.CD, aero.LD, aero.xcp];
    for (let i = 0; i < 6; i++) {
      const ch = this.charts[i];
      const s = ch.series;
      s.t.push(ch.kind === 'alpha' ? alpha : t);
      s.v.push(vals[i]);
      if (s.t.length > CAP) { s.t.shift(); s.v.shift(); }
    }
    this.drawAll();
  }

  clear() {
    for (const ch of this.charts) { ch.series.t.length = 0; ch.series.v.length = 0; }
    this.drawAll();
  }

  stepOnce(aeroFns) { /* 由 main 调用：采样一次 */ }

  drawAll() {
    for (const ch of this.charts) this.draw(ch);
  }

  draw(ch) {
    const cv = ch.cv, ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // 底框
    ctx.strokeStyle = 'rgba(120,150,180,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    const s = ch.series;
    if (s.v.length < 2) return;
    let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < s.v.length; i++) {
      if (s.v[i] < ymin) ymin = s.v[i];
      if (s.v[i] > ymax) ymax = s.v[i];
      if (s.t[i] < xmin) xmin = s.t[i];
      if (s.t[i] > xmax) xmax = s.t[i];
    }
    const pad = (ymax - ymin) * 0.12 + 1e-6;
    ymin -= pad; ymax += pad;
    if (xmax - xmin < 1e-6) xmax = xmin + 1;
    const X = (t) => 4 + (t - xmin) / (xmax - xmin) * (W - 10);
    const Y = (v) => H - 5 - (v - ymin) / (ymax - ymin) * (H - 12);

    // 零线
    if (ymin < 0 && ymax > 0) {
      ctx.strokeStyle = 'rgba(120,150,180,0.18)';
      ctx.beginPath(); ctx.moveTo(4, Y(0)); ctx.lineTo(W - 5, Y(0)); ctx.stroke();
    }
    // 曲线
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(X(s.t[0]), Y(s.v[0]));
    for (let i = 1; i < s.v.length; i++) ctx.lineTo(X(s.t[i]), Y(s.v[i]));
    ctx.stroke();
    // 最新值标记
    ctx.fillStyle = ch.color;
    ctx.beginPath();
    ctx.arc(X(s.t[s.t.length - 1]), Y(s.v[s.v.length - 1]), 2, 0, Math.PI * 2);
    ctx.fill();
    // 当前值文本
    ctx.font = '9px "DIN Alternate", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(s.v[s.v.length - 1].toFixed(2), W - 6, 11);
  }
}
