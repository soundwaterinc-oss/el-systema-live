// EL-SYSTEMA Live — 統合演奏卓（field クライアント兼 MIDI サーフェス）。
// 場（el-systema-field）のもう1クライアントとして、kehai で楽器を自動発見し、
// relay/setParam(macro.a/b/c, volume)/loadPreset/snapshot で全楽器をミキシング・演奏する。
(function () {
  'use strict';
  const S = window.ElSystemaShapes, T = window.ElSystemaTransport;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const BANK = 8;                    // channels per bank (Launch Control XL)
  const LS = 'elsystema.hub.v1';

  // ─────────── transport (served from the relay, so same host) ───────────
  const transport = T.createTransport({ kind: 'ws', url: 'ws://' + location.host });
  let linked = false;
  transport.onOpen(() => { linked = true; setLink(); oled('場に接続 — 楽器タブを開くと自動で並びます'); });
  transport.onClose(() => { linked = false; setLink(); });

  // ─────────── state ───────────
  const insts = {};    // id -> { id, ch:{a,b,c,volume,mute,solo,presetName}, kehai:{presence,low,high,everSpoke,silent,lastSeen}, meter }
  let order = [];      // display order of ids
  let bank = 0;
  let masterVol = 0.9;
  let library = {};    // id -> { name -> preset }
  let scenes = [];     // [{name, at, entries:{id:{preset?,a,b,c,volume}}}]

  function ensure(id) {
    if (insts[id]) return insts[id];
    const it = { id, ch: { a: 0.5, b: 0.5, c: 0.5, volume: 0.8, mute: false, solo: false, presetName: '' },
      kehai: { presence: 0, low: 0, high: 0, everSpoke: false, silent: false, lastSeen: 0 }, meter: 0 };
    insts[id] = it;
    if (!order.includes(id)) order.push(id);
    renderBanks(); renderChans();
    return it;
  }
  function forget(id) { delete insts[id]; order = order.filter(x => x !== id); renderBanks(); renderChans(); save(); }

  function persist() {
    const channels = {}; for (const id in insts) channels[id] = insts[id].ch;
    return { order, library, scenes, masterVol, channels };
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(persist())); } catch (e) {} }
  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(LS) || '{}');
      order = j.order || []; library = j.library || {}; scenes = j.scenes || [];
      masterVol = typeof j.masterVol === 'number' ? j.masterVol : 0.9;
      if (j.channels) for (const id in j.channels) { ensure(id); Object.assign(insts[id].ch, j.channels[id]); }
    } catch (e) {}
  }

  // ─────────── field messaging ───────────
  function relay(target, cmd, extra) {
    transport.send(Object.assign({ t: 'relay', target, cmd, id: S.newRelayId(), at: S.nowMs() }, extra || {}));
  }
  const anySolo = () => Object.values(insts).some(i => i.ch.solo);
  function effVol(it) {
    if (it.ch.mute) return 0;
    if (anySolo() && !it.ch.solo) return 0;
    return clamp(it.ch.volume * masterVol, 0, 1);
  }
  // coalesce param sends to ~1 per frame per (id,name)
  const pending = new Map(); let flushQ = false;
  function queueParam(id, name, value) {
    pending.set(id + '|' + name, { id, name, value });
    if (!flushQ) { flushQ = true; requestAnimationFrame(() => {
      flushQ = false; for (const p of pending.values()) relay(p.id, 'setParam', { name: p.name, value: p.value }); pending.clear();
    }); }
  }
  function pushVol(id) { queueParam(id, 'volume', effVol(insts[id])); }
  function pushAllVol() { for (const id in insts) pushVol(id); }
  function pushMacro(id, k) { queueParam(id, 'macro.' + k, insts[id].ch[k]); }

  // snapshot (async): resolve on ack carrying preset
  const pendingSnaps = {};
  function snapshot(id) {
    return new Promise((res, rej) => {
      const rid = S.newRelayId();
      pendingSnaps[rid] = { res, timer: setTimeout(() => { delete pendingSnaps[rid]; rej(new Error('timeout')); }, 1500) };
      transport.send({ t: 'relay', target: id, cmd: 'snapshot', id: rid, at: S.nowMs() });
    });
  }

  transport.onMessage((m) => {
    if (!S.isValid(m)) return;
    if (m.t === 'kehai') {
      const it = ensure(m.from);
      it.kehai.presence = m.presence; it.kehai.low = m.low; it.kehai.high = m.high;
      it.kehai.everSpoke = m.everSpoke; it.kehai.silent = false; it.kehai.lastSeen = S.nowMs();
    } else if (m.t === 'silence') {
      const it = insts[m.from]; if (it) it.kehai.silent = true;
    } else if (m.t === 'ack') {
      const p = pendingSnaps[m.of];
      if (p && m.preset) { clearTimeout(p.timer); p.res(m.preset); delete pendingSnaps[m.of]; }
    }
  });

  // ─────────── UI: banks + channel strips ───────────
  const chansEl = document.getElementById('chans');
  const bankTabsEl = document.getElementById('bankTabs');
  function bankCount() { return Math.max(1, Math.ceil(order.length / BANK)); }
  function renderBanks() {
    const n = bankCount(); bankTabsEl.innerHTML = '';
    for (let b = 0; b < n; b++) {
      const btn = document.createElement('button'); btn.textContent = 'BANK ' + (b + 1);
      btn.className = b === bank ? 'on' : ''; btn.onclick = () => { bank = b; renderBanks(); renderChans(); };
      bankTabsEl.appendChild(btn);
    }
  }
  function knobSVG() {
    return '<svg width="38" height="38" viewBox="0 0 38 38">' +
      '<circle cx="19" cy="19" r="15" fill="#0a1418" stroke="#16302b"/>' +
      '<path class="arc" fill="none" stroke="#d0ff5a" stroke-width="3" stroke-linecap="round"/>' +
      '<line class="ind" x1="19" y1="19" x2="19" y2="6" stroke="#7fe8ff" stroke-width="2"/></svg>';
  }
  function setKnob(el, val) {                 // val 0..1 → arc + indicator
    const a0 = -135, a1 = 135, ang = a0 + (a1 - a0) * val;
    const rad = (d) => (d - 90) * Math.PI / 180;
    const arc = el.querySelector('.arc'), ind = el.querySelector('.ind');
    const R = 15, cx = 19, cy = 19;
    const sx = cx + R * Math.cos(rad(a0)), sy = cy + R * Math.sin(rad(a0));
    const ex = cx + R * Math.cos(rad(ang)), ey = cy + R * Math.sin(rad(ang));
    const large = (ang - a0) > 180 ? 1 : 0;
    arc.setAttribute('d', `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`);
    ind.setAttribute('x2', (cx + (R - 3) * Math.cos(rad(ang))).toFixed(1));
    ind.setAttribute('y2', (cy + (R - 3) * Math.sin(rad(ang))).toFixed(1));
  }

  function renderChans() {
    chansEl.innerHTML = '';
    for (let col = 0; col < BANK; col++) {
      const id = order[bank * BANK + col];
      const el = document.createElement('div'); el.className = 'chan' + (id ? '' : ' empty');
      if (!id) { el.innerHTML = `<div class="id">— 空き —</div><div class="sub"><span>CH ${bank * BANK + col + 1}</span></div>`; chansEl.appendChild(el); continue; }
      const it = insts[id];
      el.innerHTML =
        `<div class="id" title="${id}">${id}</div>
         <div class="sub"><span>CH ${bank * BANK + col + 1}</span><span class="forget" style="cursor:pointer" title="この楽器を卓から外す">✕</span></div>
         <div class="knobs">
           <div class="knob kA"><span class="kl">A</span>${knobSVG()}<span class="kv"></span></div>
           <div class="knob kB"><span class="kl">B</span>${knobSVG()}<span class="kv"></span></div>
           <div class="knob kC"><span class="kl">C</span>${knobSVG()}<span class="kv"></span></div>
         </div>
         <div class="row">
           <div class="fader"><span class="flab">VOL</span><div class="fill"></div><span class="fpct"></span></div>
           <div class="meter"><i></i></div>
         </div>
         <div class="btns"><button class="mute">MUTE</button><button class="solo">SOLO</button></div>
         <div class="presetrow"><select class="pset"></select><button class="psave" title="現在の音色を snapshot 保存">＋</button></div>`;
      chansEl.appendChild(el);
      wireChannel(el, id);
    }
    refreshStrip();
  }

  function wireChannel(el, id) {
    const it = insts[id];
    el.querySelector('.forget').onclick = () => forget(id);
    const keys = ['a', 'b', 'c']; const knobEls = [el.querySelector('.kA'), el.querySelector('.kB'), el.querySelector('.kC')];
    knobEls.forEach((k, i) => {
      const key = keys[i];
      let dy = 0, drag = false;
      k.addEventListener('pointerdown', e => { drag = true; dy = e.clientY; k.setPointerCapture(e.pointerId); });
      k.addEventListener('pointermove', e => { if (!drag) return; const d = dy - e.clientY; if (Math.abs(d) >= 1) { setMacro(id, key, it.ch[key] + d * 0.004); dy = e.clientY; } });
      k.addEventListener('pointerup', () => drag = false);
      k.addEventListener('wheel', e => { e.preventDefault(); setMacro(id, key, it.ch[key] + (e.deltaY < 0 ? 0.02 : -0.02)); }, { passive: false });
    });
    const fader = el.querySelector('.fader');
    const setF = e => { const r = fader.getBoundingClientRect(); setVol(id, clamp(1 - (e.clientY - r.top) / r.height, 0, 1)); };
    let fdrag = false;
    fader.addEventListener('pointerdown', e => { fdrag = true; setF(e); fader.setPointerCapture(e.pointerId); });
    fader.addEventListener('pointermove', e => { if (fdrag) setF(e); });
    fader.addEventListener('pointerup', () => fdrag = false);
    fader.addEventListener('wheel', e => { e.preventDefault(); setVol(id, it.ch.volume + (e.deltaY < 0 ? 0.02 : -0.02)); }, { passive: false });
    el.querySelector('.mute').onclick = () => { it.ch.mute = !it.ch.mute; pushAllVol(); refreshStrip(); save(); };
    el.querySelector('.solo').onclick = () => { it.ch.solo = !it.ch.solo; pushAllVol(); refreshStrip(); save(); };
    const psave = el.querySelector('.psave');
    psave.onclick = async () => {
      oled('snapshot ' + id + ' …');
      try { const preset = await snapshot(id); const name = prompt('プリセット名（' + id + '）', 'preset ' + ((library[id] ? Object.keys(library[id]).length : 0) + 1));
        if (!name) return; (library[id] = library[id] || {})[name] = preset; it.ch.presetName = name; save(); refreshStrip(); oled('保存 ' + id + ' / ' + name);
      } catch (e) { oled('snapshot 失敗（' + id + ' は snapshot 未対応かも）'); }
    };
    el.querySelector('.pset').onchange = (e) => {
      const name = e.target.value; if (!name || !library[id] || !library[id][name]) return;
      it.ch.presetName = name; relay(id, 'loadPreset', { preset: library[id][name] }); oled('recall ' + id + ' / ' + name); save();
    };
  }

  function setMacro(id, k, v) { insts[id].ch[k] = clamp(v, 0, 1); pushMacro(id, k); refreshStripOne(id); save(); }
  function setVol(id, v) { insts[id].ch.volume = clamp(v, 0, 1); pushVol(id); refreshStripOne(id); save(); }

  function stripEl(id) { const col = order.indexOf(id) - bank * BANK; if (col < 0 || col >= BANK) return null; return chansEl.children[col]; }
  function refreshStripOne(id) {
    const el = stripEl(id); if (!el || el.classList.contains('empty')) return; const it = insts[id];
    const kk = ['a', 'b', 'c']; const kn = [el.querySelector('.kA'), el.querySelector('.kB'), el.querySelector('.kC')];
    kn.forEach((k, i) => { setKnob(k, it.ch[kk[i]]); k.querySelector('.kv').textContent = (it.ch[kk[i]] * 100 | 0); });
    el.querySelector('.fill').style.height = (it.ch.volume * 100) + '%';
    el.querySelector('.fpct').textContent = (it.ch.volume * 100 | 0) + '%';
    el.querySelector('.mute').classList.toggle('on', it.ch.mute);
    el.querySelector('.solo').classList.toggle('on', it.ch.solo);
    const sel = el.querySelector('.pset'); const names = library[id] ? Object.keys(library[id]) : [];
    sel.innerHTML = '<option value="">— preset —</option>' + names.map(n => `<option ${n === it.ch.presetName ? 'selected' : ''}>${n}</option>`).join('');
  }
  function refreshStrip() { for (let c = 0; c < BANK; c++) { const id = order[bank * BANK + c]; if (id) refreshStripOne(id); } }

  // ─────────── master + scenes ───────────
  document.getElementById('playAll').onclick = () => { relay('all', 'play'); flash('playAll'); oled('▶ all'); };
  document.getElementById('stopAll').onclick = () => { relay('all', 'stop'); oled('■ all'); };
  const mvol = document.getElementById('mvol'); mvol.value = masterVol;
  mvol.oninput = e => { masterVol = +e.target.value; pushAllVol(); save(); };
  function flash(idn) { const b = document.getElementById(idn); b.classList.add('active'); }

  document.getElementById('scCap').onclick = async () => {
    const name = prompt('シーン名', 'scene ' + (scenes.length + 1)); if (!name) return;
    oled('capture … 全楽器 snapshot 収集中');
    const entries = {};
    await Promise.all(order.map(async id => {
      const it = insts[id]; const e = { a: it.ch.a, b: it.ch.b, c: it.ch.c, volume: it.ch.volume };
      try { e.preset = await snapshot(id); } catch (_) {}
      entries[id] = e;
    }));
    scenes.push({ name, at: S.nowMs(), entries }); save(); renderScenes(); oled('SCENE 保存 ' + name);
  };
  document.getElementById('scRecall').onclick = () => {
    const i = +document.getElementById('scSel').value; const sc = scenes[i]; if (!sc) return;
    stopMorph();
    for (const id in sc.entries) {
      const e = sc.entries[id]; ensure(id); const it = insts[id];
      if (e.preset) relay(id, 'loadPreset', { preset: e.preset });
      it.ch.a = e.a; it.ch.b = e.b; it.ch.c = e.c; it.ch.volume = e.volume;
      pushMacro(id, 'a'); pushMacro(id, 'b'); pushMacro(id, 'c'); pushVol(id);
    }
    refreshStrip(); save(); oled('SCENE recall ' + sc.name);
  };
  // ── scene morph: 現在→選択シーンを時間補間（macro/vol連続・preset は着地時に適用）──
  let morphRun = null;
  function stopMorph() { if (morphRun) { clearInterval(morphRun); morphRun = null; } }
  function startMorph(sc, secs) {
    stopMorph();
    const from = {};
    for (const id in sc.entries) { ensure(id); const c = insts[id].ch; from[id] = { a: c.a, b: c.b, c: c.c, volume: c.volume }; }
    const t0 = performance.now(), dur = Math.max(200, secs * 1000);
    oled('SCENE morph → ' + sc.name + ' (' + secs + 's)');
    morphRun = setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      for (const id in sc.entries) {
        const e = sc.entries[id], f = from[id], it = insts[id]; if (!it) continue;
        it.ch.a = f.a + (e.a - f.a) * t; it.ch.b = f.b + (e.b - f.b) * t;
        it.ch.c = f.c + (e.c - f.c) * t; it.ch.volume = f.volume + (e.volume - f.volume) * t;
        pushMacro(id, 'a'); pushMacro(id, 'b'); pushMacro(id, 'c'); pushVol(id);
      }
      refreshStrip();
      if (t >= 1) { for (const id in sc.entries) { if (sc.entries[id].preset) relay(id, 'loadPreset', { preset: sc.entries[id].preset }); }
        stopMorph(); save(); oled('SCENE morph 着 ' + sc.name); }
    }, 33);
  }
  document.getElementById('scMorph').onclick = () => {
    const i = +document.getElementById('scSel').value; const sc = scenes[i]; if (!sc) return;
    startMorph(sc, Math.max(0.2, +document.getElementById('scSecs').value || 6));
  };
  function renderScenes() {
    const sel = document.getElementById('scSel');
    sel.innerHTML = scenes.map((s, i) => `<option value="${i}">${s.name}</option>`).join('') || '<option>— なし —</option>';
  }
  document.getElementById('scExport').onclick = () => {
    const blob = new Blob([JSON.stringify(persist(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'el-systema-live-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json'; a.click();
    URL.revokeObjectURL(a.href); oled('設定を書き出しました');
  };
  document.getElementById('scImport').onclick = () => document.getElementById('scFile').click();
  document.getElementById('scFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { const j = JSON.parse(rd.result); order = j.order || order; library = j.library || {}; scenes = j.scenes || [];
      masterVol = j.masterVol ?? masterVol; if (j.channels) for (const id in j.channels) { ensure(id); Object.assign(insts[id].ch, j.channels[id]); }
      mvol.value = masterVol; renderBanks(); renderChans(); renderScenes(); save(); oled('設定を読み込みました');
    } catch (err) { oled('読み込み失敗'); } };
    rd.readAsText(f); e.target.value = '';
  };

  // ─────────── Web MIDI (Launch Control XL / 既存 XL3 規約) ───────────
  const CC_FADER = [5, 6, 7, 8, 9, 10, 11, 12];
  const CC_ENC = [[13, 14, 15, 16, 17, 18, 19, 20], [21, 22, 23, 24, 25, 26, 27, 28], [29, 30, 31, 32, 33, 34, 35, 36]];
  const NOTE_MUTE = [40, 41, 42, 43, 44, 45, 46, 47], NOTE_SOLO = [48, 49, 50, 51, 52, 53, 54, 55];
  const PAGE_UP = 56, PAGE_DN = 57, PLAY = 60, STOP = 61, CAP = 62;
  const decodeRelative = v => (v < 64 ? v : v - 128);      // XL3 relative (2's complement)
  const chOfCol = col => order[bank * BANK + col];
  function onCC(num, v127) {
    let i;
    if ((i = CC_FADER.indexOf(num)) >= 0) { const id = chOfCol(i); if (id) setVol(id, v127 / 127); return; }
    for (let r = 0; r < 3; r++) if ((i = CC_ENC[r].indexOf(num)) >= 0) { const id = chOfCol(i); if (id) setMacro(id, ['a', 'b', 'c'][r], insts[id].ch[['a','b','c'][r]] + decodeRelative(v127) * 0.02); return; }
  }
  function onNote(note) {
    let i;
    if ((i = NOTE_MUTE.indexOf(note)) >= 0) { const id = chOfCol(i); if (id) { insts[id].ch.mute = !insts[id].ch.mute; pushAllVol(); refreshStripOne(id); save(); } return; }
    if ((i = NOTE_SOLO.indexOf(note)) >= 0) { const id = chOfCol(i); if (id) { insts[id].ch.solo = !insts[id].ch.solo; pushAllVol(); refreshStripOne(id); save(); } return; }
    if (note === PAGE_UP) { bank = (bank + 1) % bankCount(); renderBanks(); renderChans(); }
    else if (note === PAGE_DN) { bank = (bank + bankCount() - 1) % bankCount(); renderBanks(); renderChans(); }
    else if (note === PLAY) relay('all', 'play');
    else if (note === STOP) relay('all', 'stop');
    else if (note === CAP) document.getElementById('scCap').click();
  }
  const midiSel = document.getElementById('midi');
  let midiAccess = null;
  function bindInput(inp) { if (inp) inp.onmidimessage = (e) => { const [st, d1, d2] = e.data; const cmd = st & 0xf0; if (cmd === 0xb0) onCC(d1, d2); else if (cmd === 0x90 && d2 > 0) onNote(d1); }; }
  function refreshMidi() {
    if (!midiAccess) return; midiSel.innerHTML = '<option value="">— MIDI 入力 —</option>';
    for (const inp of midiAccess.inputs.values()) { const o = document.createElement('option'); o.value = inp.id; o.textContent = inp.name; midiSel.appendChild(o); }
  }
  midiSel.onchange = () => { if (!midiAccess) return; for (const inp of midiAccess.inputs.values()) inp.onmidimessage = null; bindInput(midiAccess.inputs.get(midiSel.value)); oled('MIDI: ' + (midiSel.selectedOptions[0] ? midiSel.selectedOptions[0].textContent : '—')); };
  if (navigator.requestMIDIAccess) navigator.requestMIDIAccess().then(a => { midiAccess = a; refreshMidi(); a.onstatechange = refreshMidi; }).catch(() => { midiSel.innerHTML = '<option>MIDI 不許可</option>'; });
  else midiSel.innerHTML = '<option>MIDI 非対応</option>';

  // ─────────── meters + housekeeping loop ───────────
  function tick() {
    const now = S.nowMs();
    for (let c = 0; c < BANK; c++) {
      const id = order[bank * BANK + c]; if (!id) continue; const it = insts[id]; const el = chansEl.children[c]; if (!el || el.classList.contains('empty')) continue;
      const stale = now - it.kehai.lastSeen > 900;
      const target = stale ? 0 : it.kehai.presence;
      it.meter += (target - it.meter) * 0.3;
      const mEl = el.querySelector('.meter'); mEl.querySelector('i').style.height = (clamp(it.meter, 0, 1) * 100) + '%';
      mEl.classList.toggle('sil', it.kehai.silent || stale);
    }
  }
  setInterval(tick, 60);   // setInterval (not rAF) → keeps monitoring in background tabs

  function setLink() { document.getElementById('linkDot').classList.toggle('on', linked); document.getElementById('linkTxt').textContent = linked ? 'field ●' : 'field …'; }
  function oled(t) { document.getElementById('oled').textContent = t; }

  // ─────────── boot ───────────
  load(); renderBanks(); renderChans(); renderScenes(); setLink();

  // headless / debug hook (also the surface hub-liturgy.js drives)
  window.__hub = { insts, get order() { return order; }, ensure, forget, snapshot, relay, setMacro, setVol,
    get bank() { return bank; }, onCC, onNote, scenes, library, get masterVol() { return masterVol; },
    oled, refreshStrip, refreshStripOne, startMorph, stopMorph, get anySolo() { return anySolo(); } };
})();
