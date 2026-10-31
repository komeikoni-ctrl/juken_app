// ============================================================
// 🎨 CanvasFX — Canvas 描画レイヤー（v2027.11.01-1 で新設）
// ------------------------------------------------------------
// 役割分担: グラフ（軸・ツールチップが要るもの）は Chart.js、
// 「動き」が本体のものはここが Canvas で描く。
//   1. 背景の環境光（従来の blur(90px) の DOM オーブを置換）
//   2. 今日の学習リング（従来は render のたび SVG を作り直していた）
//   3. タイマーの進捗リング（残り／経過を数字の周りの弧で見せる）
//   4. 紙吹雪（実績解除・タスク完了。従来は div 60個生成）
// 共通の約束:
//   - 解像度は devicePixelRatio 最大2で頭打ち（iPhone の DPR3 全面描画をしない）
//   - 画面が隠れたら止める／ prefers-reduced-motion では静止画にする
//   - 色は CSS 変数（--accent 等）から取るので 3スタイル＋ダークに追随する
// ============================================================
const CanvasFX = (() => {
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
  const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const cssVar = (name, fallback) => {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
    catch (e) { return fallback; }
  };
  // '#rgb' / '#rrggbb' / 'rgb()' を rgba() 文字列にする。変換できなければそのまま返す
  const rgba = (color, a) => {
    const c = String(color || '').trim();
    const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let h = hex[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
      return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
    }
    const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) { const p = rgb[1].split(',').map(x => x.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return c;
  };
  // canvas の実ピクセルを CSS サイズ × dpr に合わせる（既に合っていれば何もしない）
  const fit = (cv) => {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    const d = dpr(), W = Math.round(w * d), H = Math.round(h * d);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx, w, h };
  };

  // ---------- 1. 背景の環境光 ----------
  let bg = null; // {cv, t0, raf, last}
  const BG_BLOBS = [
    { rx: 0.16, ry: 0.10, r: 0.55, varName: '--accent', a: 0.16, sx: 0.05, sy: 0.03, p: 0.0 },
    { rx: 0.86, ry: 0.72, r: 0.62, varName: '--pur', a: 0.15, sx: 0.04, sy: 0.05, p: 2.1 },
    { rx: 0.72, ry: 0.06, r: 0.40, varName: '--a4', a: 0.10, sx: 0.03, sy: 0.04, p: 4.2 }
  ];
  const drawBg = (t) => {
    if (!bg) return;
    const f = fit(bg.cv); if (!f) return;
    const { ctx, w, h } = f;
    ctx.clearRect(0, 0, w, h);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (!document.documentElement.getAttribute('data-theme') && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    for (const b of BG_BLOBS) {
      const tt = reduced() ? 0 : t / 1000;
      const cx = (b.rx + Math.sin(tt * 0.11 + b.p) * b.sx) * w;
      const cy = (b.ry + Math.cos(tt * 0.09 + b.p) * b.sy) * h;
      const r = b.r * Math.max(w, h) * 0.5;
      const col = cssVar(b.varName, '#007aff');
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(col, b.a * (dark ? 1.5 : 1)));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  };
  const bgLoop = (t) => {
    if (!bg) return;
    if (!document.hidden && t - bg.last > 40) { bg.last = t; drawBg(t); } // 約25fpsに間引く
    bg.raf = requestAnimationFrame(bgLoop);
  };
  const initBg = () => {
    if (document.getElementById('fx-bg')) return;
    const cv = document.createElement('canvas');
    cv.id = 'fx-bg'; cv.setAttribute('aria-hidden', 'true');
    document.body.prepend(cv);
    document.documentElement.classList.add('fx-on'); // DOMオーブを消す合図（CSS側）
    bg = { cv, last: 0, raf: 0 };
    drawBg(0);
    if (!reduced()) bg.raf = requestAnimationFrame(bgLoop);
  };

  // ---------- 2/3. リング（今日の学習・タイマー共通） ----------
  const ringState = new Map(); // key -> {val, raf}
  const drawRingNow = (cv, val, color, track, text) => {
    const f = fit(cv); if (!f) return;
    const { ctx, w, h } = f;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(5, Math.min(w, h) * 0.08);
    ctx.lineCap = 'round';
    ctx.strokeStyle = track;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (val > 0) {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(val)); ctx.stroke();
      // 先端の光点
      const ang = -Math.PI / 2 + Math.PI * 2 * clamp01(val);
      ctx.fillStyle = color;
      ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx + r * Math.cos(ang), cy + r * Math.sin(ang), ctx.lineWidth * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (text != null) {
      ctx.fillStyle = color;
      ctx.font = `900 ${Math.round(Math.min(w, h) * 0.17)}px -apple-system, 'Hiragino Sans', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy + 1);
    }
  };
  // val(0..1) へ滑らかに寄せる。前の canvas が破棄されても key で値を引き継ぐ
  const ring = (cv, val, opts = {}) => {
    if (!cv) return;
    const key = opts.key || 'ring';
    const color = opts.color || cssVar('--accent', '#007aff');
    const track = opts.track || 'rgba(128,128,140,0.18)';
    const text = opts.text != null ? opts.text : null;
    let st = ringState.get(key);
    if (!st) { st = { val: 0, raf: 0 }; ringState.set(key, st); }
    cancelAnimationFrame(st.raf);
    const from = st.val, to = clamp01(val), t0 = performance.now(), dur = reduced() ? 0 : 600;
    const step = (t) => {
      const p = dur ? easeOut((t - t0) / dur) : 1;
      st.val = from + (to - from) * p;
      if (cv.isConnected) drawRingNow(cv, st.val, color, track, text);
      if (p < 1) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  };

  // ---------- 4. 紙吹雪 ----------
  const CONFETTI_MAX = 140;
  let confetti = null; // {cv, parts, raf}
  const celebrate = (n = 80, origin) => {
    if (reduced()) return 0;
    const count = Math.max(0, Math.min(CONFETTI_MAX, Math.round(n) || 0));
    if (!count) return 0;
    let cv = document.getElementById('fx-confetti');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'fx-confetti'; cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
    }
    const colors = ['#1d4ed8', '#16a05a', '#dc4f1e', '#c07010', '#6030b8', cssVar('--accent', '#007aff')];
    const ox = origin?.x != null ? origin.x : window.innerWidth / 2;
    const oy = origin?.y != null ? origin.y : window.innerHeight * 0.3;
    const parts = Array.from({ length: count }, (_, i) => ({
      x: ox + (Math.random() - 0.5) * 120, y: oy + (Math.random() - 0.5) * 24,
      vx: (Math.random() - 0.5) * 7, vy: -(4 + Math.random() * 7),
      w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length], life: 1
    }));
    if (confetti) cancelAnimationFrame(confetti.raf);
    confetti = { cv, parts, raf: 0 };
    const t0 = performance.now();
    const tick = (t) => {
      if (!confetti || confetti.cv !== cv) return;
      const f = fit(cv); if (!f) return;
      const { ctx, w, h } = f;
      ctx.clearRect(0, 0, w, h);
      const age = (t - t0) / 1000;
      let alive = false;
      for (const p of confetti.parts) {
        p.vy += 0.16; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life = Math.max(0, 1 - age / 2.4);
        if (p.life > 0 && p.y < h + 20) {
          alive = true;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalAlpha = Math.min(1, p.life * 1.6);
          ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.sin(age * 6 + p.x))));
          ctx.restore();
        }
      }
      if (alive && !document.hidden) confetti.raf = requestAnimationFrame(tick);
      else { ctx.clearRect(0, 0, w, h); confetti = null; }
    };
    confetti.raf = requestAnimationFrame(tick);
    return count;
  };

  // ---------- 初期化 ----------
  const init = () => {
    initBg();
    // Chart.js 全体の上限（DPR3の全面描画と長いアニメーションをやめる）
    try {
      if (window.Chart) {
        window.Chart.defaults.devicePixelRatio = dpr();
        window.Chart.defaults.animation = reduced() ? false : { duration: 450 };
      }
    } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) drawBg(performance.now()); });

  return { dpr, clamp01, easeOut, reduced, rgba, ring, celebrate, _drawBg: drawBg, CONFETTI_MAX };
})();
window.CanvasFX = CanvasFX;
