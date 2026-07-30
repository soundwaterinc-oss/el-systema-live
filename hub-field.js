// EL-SYSTEMA Live — 場 (field) の可視化
//
// 卓の中央（channel strip の背後）に、全楽器を「一枚の生きた絵」として描く。
// 各楽器を黄金角スパイラルに配置し、kehai で呼吸させる:
//   presence → 明るさ/輪の脈動、low↔high → 色相、silence/停留 → 減衰、
//   mute → 沈める、solo → 際立たせる。
// 祭文が発火したら __fieldFx.pulse(src,dst) で source→target に弧を走らせる
//   ＝「場が卓を弾く」反応がそのまま線になって見える。
// 描画は rAF（背景タブで止まって良い）。触るのは自分の canvas と __hub の読取だけ。

(function () {
  'use strict';
  const HUB = window.__hub;
  const cv = document.getElementById('fieldCanvas');
  if (!HUB || !cv) { console.warn('[field] __hub / canvas 無し'); return; }
  const ctx = cv.getContext('2d');
  const GOLD = Math.PI * (3 - Math.sqrt(5));   // 黄金角
  const pos = {};                               // id -> {x,y,r}（毎フレーム更新・pulse が参照）
  const sm = {};                                // id -> 平滑 {p,low,high,alive}
  const arcs = [];                              // {src,dst,t0}
  let W = 0, Hh = 0, dpr = 1;

  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; Hh = r.height;
    cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, Hh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  // pulse: 反応の弧（src===dst なら node フラッシュ）
  window.__fieldFx = {
    pulse: (src, dst) => { arcs.push({ src, dst, t0: performance.now() }); if (arcs.length > 40) arcs.shift(); },
    pos, sm
  };

  function hueOf(low, high) {                    // low→lime(85) ↔ balance→green(155) ↔ high→cyan(185)
    return 150 + (high - low) * 55;
  }

  function frame(now) {
    ctx.clearRect(0, 0, W, Hh);
    const order = HUB.order, n = order.length;
    if (n) {
      const cx = W / 2, cy = Hh / 2;
      const scale = Math.min(W, Hh) * 0.5 - 34;
      const anySolo = HUB.anySolo;
      // 各 node
      for (let i = 0; i < n; i++) {
        const id = order[i], it = HUB.insts[id]; if (!it) continue;
        const k = it.kehai || { presence: 0, low: 0, high: 0, lastSeen: 0 };
        const stale = (Date.now() - (k.lastSeen || 0)) > 900;
        const S = sm[id] || (sm[id] = { p: 0, low: 0, high: 0, alive: 0 });
        const tgtAlive = stale ? 0 : 1;
        S.p += ((stale ? 0 : k.presence) - S.p) * 0.14;
        S.low += (k.low - S.low) * 0.1; S.high += (k.high - S.high) * 0.1;
        S.alive += (tgtAlive - S.alive) * 0.08;
        // 黄金角スパイラル配置（安定・楽器数に追随）
        const rad = n === 1 ? 0 : Math.sqrt((i + 0.5) / n) * scale;
        const ang = i * GOLD - Math.PI / 2;
        const x = cx + rad * Math.cos(ang), y = cy + rad * Math.sin(ang);
        const R = 14 + S.p * 30;
        pos[id] = { x, y, r: R };
        const muted = it.ch && it.ch.mute;
        const dim = (anySolo && !(it.ch && it.ch.solo)) || muted;
        const hue = hueOf(S.low, S.high);
        const a = (0.12 + S.p * 0.55) * (0.25 + 0.75 * S.alive) * (dim ? 0.28 : 1);
        // グロー
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, `hsla(${hue},85%,62%,${a})`);
        g.addColorStop(1, `hsla(${hue},85%,55%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
        // 脈動する輪
        const ringR = R + 4 + Math.sin(now / 380 + i) * (1.5 + S.p * 4);
        ctx.strokeStyle = `hsla(${hue},80%,66%,${(0.16 + S.p * 0.4) * (dim ? 0.3 : 1)})`;
        ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, ringR, 0, 7); ctx.stroke();
        // solo リング
        if (it.ch && it.ch.solo) { ctx.strokeStyle = 'rgba(127,232,255,.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, R + 9, 0, 7); ctx.stroke(); }
        // 名
        ctx.fillStyle = `rgba(159,232,192,${dim ? 0.28 : 0.6})`;
        ctx.font = '9px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
        ctx.fillText(id, x, y + R + 12);
      }
      // 反応の弧
      for (let j = arcs.length - 1; j >= 0; j--) {
        const arc = arcs[j], age = (now - arc.t0) / 620;
        if (age >= 1) { arcs.splice(j, 1); continue; }
        const a = pos[arc.src], b = pos[arc.dst];
        if (!a) continue;
        const alpha = Math.sin(age * Math.PI);
        if (!b || arc.src === arc.dst) {                 // node フラッシュ（祭次 / 自己）
          ctx.strokeStyle = `rgba(208,255,90,${alpha * 0.8})`;
          ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 6 + age * 26, 0, 7); ctx.stroke();
          continue;
        }
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 40;   // 反り
        ctx.strokeStyle = `rgba(208,255,90,${alpha * 0.7})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
        // 走る点
        const t = age, it2 = 1 - t;
        const px = it2 * it2 * a.x + 2 * it2 * t * mx + t * t * b.x;
        const py = it2 * it2 * a.y + 2 * it2 * t * my + t * t * b.y;
        ctx.fillStyle = `rgba(208,255,90,${alpha})`; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  }
  resize(); requestAnimationFrame(frame);
})();
