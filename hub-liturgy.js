// EL-SYSTEMA Live — 祭文 (Liturgy) エンジン
//
// 統合演奏卓の「反応する層」。場に流れる kehai（各楽器の presence/low/high）を聴き、
// スキーマ shared/el-systema-shapes.js（explainLiturgy で検証）に従って:
//   応答 … 信号が閾値を「持続」秒跨いだら別楽器へ command を撃つ（一度/冷却つき）。
//          楽器同士が互いを聴いて自動応答する＝場が生き物になる。
//   祭次 … 秒指定タイムライン（テンポ無し・揺ジッタ・loop 可）。
//
// 発火は hub の macro/volume 状態を経由させる（setMacro/setVol）ので、
// 卓のノブ／フェーダーが実際に動く＝「場が卓を弾く」のが見える。
// 触るのは自分の DOM と __hub の公開面だけ。hub.js/relay/楽器側には手を入れない。

(function () {
  'use strict';
  const HUB = window.__hub;
  const S = window.ElSystemaShapes;
  if (!HUB || !S) { console.warn('[liturgy] __hub / ElSystemaShapes 未読込'); return; }

  const LS = 'elsystema.hub.liturgy.v1';
  const FIELDS = { presence: 1, low: 1, high: 1 };
  const NOW = () => performance.now();
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ───────────── signal / condition ─────────────
  // 信号 = "<id>" | "<id>.<presence|low|high>"（既定 presence）。楽器 kehai を読む。
  function parseSignal(sig) {
    const dot = sig.lastIndexOf('.');
    if (dot > 0) { const suf = sig.slice(dot + 1); if (FIELDS[suf]) return { id: sig.slice(0, dot), field: suf }; }
    return { id: sig, field: 'presence' };
  }
  function readSignal(sig) {
    const { id, field } = parseSignal(sig);
    const it = HUB.insts[id];
    if (!it) return null;                     // その楽器がまだ場に居ない
    return it.kehai ? (it.kehai[field] || 0) : 0;
  }
  function cmp(op, a, b) { return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : false; }

  // ───────────── perform: 祭次イベント / 応答.為 の共通実行 ─────────────
  // spec = { target, command, param?, value?, from?, to?, duration?, preset? }
  const ramps = {};                            // key "id|kind" -> intervalId（macro/vol のローカル ramp）
  function localRamp(id, kind, from, to, durMs) {
    const key = id + '|' + kind; if (ramps[key]) clearInterval(ramps[key]);
    const t0 = NOW(); durMs = Math.max(1, durMs);
    ramps[key] = setInterval(() => {
      const t = Math.min(1, (NOW() - t0) / durMs);
      const v = from + (to - from) * t;
      if (kind === 'volume') HUB.setVol(id, clamp01(v)); else HUB.setMacro(id, kind.slice(-1), clamp01(v));
      if (t >= 1) { clearInterval(ramps[key]); delete ramps[key]; }
    }, 33);
  }
  const MACRO_VOL = { 'macro.a': 1, 'macro.b': 1, 'macro.c': 1, 'volume': 1 };
  function applyParam(id, param, value) {
    if (!HUB.insts[id]) HUB.ensure(id);
    if (param === 'volume') HUB.setVol(id, clamp01(value));
    else if (param === 'macro.a' || param === 'macro.b' || param === 'macro.c') HUB.setMacro(id, param.slice(-1), clamp01(value));
    else HUB.relay(id, 'setParam', { name: param, value });   // 楽器固有パラメータは素通し
  }
  function perform(spec) {
    const t = spec.target;
    if (t !== 'all' && !HUB.insts[t]) HUB.ensure(t);
    switch (spec.command) {
      case 'play': HUB.relay(t, 'play'); break;
      case 'stop': HUB.relay(t, 'stop'); break;
      case 'setParam': applyParam(t, spec.param, spec.value); break;
      case 'ramp':
        if (MACRO_VOL[spec.param] && t !== 'all') localRamp(t, spec.param, spec.from, spec.to, (spec.duration || 0) * 1000);
        else HUB.relay(t, 'ramp', { name: spec.param, from: spec.from, to: spec.to, dur: (spec.duration || 0) * 1000, startAt: S.nowMs() });
        break;
      case 'loadPreset': HUB.relay(t, 'loadPreset', { preset: spec.preset }); break;
      case 'snapshot': HUB.relay(t, 'snapshot'); break;
    }
  }

  // ───────────── engine state ─────────────
  let liturgy = null;        // 検証済み祭文 object（奉じ中の写し）
  let engineOn = false;      // 応答監視 稼働
  let seq = null;            // { t0, events:[{spec,fireAt}], dur, idx }
  let loopOn = false;
  const rules = [];          // [{ rule, st:{trueSince,armed,cooldownUntil,firedOnce}, row?, valEl?, stEl? }]

  function startLiturgy(lit) {
    stopLiturgy(true);
    liturgy = lit; engineOn = true;
    // 応答
    rules.length = 0;
    (lit['応答'] || []).forEach(rule => rules.push({ rule, st: { trueSince: 0, armed: true, cooldownUntil: 0, firedOnce: false } }));
    // 祭次
    seq = buildSeq(lit);
    buildRuleRows();
    setRunning(true);
    log('▶ 奉じる: ' + (lit.track || '(無名)') + ' — 応答 ' + rules.length + ' / 祭次 ' + (seq ? seq.events.length : 0));
    HUB.oled('祭文 奉じ — ' + (lit.track || ''));
  }
  function buildSeq(lit) {
    const evs = (lit['祭次'] || []).map(e => {
      const j = (e['揺'] || 0) * (Math.random() * 2 - 1);
      return { spec: e, fireAt: Math.max(0, (e['時'] + j)) * 1000 };
    }).sort((a, b) => a.fireAt - b.fireAt);
    if (!evs.length) return null;
    return { t0: NOW(), events: evs, dur: (lit.duration || 0) * 1000, idx: 0 };
  }
  function stopLiturgy(silent) {
    engineOn = false; seq = null; rules.length = 0;
    for (const k in ramps) { clearInterval(ramps[k]); delete ramps[k]; }
    setRunning(false);
    if (!silent) { log('■ 停止'); HUB.oled('祭文 停止'); }
  }

  // ───────────── tick: 応答評価 ＋ 祭次進行 ─────────────
  let lastUiAt = 0;
  function tick() {
    if (!engineOn) return;
    const now = NOW();
    // ── 応答 ──
    for (const R of rules) {
      const c = R.rule['時'], val = readSignal(c['信号']);
      if (val == null) { R.st.trueSince = 0; continue; }
      const cond = cmp(c['演算'], val, c['値']);
      const need = (c['持続'] || 0) * 1000;
      if (cond) {
        if (!R.st.trueSince) R.st.trueSince = now;
        const sustained = now - R.st.trueSince >= need;
        if (sustained && R.st.armed && now >= R.st.cooldownUntil && !(R.rule['一度'] && R.st.firedOnce)) {
          perform(R.rule['為']);
          R.st.firedOnce = true; R.st.armed = false;
          R.st.cooldownUntil = now + (R.rule['冷却'] || 0) * 1000;
          const a = R.rule['為'];
          log('✦ ' + (R.rule['名'] || '?') + ' → ' + a.target + '.' + (a.param || a.command));
          HUB.oled('祭文 ✦ ' + (R.rule['名'] || ''));
          if (window.__fieldFx) window.__fieldFx.pulse(parseSignal(c['信号']).id, a.target);
          if (R.row) { R.row.classList.add('fired'); setTimeout(() => R.row && R.row.classList.remove('fired'), 320); }
        }
      } else { R.st.trueSince = 0; R.st.armed = true; }
    }
    // ── 祭次 ──
    if (seq) {
      const elapsed = now - seq.t0;
      while (seq.idx < seq.events.length && seq.events[seq.idx].fireAt <= elapsed) {
        const ev = seq.events[seq.idx++]; perform(ev.spec);
        if (window.__fieldFx) window.__fieldFx.pulse(ev.spec.target, ev.spec.target);
        log('· 祭次 ' + ev.spec.target + '.' + (ev.spec.param || ev.spec.command));
      }
      if (seq.idx >= seq.events.length && seq.dur > 0 && elapsed >= seq.dur) {
        if (loopOn) { seq = buildSeq(liturgy); } else { seq = null; }
      }
    }
    if (now - lastUiAt > 180) { lastUiAt = now; updateRuleRows(); }
  }
  setInterval(tick, 40);     // setInterval → 背景タブでも監視継続

  // ───────────── UI ─────────────
  const $ = id => document.getElementById(id);
  const panel = $('liturgyPanel'), textEl = $('litText'), statusEl = $('litStatus'),
    logEl = $('litLog'), rulesEl = $('litRules');
  if (!panel) { console.warn('[liturgy] panel DOM 無し'); return; }

  function log(t) {
    const line = document.createElement('div');
    line.textContent = new Date().toLocaleTimeString('ja-JP', { hour12: false }) + '  ' + t;
    logEl.appendChild(line);
    while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(t, bad) { statusEl.textContent = t; statusEl.classList.toggle('bad', !!bad); }
  function setRunning(on) {
    $('litPlay').classList.toggle('active', on);
    panel.classList.toggle('running', on);
    if (!on && rulesEl) rulesEl.innerHTML = '';
  }
  function buildRuleRows() {
    if (!rulesEl) return; rulesEl.innerHTML = '';
    for (const R of rules) {
      const c = R.rule['時'];
      const row = document.createElement('div'); row.className = 'litrule';
      row.innerHTML = `<span class="rn">${R.rule['名'] || '(無名)'}</span>` +
        `<span class="rc">${c['信号']} ${c['演算']} ${c['値']}</span>` +
        `<span class="rv"></span><span class="rs"></span>`;
      rulesEl.appendChild(row);
      R.row = row; R.valEl = row.querySelector('.rv'); R.stEl = row.querySelector('.rs');
    }
    if (!rules.length) rulesEl.innerHTML = '<div class="litrule dim">応答規則なし（祭次のみ）</div>';
  }
  function updateRuleRows() {
    const now = NOW();
    for (const R of rules) {
      if (!R.valEl) continue;
      const val = readSignal(R.rule['時']['信号']);
      R.valEl.textContent = val == null ? '—' : val.toFixed(2);
      const st = R.st;
      R.stEl.textContent = val == null ? '不在' : (now < st.cooldownUntil ? '冷却' : (R.rule['一度'] && st.firedOnce ? '済' : st.trueSince ? '溜' : '待'));
    }
  }

  // 検証 → object or null（エラーは status に）
  function parseAndValidate() {
    let obj;
    try { obj = JSON.parse(textEl.value); } catch (e) { setStatus('JSON 構文エラー: ' + e.message, true); return null; }
    const errs = S.explainLiturgy(obj);
    if (errs.length) { setStatus('祭文エラー(' + errs.length + '): ' + errs.slice(0, 3).join(' / ') + (errs.length > 3 ? ' …' : ''), true); return null; }
    setStatus('祭文 OK — 楽器 ' + obj['楽器'].length + ' / 祭次 ' + obj['祭次'].length + ' / 応答 ' + obj['応答'].length, false);
    return obj;
  }

  // ───────────── persistence ＋ 保存庫 ─────────────
  let library = {};
  function persist() { try { localStorage.setItem(LS, JSON.stringify({ text: textEl.value, library, loop: loopOn })); } catch (e) {} }
  function restore() {
    try {
      const j = JSON.parse(localStorage.getItem(LS) || '{}');
      if (typeof j.text === 'string') textEl.value = j.text;
      library = j.library || {}; loopOn = !!j.loop;
    } catch (e) {}
    $('litLoop').checked = loopOn; refreshLib();
  }
  function refreshLib() {
    const names = Object.keys(library);
    $('litLib').innerHTML = '<option value="">— 保存庫 —</option>' + names.map(n => `<option>${n}</option>`).join('');
  }

  // ───────────── 雛形 ─────────────
  const TEMPLATES = {
    '呼応 — field⇄dust': {
      track: '呼応', duration: 300, '楽器': ['hado-field', 'hado-dust'], '祭次': [],
      '応答': [
        { '名': 'field満ちたら塵を撒く', '時': { '信号': 'hado-field.presence', '演算': '>', '値': 0.55, '持続': 1.0 },
          '為': { target: 'hado-dust', command: 'ramp', param: 'macro.a', from: 0.15, to: 0.85, duration: 2.5 }, '冷却': 5 },
        { '名': 'field沈んだら塵も引く', '時': { '信号': 'hado-field.presence', '演算': '<', '値': 0.15, '持続': 1.5 },
          '為': { target: 'hado-dust', command: 'ramp', param: 'macro.a', from: 0.85, to: 0.1, duration: 3.0 }, '冷却': 5 },
        { '名': '高域が立てば粒径を締める', '時': { '信号': 'hado-field.high', '演算': '>', '値': 0.5, '持続': 0.6 },
          '為': { target: 'hado-dust', command: 'setParam', param: 'macro.b', value: 0.8 }, '冷却': 3 }
      ]
    },
    '奉納 — 24秒タイムライン': {
      track: '奉納', duration: 24, '楽器': ['hado-field', 'hado-dust', 'hado-ori'],
      '祭次': [
        { '時': 0,  '揺': 0,   target: 'hado-field', command: 'play' },
        { '時': 0,  '揺': 0.2, target: 'hado-field', command: 'ramp', param: 'macro.a', from: 0, to: 0.7, duration: 6 },
        { '時': 6,  '揺': 0.3, target: 'hado-dust',  command: 'play' },
        { '時': 6,  '揺': 0,   target: 'hado-dust',  command: 'setParam', param: 'macro.b', value: 0.4 },
        { '時': 12, '揺': 0.5, target: 'hado-ori',   command: 'play' },
        { '時': 20, '揺': 0,   target: 'hado-field', command: 'ramp', param: 'macro.a', from: 0.7, to: 0, duration: 4 },
        { '時': 24, '揺': 0,   target: 'hado-dust',  command: 'stop' },
        { '時': 24, '揺': 0,   target: 'hado-ori',   command: 'stop' }
      ],
      '応答': []
    }
  };
  function refreshTemplates() {
    $('litTemplate').innerHTML = '<option value="">— 雛形 —</option>' + Object.keys(TEMPLATES).map(n => `<option>${n}</option>`).join('');
  }

  // ───────────── wiring ─────────────
  $('litToggle').onclick = () => { panel.hidden = !panel.hidden; };
  $('litClose').onclick = () => { panel.hidden = true; };
  $('litValidate').onclick = () => parseAndValidate();
  $('litLoop').onchange = e => { loopOn = e.target.checked; persist(); };
  $('litText').addEventListener('input', () => persist());
  $('litPlay').onclick = () => { const o = parseAndValidate(); if (o) startLiturgy(o); };
  $('litStop').onclick = () => stopLiturgy(false);
  $('litTemplate').onchange = e => {
    const t = TEMPLATES[e.target.value]; if (!t) return;
    textEl.value = JSON.stringify(t, null, 2); parseAndValidate(); persist(); e.target.value = '';
  };
  $('litLoad').onclick = () => {
    const n = $('litLib').value; if (!n || !library[n]) return;
    textEl.value = JSON.stringify(library[n], null, 2); parseAndValidate(); persist();
  };
  $('litSaveLib').onclick = () => {
    const o = parseAndValidate(); if (!o) return;
    const name = prompt('祭文名', o.track || ('祭文 ' + (Object.keys(library).length + 1))); if (!name) return;
    library[name] = o; persist(); refreshLib(); log('保存 ' + name);
  };
  $('litDel').onclick = () => {
    const n = $('litLib').value; if (!n || !library[n]) return;
    if (!confirm(n + ' を削除？')) return; delete library[n]; persist(); refreshLib();
  };

  refreshTemplates(); restore();
  if (!textEl.value.trim()) { textEl.value = JSON.stringify(TEMPLATES['呼応 — field⇄dust'], null, 2); }
  setStatus('祭文を書いて「検証」→「奉じる」', false);

  // headless / debug
  window.__liturgy = { start: startLiturgy, stop: () => stopLiturgy(false), get on() { return engineOn; },
    get rules() { return rules; }, get seq() { return seq; }, perform, parseAndValidate, TEMPLATES };
})();
