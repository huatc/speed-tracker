// Renders the last-2-hours speed chart on history.html.
// Reads data from SpeedLogger; threshold is fixed at 6 mph (the "in a car" line).

(() => {
  const MPH_TO_KMH = 1.609344;
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const empty = document.getElementById('chartEmpty');

  const out = {
    max: document.getElementById('hMax'),
    now: document.getElementById('hNow'),
    count: document.getElementById('hCount'),
    over: document.getElementById('hOver'),
  };

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const COLORS = {
    grid: css('--track'),
    text: css('--muted'),
    accent: css('--accent'),
    danger: css('--danger'),
    fg: css('--fg'),
  };

  function unit() {
    return localStorage.getItem('unit') === 'kmh'
      ? { label: 'km/h', factor: MPH_TO_KMH }
      : { label: 'mph', factor: 1 };
  }

  // Convert a 1-decimal mph value into the display unit.
  const disp = (mph, u) => mph * u.factor;

  const GAP_MS = 150_000; // break the line if readings are >150s apart

  let layout = null; // saved geometry for tooltip hit-testing
  let points = []; // [{t, v}] (v in display unit), saved for tooltip
  let hover = null; // pointer x in CSS px, or null

  function fmtTime(t) {
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDuration(ms) {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function draw() {
    const u = unit();
    const data = SpeedLogger.getHistory(); // [{t, v(mph)}]
    const now = Date.now();
    const tMin = now - SpeedLogger.WINDOW_MS;
    const thresholdDisp = disp(SpeedLogger.THRESHOLD_MPH, u);

    // --- stats ---
    const maxMph = data.reduce((m, p) => Math.max(m, p.v), 0);
    out.max.textContent = `${disp(maxMph, u).toFixed(0)} ${u.label}`;
    out.count.textContent = String(data.length);
    out.now.textContent = data.length
      ? `${disp(data[data.length - 1].v, u).toFixed(0)} ${u.label}`
      : `0 ${u.label}`;

    // Estimated time spent over the threshold (sum of gaps where speed > 6mph).
    let overMs = 0;
    for (let i = 1; i < data.length; i++) {
      const dt = data[i].t - data[i - 1].t;
      if (dt <= GAP_MS && data[i].v > SpeedLogger.THRESHOLD_MPH) overMs += dt;
    }
    out.over.textContent = fmtDuration(overMs);

    empty.style.display = data.length ? 'none' : 'block';

    // --- canvas sizing (handle DPR for crispness) ---
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0 || cssW > 4000 || cssH > 4000) return; // bad layout, skip
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 38, padR = 12, padT = 12, padB = 26;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    const yMaxBase = u.label === 'mph' ? 20 : 30;
    const yMax = Math.max(yMaxBase, Math.ceil((disp(maxMph, u) * 1.15) / 10) * 10);

    const xOf = (t) => padL + ((t - tMin) / SpeedLogger.WINDOW_MS) * plotW;
    const yOf = (v) => padT + (1 - v / yMax) * plotH;

    layout = { padL, padR, padT, padB, plotW, plotH, tMin, now, yMax, xOf, yOf, u };

    // --- y grid + labels ---
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const v = (yMax / ySteps) * i;
      const y = yOf(v);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(v)), padL - 6, y);
    }

    // --- x grid + time labels (every 30 min) ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let m = 0; m <= 120; m += 30) {
      const t = tMin + m * 60_000;
      const x = xOf(t);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(fmtTime(t), x, padT + plotH + 6);
    }

    // --- threshold line (6 mph) ---
    if (thresholdDisp <= yMax) {
      const yT = yOf(thresholdDisp);
      ctx.strokeStyle = COLORS.danger;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, yT);
      ctx.lineTo(cssW - padR, yT);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.danger;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`6 mph (car)`, padL + 4, yT - 2);
    }

    // --- data line (segmented; red above threshold, accent below) ---
    points = data.map((p) => ({ t: p.t, v: disp(p.v, u), mph: p.v }));
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 1; i < data.length; i++) {
      const a = data[i - 1], b = data[i];
      if (b.t - a.t > GAP_MS) continue; // break line across gaps
      ctx.strokeStyle =
        b.v > SpeedLogger.THRESHOLD_MPH ? COLORS.danger : COLORS.accent;
      ctx.beginPath();
      ctx.moveTo(xOf(a.t), yOf(disp(a.v, u)));
      ctx.lineTo(xOf(b.t), yOf(disp(b.v, u)));
      ctx.stroke();
    }
    // single-point case: draw a dot so it's visible
    if (data.length === 1) {
      const p = data[0];
      ctx.fillStyle = p.v > SpeedLogger.THRESHOLD_MPH ? COLORS.danger : COLORS.accent;
      ctx.beginPath();
      ctx.arc(xOf(p.t), yOf(disp(p.v, u)), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    drawHover();
  }

  function drawHover() {
    if (hover == null || !layout || points.length === 0) return;
    const u = layout.u;
    // nearest point by x
    let best = null, bestDx = Infinity;
    for (const p of points) {
      const dx = Math.abs(layout.xOf(p.t) - hover);
      if (dx < bestDx) { bestDx = dx; best = p; }
    }
    if (!best || bestDx > 40) return;

    const x = layout.xOf(best.t);
    const y = layout.yOf(best.v);

    ctx.strokeStyle = COLORS.text;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, layout.padT);
    ctx.lineTo(x, layout.padT + layout.plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = best.mph > SpeedLogger.THRESHOLD_MPH ? COLORS.danger : COLORS.accent;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    const label = `${best.v.toFixed(0)} ${u.label}  ·  ${fmtTime(best.t)}`;
    ctx.font = '12px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 14;
    const h = 22;
    let bx = x + 8;
    if (bx + w > canvas.clientWidth - layout.padR) bx = x - 8 - w;
    const by = Math.max(layout.padT, y - h - 8);

    ctx.fillStyle = css('--bg-elev');
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    roundRect(bx, by, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 7, by + h / 2);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- interactions ---
  function pointerX(e) {
    const rect = canvas.getBoundingClientRect();
    return (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  }
  canvas.addEventListener('pointermove', (e) => { hover = pointerX(e); draw(); });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Clear all recorded speed history?')) {
      SpeedLogger.clear();
      draw();
    }
  });

  // --- refresh loop ---
  window.addEventListener('speedsample', draw);
  window.addEventListener('resize', draw);
  setInterval(draw, 3000); // also catches writes from other tabs / time scrolling
  draw();
})();
