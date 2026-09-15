// 右侧顶部三表盘（章节 7.1）—— 风速 / 马赫数 / 攻角 圆弧仪表
export class Gauge {
  constructor(canvas, opt) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opt = opt; // {min, max, value, label, unit, danger: (v)=>bool, fmt}
    this.value = opt.min;
  }

  draw() {
    const { ctx, cv } = this;
    const W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2 + 8, r = Math.min(W, H) / 2 - 14;
    const o = this.opt;
    ctx.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const frac = Math.max(0, Math.min(1, (this.value - o.min) / (o.max - o.min)));
    const av = a0 + (a1 - a0) * frac;

    // 背景弧
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(120,150,180,0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();

    // 值弧
    const grd = ctx.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#00E5FF');
    grd.addColorStop(1, o.danger && o.danger(this.value) ? '#FF5252' : '#FFB300');
    ctx.strokeStyle = grd;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, av); ctx.stroke();

    // 刻度
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(160,190,220,0.5)';
    ctx.fillStyle = 'rgba(160,190,220,0.65)';
    ctx.font = '9px "DIN Alternate", PingFang SC, monospace';
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (a1 - a0) * (i / 4);
      const sx = cx + Math.cos(a) * (r + 6), sy = cy + Math.sin(a) * (r + 6);
      const ex = cx + Math.cos(a) * (r + 11), ey = cy + Math.sin(a) * (r + 11);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      const tx = cx + Math.cos(a) * (r + 22), ty = cy + Math.sin(a) * (r + 22);
      const tv = o.min + (o.max - o.min) * (i / 4);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.tickFmt ? o.tickFmt(tv) : Math.round(tv), tx, ty);
    }

    // 指针
    ctx.strokeStyle = '#FFB300';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(av) * (r - 14), cy + Math.sin(av) * (r - 14));
    ctx.lineTo(cx + Math.cos(av) * (r + 2), cy + Math.sin(av) * (r + 2));
    ctx.stroke();

    // 数值
    ctx.fillStyle = '#EAF6FF';
    ctx.font = '600 20px "DIN Alternate", "SF Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(o.fmt ? o.fmt(this.value) : this.value.toFixed(0), cx, cy - 4);
    ctx.fillStyle = 'rgba(160,190,220,0.7)';
    ctx.font = '10px PingFang SC, sans-serif';
    ctx.fillText(o.label + (o.unit ? ' ' + o.unit : ''), cx, cy + 16);
  }
}
