/* UI controller: picking, settings, trial runs and the live simulation view. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };

  const LS_KEY = 'pick-two-arena:v1';
  const TRIALS = 100;
  const SPEEDS = [
    { id: 'auto', label: 'Auto', title: 'Slows down for the action, speeds through the lulls' },
    { id: 1, label: '1×' }, { id: 5, label: '5×' }, { id: 20, label: '20×' }, { id: 60, label: '60×' }, { id: 200, label: '200×' },
  ];

  const state = {
    picks: [],
    config: Sim.defaultConfig('grounded'),
    results: null, // { kind: 'trials'|'rank', ... }
    job: null,
  };

  // ---------- persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.picks)) state.picks = saved.picks.filter(k => Sim.ORDER.includes(k)).slice(0, 2);
      if (saved.config && saved.config.species) {
        const from = saved.config.preset === 'custom' ? saved.config.base : saved.config.preset;
        const base = Sim.defaultConfig(from === 'arcade' ? 'arcade' : 'grounded');
        for (const k of Sim.ORDER) Object.assign(base.species[k], pickNumbers(saved.config.species[k]));
        Object.assign(base.person, pickNumbers(saved.config.person));
        base.preset = saved.config.preset || 'grounded';
        if (saved.config.base) base.base = saved.config.base;
        state.config = base;
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
  }
  function pickNumbers(o) {
    const out = {};
    if (!o) return out;
    for (const k in o) if (typeof o[k] === 'number' && isFinite(o[k])) out[k] = o[k];
    return out;
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ picks: state.picks, config: state.config })); } catch (e) { /* ignore */ }
  }

  // ---------- formatting ----------
  const sp = (k) => state.config.species[k] || Sim.BASE[k];
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const fmtNum = (n) => n >= 1000 ? n.toLocaleString('en-GB') : String(Math.round(n * 10) / 10);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const emojiSpan = (k) => el('span', { class: 'e', 'aria-hidden': 'true' }, k === 'person' ? '🧍' : sp(k).emoji);
  const pairText = (p) => p.map(k => sp(k).plural).join(' + ');
  const pairNode = (p) => el('span', { class: 'pair' }, emojiSpan(p[0]), ' ', sp(p[0]).plural, ' + ', emojiSpan(p[1]), ' ', sp(p[1]).plural);
  function killerPhrase(k) {
    if (!k) return '';
    if (k === 'rat') return 'rats';
    if (k === 'hunter') return 'the hunter';
    const n = sp(k).name.toLowerCase();
    return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
  }
  const presetLabel = (p) => (Sim.PRESETS[p] ? Sim.PRESETS[p].label : 'Custom');

  // ---------- cards ----------
  function renderCards() {
    const wrap = $('#cards');
    wrap.textContent = '';
    for (const k of Sim.ORDER) {
      const s = sp(k);
      const idx = state.picks.indexOf(k);
      const totalHp = s.count * s.hp;
      const hit = fmtNum(s.ranged ? s.rifleDmg : s.dmg);
      const card = el('button', {
        type: 'button', class: 'card', role: 'listitem', 'aria-pressed': idx >= 0 ? 'true' : 'false',
        'data-key': k, onclick: () => togglePick(k),
      },
      idx >= 0 ? el('span', { class: 'badge' }, `Defender ${idx + 1}`) : null,
      el('div', { class: 'card-top' },
        el('div', { class: 'card-emoji', 'aria-hidden': 'true' }, s.emoji),
        el('div', null,
          el('div', { class: 'card-name' }, s.plural),
          el('div', { class: 'card-count' }, `× ${fmtNum(s.count)}`))),
      el('p', { class: 'card-blurb' }, s.blurb),
      el('div', { class: 'card-stats' },
        el('span', null, 'Total HP ', el('b', null, fmtNum(totalHp))),
        el('span', null, s.ranged ? 'Rifle ' : 'Hit ', el('b', null, hit)),
        el('span', null, 'Sprint ', el('b', null, `${fmtNum(s.speed)} m/s`))));
      wrap.append(card);
    }
    $('#pick-hint').textContent = state.picks.length === 2 ? 'Tap a picked card to drop it.' : state.picks.length === 1 ? 'Pick one more.' : 'Tap two cards.';
  }

  function togglePick(k) {
    const i = state.picks.indexOf(k);
    if (i >= 0) state.picks.splice(i, 1);
    else {
      if (state.picks.length >= 2) state.picks.shift();
      state.picks.push(k);
    }
    save();
    renderCards();
    renderActionBar();
    if (state.results && state.results.kind === 'rank') renderRank();
  }

  function renderActionBar() {
    const box = $('#ab-picks');
    box.textContent = '';
    for (let i = 0; i < 2; i++) {
      const k = state.picks[i];
      box.append(k
        ? el('span', { class: 'slot filled' }, emojiSpan(k), sp(k).plural)
        : el('span', { class: 'slot' }, `Defender ${i + 1}`));
      if (i === 0) box.append(el('span', { class: 'muted', 'aria-hidden': 'true' }, '+'));
    }
    const ready = state.picks.length === 2;
    $('#btn-watch').disabled = !ready;
    $('#btn-trials').disabled = !ready;
    const p = state.config.preset;
    const seg = $('#preset-seg');
    seg.querySelector('[data-preset="custom"]').hidden = p !== 'custom';
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.preset === p ? 'true' : 'false'));
  }

  function setPreset(p) {
    if (p === 'custom') return;
    state.config = Sim.defaultConfig(p);
    save();
    renderCards();
    renderActionBar();
    if (state.results) renderResults();
  }

  // ---------- trials ----------
  function cancelJob() {
    if (state.job) { state.job.cancel(); state.job = null; }
  }

  function runTrials() {
    if (state.picks.length !== 2) return;
    cancelJob();
    const cfg = JSON.parse(JSON.stringify(state.config));
    const picks = state.picks.slice();
    const base = Trials.randomSeed();
    const jobs = [];
    for (let i = 0; i < TRIALS; i++) jobs.push({ picks, seed: (base + i * 7919) >>> 0 });
    state.results = { kind: 'trials', picks, cfg, preset: cfg.preset, total: TRIALS, runs: [], done: false, started: performance.now() };
    renderResults(true);
    let lastPaint = 0;
    state.job = Trials.run(cfg, jobs, (r, n) => {
      state.results.runs.push(r);
      const now = performance.now();
      if (now - lastPaint > 150 || n === TRIALS) { lastPaint = now; renderResults(); }
    }, () => {
      state.results.done = true;
      state.job = null;
      renderResults();
    });
  }

  function runRank(n) {
    cancelJob();
    const cfg = JSON.parse(JSON.stringify(state.config));
    const pairs = Sim.allPairs();
    const base = Trials.randomSeed();
    const jobs = [];
    // Interleave pairs so every row's estimate firms up together.
    for (let i = 0; i < n; i++) pairs.forEach(p => jobs.push({ picks: p, seed: (base + i * 7919) >>> 0 }));
    const rows = new Map(pairs.map(p => [p.join('+'), { picks: p, n: 0, wins: 0, timeSum: 0, killers: {} }]));
    state.results = { kind: 'rank', cfg, preset: cfg.preset, perPair: n, total: jobs.length, finished: 0, rows, done: false };
    renderResults(true);
    let lastPaint = 0;
    state.job = Trials.run(cfg, jobs, (r, done) => {
      const row = rows.get(r.picks.join('+'));
      row.n++;
      row.timeSum += r.time;
      if (r.survived) row.wins++;
      else row.killers[r.killedBy] = (row.killers[r.killedBy] || 0) + 1;
      state.results.finished = done;
      const now = performance.now();
      if (now - lastPaint > 250) { lastPaint = now; renderResults(); }
    }, () => {
      state.results.done = true;
      state.job = null;
      renderResults();
    });
  }

  function renderResults(scroll) {
    const box = $('#results');
    if (!state.results) { box.hidden = true; return; }
    box.hidden = false;
    if (state.results.kind === 'trials') renderTrials(); else renderRank();
    if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function staleNote(res) {
    return JSON.stringify(res.cfg) !== JSON.stringify(state.config)
      ? el('p', { class: 'note' }, 'Settings have changed since this ran. Replays use the settings these results were run with.')
      : null;
  }

  function hbars(items, opts) {
    const max = Math.max(1e-9, ...items.map(i => i.value));
    return el('div', { class: 'hbars' }, items.map(i => el('div', { class: 'hbar', title: i.title || '' },
      el('span', { class: 'name' }, emojiSpan(i.key), i.label),
      el('span', { class: 'track' },
        el('span', { class: 'fill' + (opts && opts.def ? ' def' : ''), style: `width:${Math.max(0.5, (i.value / max) * 78)}%` }),
        el('span', { class: 'val' }, i.text)))));
  }

  function renderTrials() {
    const res = state.results;
    const box = $('#results');
    box.textContent = '';
    const runs = res.runs;
    const n = runs.length;
    const wins = runs.filter(r => r.survived).length;
    const deaths = runs.filter(r => !r.survived);

    box.append(el('div', { class: 'results-head' },
      el('div', null,
        el('h2', null, pairNode(res.picks)),
        el('p', { class: 'muted' }, `${res.total} simulated hours · ${presetLabel(res.preset)} behaviour`)),
      res.done
        ? el('button', { type: 'button', class: 'btn ghost', onclick: runTrials }, 'Run again')
        : el('button', { type: 'button', class: 'btn ghost', onclick: () => { cancelJob(); res.done = true; renderResults(); } }, 'Stop')));

    if (!res.done) box.append(el('div', { class: 'progress-line' }, el('div', { style: `width:${(n / res.total) * 100}%` })));

    if (n === 0) { box.append(el('p', { class: 'muted' }, 'Simulating…')); return; }

    const [lo, hi] = Trials.wilson(wins, n);
    const medDeath = deaths.length ? deaths.map(r => r.time).sort((a, b) => a - b)[Math.floor(deaths.length / 2)] : null;
    box.append(el('div', { class: 'hero-stat' },
      el('span', { class: 'big' }, pct(wins / n)),
      el('span', { class: 'label' }, `survived the hour (${wins} of ${n}${n >= 10 ? ` · 95% CI ${pct(lo)}–${pct(hi)}` : ''})`)));
    if (medDeath !== null) box.append(el('p', { class: 'muted', style: 'margin:0' }, `When you died, it was usually around ${fmtTime(medDeath)} in (median).`));

    // What killed you
    const killers = {};
    deaths.forEach(r => { killers[r.killedBy] = (killers[r.killedBy] || 0) + 1; });
    const killerItems = Object.entries(killers).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: sp(k).plural, value: v, text: `${v} (${pct(v / deaths.length)})` }));

    // Average damage taken
    const dmg = {};
    runs.forEach(r => { for (const k in r.dmgBy) dmg[k] = (dmg[k] || 0) + r.dmgBy[k]; });
    const dmgItems = Object.entries(dmg).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: sp(k).plural, value: v / n, text: `${Math.round(v / n)} HP` }));

    // When deaths happened: 12 five-minute bins, then survivors.
    const bins = new Array(12).fill(0);
    deaths.forEach(r => { bins[Math.min(11, Math.floor(r.time / 300))]++; });
    const hmax = Math.max(1, ...bins, wins);
    const hist = el('div', { class: 'hist' },
      bins.map((v, i) => el('div', { class: 'col', title: `${v} death${v === 1 ? '' : 's'} between ${i * 5}:00 and ${(i + 1) * 5}:00` },
        el('div', { class: 'b', style: `height:${(v / hmax) * 100}%` }))),
      el('div', { class: 'col win', title: `${wins} survived the full hour`, style: 'margin-left:6px' },
        el('div', { class: 'b', style: `height:${(wins / hmax) * 100}%` })));

    const runSquares = el('div', { class: 'runs' }, runs.map((r, i) => el('button', {
      type: 'button', class: 'run' + (r.survived ? ' win' : ''),
      title: r.survived ? `Run ${i + 1}: survived${r.cleared ? ' (everything died)' : ''}. Click to watch.` : `Run ${i + 1}: killed by ${killerPhrase(r.killedBy)} at ${fmtTime(r.time)}. Click to watch.`,
      'aria-label': `Watch run ${i + 1}`,
      onclick: () => startWatch({ picks: res.picks, cfg: res.cfg, seed: r.seed }),
    })));

    box.append(el('div', { class: 'res-grid' },
      el('div', null, el('h4', null, 'What killed you'),
        killerItems.length ? hbars(killerItems) : el('p', { class: 'muted' }, 'Nothing, yet.')),
      el('div', null, el('h4', null, 'Damage taken, average per run'),
        dmgItems.length ? hbars(dmgItems) : el('p', { class: 'muted' }, 'Not a scratch.')),
      el('div', null, el('h4', null, 'When you died (5-minute bins)'), hist,
        el('div', { class: 'hist-axis' }, el('span', null, '0:00'), el('span', null, '30:00'), el('span', null, '60:00 · survived'))),
      el('div', null, el('h4', null, 'Every run (click one to watch it)'), runSquares,
        el('div', { class: 'runs-legend' },
          el('span', null, el('i', { style: 'background:var(--good)' }), 'Survived'),
          el('span', null, el('i', { style: 'background:var(--att)' }), 'Died')))));

    const win = runs.find(r => r.survived), loss = deaths[0];
    box.append(el('div', { class: 'res-actions' },
      win ? el('button', { type: 'button', class: 'btn', onclick: () => startWatch({ picks: res.picks, cfg: res.cfg, seed: win.seed }) }, '▶ Watch a survival') : null,
      loss ? el('button', { type: 'button', class: 'btn', onclick: () => startWatch({ picks: res.picks, cfg: res.cfg, seed: loss.seed }) }, '▶ Watch a death') : null));
    const stale = staleNote(res);
    if (stale) box.append(stale);
  }

  function renderRank() {
    const res = state.results;
    const box = $('#results');
    box.textContent = '';
    const sizeSel = el('select', { 'aria-label': 'Trials per pair', class: 'btn ghost', style: 'padding:8px 10px' },
      [10, 20, 50, 100].map(v => el('option', { value: v, selected: v === res.perPair ? 'selected' : null }, `${v} per pair`)));
    box.append(el('div', { class: 'results-head' },
      el('div', null,
        el('h2', null, 'Every pair, ranked'),
        el('p', { class: 'muted' }, `${res.perPair} simulated hours per pair · ${presetLabel(res.preset)} behaviour · click a row to pick that pair`)),
      el('div', { style: 'display:flex;gap:8px;align-items:center' },
        sizeSel,
        res.done
          ? el('button', { type: 'button', class: 'btn ghost', onclick: () => runRank(+sizeSel.value) }, 'Run again')
          : el('button', { type: 'button', class: 'btn ghost', onclick: () => { cancelJob(); res.done = true; renderResults(); } }, 'Stop'))));
    if (!res.done) {
      box.append(el('div', { class: 'progress-line' }, el('div', { style: `width:${(res.finished / res.total) * 100}%` })),
        el('p', { class: 'muted', style: 'margin:0;font-size:13px' }, `${res.finished} of ${res.total} hours simulated…`));
    }
    const rows = [...res.rows.values()].filter(r => r.n > 0)
      .sort((a, b) => (b.wins / b.n) - (a.wins / a.n) || (b.timeSum / b.n) - (a.timeSum / a.n));
    const current = state.picks.slice().sort().join('+');
    const table = el('table', { class: 'rank-table' },
      el('thead', null, el('tr', null,
        el('th', null, '#'), el('th', null, 'Defenders'), el('th', null, 'Survived the hour'),
        el('th', { class: 'hide-sm' }, 'Avg time alive'), el('th', { class: 'hide-sm' }, 'Usually killed by'))),
      el('tbody', null, rows.map((r, i) => {
        const p = r.wins / r.n;
        const [lo, hi] = Trials.wilson(r.wins, r.n);
        const topKiller = Object.entries(r.killers).sort((a, b) => b[1] - a[1])[0];
        return el('tr', {
          class: 'row' + (r.picks.slice().sort().join('+') === current ? ' current' : ''),
          tabindex: '0',
          onclick: () => { state.picks = r.picks.slice(); save(); renderCards(); renderActionBar(); renderRank(); },
          onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
        },
        el('td', { class: 'rank' }, String(i + 1)),
        el('td', null, pairNode(r.picks)),
        el('td', { class: 'bar-cell' }, el('div', { class: 'bar' },
          el('span', { class: 'fill', style: `width:${Math.max(0.5, p * 75)}%` }),
          el('span', { class: 'val' }, pct(p)),
          r.n >= 10 ? el('span', { class: 'ci' }, `${pct(lo)}–${pct(hi)}`) : null)),
        el('td', { class: 'num hide-sm' }, fmtTime(r.timeSum / r.n)),
        el('td', { class: 'num hide-sm' }, topKiller ? el('span', null, emojiSpan(topKiller[0]), ' ', sp(topKiller[0]).plural) : '—'));
      })));
    box.append(table);
    box.append(el('p', { class: 'note' },
      'Ranges are 95% confidence intervals. With few trials per pair, neighbouring rows often overlap: run more trials per pair to separate them.'));
    const stale = staleNote(res);
    if (stale) box.append(stale);
  }

  // ---------- tune dialog ----------
  function openTune() {
    const dlg = $('#tune');
    renderTune();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function renderTune() {
    const cfg = state.config;
    const defaults = Sim.defaultConfig(cfg.preset === 'custom' ? (cfg.base || 'grounded') : cfg.preset);
    $('#tune-preset-desc').textContent = cfg.preset === 'custom'
      ? 'Custom settings. Highlighted cells differ from the Grounded or Arcade preset they started from.'
      : Sim.PRESETS[cfg.preset].desc + ' Edit any value to make your own.';
    const table = $('#tune-table');
    table.textContent = '';
    const personKeys = new Set(['hp', 'armor', 'speed', 'cruise', 'dmg', 'atkInterval']);
    table.append(el('thead', null, el('tr', null, el('th', null, ''),
      Sim.FIELDS.map(f => el('th', { title: f.help }, f.label)))));
    const tbody = el('tbody');
    const input = (obj, defObj, f) => {
      // No min/max attributes: they make the step grid start at min, so defaults like courage 60
      // (min 1, step 5) fail validation. Without them the arrows step from the current value;
      // the change handler below does the clamping.
      const inp = el('input', {
        type: 'number', step: f.step, value: obj[f.key], 'aria-label': f.label,
        class: obj[f.key] !== defObj[f.key] ? 'changed' : null,
      });
      inp.addEventListener('change', () => {
        let v = parseFloat(inp.value);
        if (!isFinite(v)) { inp.value = obj[f.key]; return; }
        if (f.min !== undefined) v = Math.max(f.min, v);
        if (f.max !== undefined) v = Math.min(f.max, v);
        if (f.key === 'count') v = Math.round(v);
        obj[f.key] = v;
        inp.value = v;
        inp.classList.toggle('changed', v !== defObj[f.key]);
        if (cfg.preset !== 'custom') { cfg.base = cfg.preset; cfg.preset = 'custom'; $('#tune-preset-desc').textContent = 'Custom settings.'; }
        save();
        renderCards();
        renderActionBar();
      });
      return inp;
    };
    for (const k of Sim.ORDER) {
      tbody.append(el('tr', null,
        el('td', { class: 'sp' }, emojiSpan(k), cfg.species[k].plural),
        Sim.FIELDS.map(f => el('td', null, input(cfg.species[k], defaults.species[k], f)))));
    }
    tbody.append(el('tr', null,
      el('td', { class: 'sp' }, emojiSpan('person'), 'You'),
      Sim.FIELDS.map(f => el('td', null, personKeys.has(f.key) ? input(cfg.person, defaults.person, f) : ''))));
    table.append(tbody);

    const extra = $('#tune-extra');
    extra.textContent = '';
    extra.append(el('fieldset', null, el('legend', null, '🤠 Hunter’s rifle'),
      Sim.HUNTER_FIELDS.map(f => el('label', { title: f.help }, f.label, input(cfg.species.hunter, defaults.species.hunter, f)))));
  }

  // ---------- live simulation ----------
  let live = null;
  const renderer = Renderer.create($('#canvas'));

  function startWatch(opts) {
    opts = opts || {};
    const picks = (opts.picks || state.picks).slice();
    if (picks.length !== 2) return;
    const cfg = opts.cfg || JSON.parse(JSON.stringify(state.config));
    const seed = opts.seed !== undefined ? opts.seed : Trials.randomSeed();
    const sim = Sim.createSim(cfg, picks, seed, { fx: true });
    if (live && live.raf) cancelAnimationFrame(live.raf);
    const keepSpeed = live ? live.speedMode : 'auto';
    live = {
      sim, picks, cfg, seed, speedMode: keepSpeed, speed: 2, paused: false, acc: 0, last: 0, raf: 0,
      hover: null, mouse: null, logSeen: 0, hudT: 0, endShown: false, endTimer: 0, lastHp: 100, lastHitT: -99,
    };
    $('#menu').setAttribute('aria-hidden', 'true');
    $('#actionbar').hidden = true;
    $('#sim').hidden = false;
    $('#end').hidden = true;
    $('#sim-error').hidden = true;
    $('#hud-log').textContent = '';
    renderer.reset(sim);
    renderSpeedSeg();
    updatePauseBtn();
    renderSidePanel(true);
    // Start the loop before asking for fullscreen, so a browser that balks at
    // fullscreen (iOS Safari) can't stop the sim from running.
    live.raf = requestAnimationFrame(frame);
    if (opts.fullscreen && !document.fullscreenElement) enterFullscreen();
  }

  // iPhone Safari has no element fullscreen, and some WebKit builds expose
  // requestFullscreen without returning a promise, so guard every step.
  function enterFullscreen() {
    const s = $('#sim');
    if (!s.requestFullscreen || document.fullscreenEnabled === false) return;
    try {
      const p = s.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* not allowed here; stay windowed */ }
  }
  function leaveFullscreen() {
    try {
      const p = document.exitFullscreen && document.exitFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* already out */ }
  }

  function exitWatch() {
    if (!live) return;
    cancelAnimationFrame(live.raf);
    live = null;
    if (document.fullscreenElement) leaveFullscreen();
    $('#sim').hidden = true;
    $('#actionbar').hidden = false;
    $('#menu').removeAttribute('aria-hidden');
    $('#tooltip').hidden = true;
  }

  function autoTarget(sim) {
    const t = sim.t;
    if (t < 25) return 2;
    const p = sim.person;
    if (t - live.lastHitT < 4) return 3;
    for (const u of sim.units) {
      if (u.alive && u.team === 'att' && u.target === p && !u.sp.swarm && !u.sp.flying &&
        Math.abs(u.x - p.x) < 18 && Math.abs(u.y - p.y) < 18) return 4;
    }
    return 45;
  }

  // Keep the loop alive through an exception and put the message on screen,
  // since mobile browsers give no other way to see it.
  function frame(ts) {
    if (!live) return;
    const L = live;
    try { tick(L, ts); } catch (err) { showSimError(err); }
    if (live === L) L.raf = requestAnimationFrame(frame);
  }

  function showSimError(err) {
    console.error(err);
    const box = $('#sim-error');
    if (!box.hidden) return;
    box.textContent = `Something went wrong: ${err && err.message ? err.message : err}`;
    box.hidden = false;
  }

  function tick(L, ts) {
    const realDt = L.last ? Math.min(0.1, (ts - L.last) / 1000) : 0.016;
    L.last = ts;
    const sim = L.sim;
    const dt = sim.world.dt;
    if (!L.paused && !sim.done) {
      if (L.speedMode === 'auto') {
        const target = autoTarget(sim);
        // ease towards the target; drop speed quickly, raise it gently
        const k = target < L.speed ? 0.5 : Math.min(1, realDt * 1.2);
        L.speed += (target - L.speed) * k;
      } else L.speed = L.speedMode;
      L.acc += realDt * L.speed;
      let steps = 0;
      const maxSteps = 500;
      while (L.acc >= dt && steps < maxSteps && !sim.done) {
        sim.step();
        L.acc -= dt;
        steps++;
        if (sim.person.hp < L.lastHp) { L.lastHitT = sim.t; L.lastHp = sim.person.hp; }
      }
      if (steps >= maxSteps) L.acc = 0;
    }
    const alpha = sim.done ? 1 : Math.min(1, Math.max(0, L.acc / dt));
    renderer.draw(sim, alpha, L.paused ? 0 : realDt, L.hover ? L.hover.id : null);

    L.hudT -= realDt;
    if (L.hudT <= 0) { L.hudT = 0.1; updateHud(); }
    updateLog();
    if (L.mouse) updateTooltip();

    if (sim.done && !L.endShown) {
      L.endTimer += realDt;
      if (L.endTimer > 1.4) { L.endShown = true; updateHud(); showEnd(); }
    }
  }

  function personStatus(sim) {
    const p = sim.person;
    if (!p.alive) return 'Dead';
    let worst = null, wd = Infinity;
    for (const u of sim.units) {
      if (!u.alive || u.team !== 'att' || u.target !== p) continue;
      if (u.sp.swarm || (u.sp.flying && u.state !== 'dive')) continue;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < wd) { wd = d; worst = u; }
    }
    if (worst) {
      const n = worst.sp.name.toLowerCase();
      const who = worst.sp.ranged ? 'The hunter' : (/^[aeiou]/.test(n) ? 'An ' : 'A ') + n;
      if (worst.sp.ranged) return `${who} is lining up a shot (${Math.round(wd)} m)`;
      return `${who} is ${worst.state === 'dive' ? 'diving' : 'coming'} at you (${Math.round(wd)} m)`;
    }
    let rats = 0;
    for (const u of sim.units) if (u.alive && u.team === 'att' && u.sp.swarm && u.target === p && Math.hypot(u.x - p.x, u.y - p.y) < 10) rats += u.count;
    if (rats) return `${rats} rats swarming toward you`;
    if (p.moving > 3) return 'Running';
    return 'Holding position';
  }

  function updateHud() {
    const sim = live.sim;
    const t = sim.t;
    $('#hud-clock').textContent = fmtTime(t);
    $('#hud-total').textContent = `of ${fmtTime(sim.world.duration)}${live.paused ? ' · paused' : ''}`;
    $('#hud-progress').style.width = `${(t / sim.world.duration) * 100}%`;
    const hp = Math.max(0, sim.person.hp);
    const frac = hp / sim.person.maxHp;
    $('#hud-hp-num').textContent = Math.ceil(hp);
    const bar = $('#hud-hp');
    bar.style.width = `${frac * 100}%`;
    bar.style.background = frac > 0.5 ? 'var(--accent)' : frac > 0.25 ? '#eb8a34' : 'var(--att)';
    $('#hud-status').textContent = personStatus(sim);
    renderSidePanel(false);
  }

  function renderSidePanel() {
    const sim = live.sim;
    const groups = { def: {}, att: {} };
    for (const u of sim.units) {
      if (u.team === 'you') continue;
      const g = groups[u.team];
      const r = g[u.key] || (g[u.key] = { alive: 0, total: 0, flee: 0, feed: 0, busy: 0 });
      const n = u.sp.swarm ? u.count0 : 1;
      r.total += n;
      if (!u.alive) continue;
      const m = u.sp.swarm ? u.count : 1;
      r.alive += m;
      if (u.state === 'flee') r.flee += m;
      else if (u.state === 'feed') r.feed += m;
      else if (u.target === sim.person) r.busy += m;
    }
    for (const team of ['def', 'att']) {
      const ul = team === 'def' ? $('#hud-def') : $('#hud-att');
      ul.textContent = '';
      for (const k of Sim.ORDER) {
        const r = groups[team][k];
        if (!r) continue;
        const bits = [];
        if (team === 'att' && r.busy) bits.push(`${fmtNum(r.busy)} on you`);
        if (r.feed) bits.push(`${fmtNum(r.feed)} 🍖`);
        if (r.flee) bits.push(`${fmtNum(r.flee)} 💨`);
        ul.append(el('li', { class: r.alive ? null : 'gone' },
          emojiSpan(k),
          el('span', null, sp(k).plural),
          el('span', { class: 'n' }, `${fmtNum(r.alive)}/${fmtNum(r.total)}`),
          bits.length ? el('span', { class: 's' }, bits.join(' · ')) : null));
      }
    }
  }

  function updateLog() {
    const ev = live.sim.events;
    if (live.logSeen === ev.length) return;
    // keep the log readable at speed: the most recent few only
    const recent = ev.slice(-6);
    const ol = $('#hud-log');
    ol.textContent = '';
    for (const e of recent) {
      ol.append(el('li', { class: `k-${e.kind} team-${e.team}` }, el('span', { class: 't' }, fmtTime(e.t)), e.text));
    }
    live.logSeen = ev.length;
  }

  function describe(u, sim) {
    const tg = u.target;
    const tgt = !tg ? '' : tg === sim.person ? 'you' : (tg.team === 'def' ? 'your ' : '') + (tg.sp.swarm ? 'rats' : tg.sp.name.toLowerCase());
    if (u === sim.person) return u.alive ? personStatus(sim) : 'Dead';
    if (!u.alive) return 'Dead';
    if (u.sp.ranged && u.ammo > 0 && u.state !== 'flee') {
      if (u.mag <= 0) return `reloading · ${u.ammo} rounds left`;
      return (tg ? (u.aimT > 0.5 ? `aiming at ${tgt}` : `looking for a shot at ${tgt}`) : 'scanning') + ` · ${u.ammo} rounds`;
    }
    switch (u.state) {
      case 'stalk': return u.sp.amphibious ? 'lurking in the pond' : 'circling, sizing you up';
      case 'charge': return `charging ${tgt}`;
      case 'fight': return `fighting ${tgt}`;
      case 'flee': return 'fleeing';
      case 'feed': return 'eating a carcass';
      case 'guard': return 'guarding you';
      case 'engage': return `attacking ${tgt}`;
      case 'soar': return 'circling overhead';
      case 'dive': return `diving at ${tgt}`;
      case 'climb': return 'climbing away';
      case 'lurk': return 'hugging the wall';
      case 'swarm': return `swarming ${tgt}`;
      default: return u.state;
    }
  }

  function updateTooltip() {
    const tip = $('#tooltip');
    const L = live;
    const u = renderer.pick(L.sim, L.mouse.x, L.mouse.y);
    L.hover = u;
    if (!u) { tip.hidden = true; return; }
    const who = u === L.sim.person ? 'You' : u.sp.swarm ? `${u.count} rats` : u.sp.name;
    const team = u.team === 'you' ? '' : u.team === 'def' ? 'yours' : 'attacker';
    tip.textContent = '';
    tip.append(
      el('b', null, `${u.sp.emoji} ${who}`), ' ',
      team ? el('span', { class: `team-${u.team}` }, `(${team})`) : null,
      el('br'),
      u.sp.swarm ? '' : `${Math.max(0, Math.ceil(u.hp))}/${u.maxHp} HP · `,
      describe(u, L.sim));
    tip.hidden = false;
    const r = $('#sim').getBoundingClientRect();
    let x = L.mouse.x + 14, y = L.mouse.y + 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > r.width - 8) x = L.mouse.x - w - 14;
    if (y + h > r.height - 8) y = L.mouse.y - h - 14;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }

  function showEnd() {
    const sim = live.sim;
    const r = sim.result;
    const card = $('#end .end-card');
    card.className = 'end-card ' + (r.survived ? 'won' : 'lost');
    $('#end-eyebrow').textContent = pairText(live.picks) + ` · seed ${r.seed}`;
    if (r.survived) {
      $('#end-title').textContent = r.cleared ? 'Nothing left alive to attack you.' : 'You survived the hour.';
      $('#end-sub').textContent = r.cleared
        ? `Every attacker was dead by ${fmtTime(r.time)}. You finished on ${Math.ceil(r.personHp)} HP.`
        : `You walked out on ${Math.ceil(r.personHp)} HP.`;
    } else {
      $('#end-title').textContent = `Killed by ${killerPhrase(r.killedBy)} at ${fmtTime(r.time)}.`;
      $('#end-sub').textContent = `${fmtTime(sim.world.duration - r.time)} short of the hour.`;
    }
    const dmg = Object.entries(r.dmgBy).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: sp(k).plural, value: v, text: `${Math.round(v)} HP` }));
    const dmgBox = $('#end-dmg');
    dmgBox.textContent = '';
    dmgBox.append(dmg.length ? hbars(dmg) : el('p', { class: 'muted' }, 'Not a scratch.'));
    const kills = $('#end-kills');
    kills.textContent = '';
    for (const k of live.picks) {
      const rec = r.kills.def[k] || { units: 0, rats: 0 };
      const d = r.defenders[k] || { alive: 0, total: 0 };
      const bits = [];
      if (rec.units) bits.push(`${rec.units} animal${rec.units === 1 ? '' : 's'} killed`);
      if (rec.rats) bits.push(`${fmtNum(rec.rats)} rats`);
      kills.append(el('div', null, emojiSpan(k), el('b', null, sp(k).plural), ': ',
        bits.length ? bits.join(', ') : 'no kills',
        el('span', { class: 'muted' }, ` · ${fmtNum(d.alive)}/${fmtNum(d.total)} still standing`)));
    }
    const left = Object.entries(r.attackers).filter(([, v]) => v.alive > 0)
      .map(([k, v]) => `${fmtNum(v.alive)} ${v.alive === 1 && k !== 'buffalo' ? sp(k).name.toLowerCase() : sp(k).plural.toLowerCase()}`);
    kills.append(el('div', { class: 'muted', style: 'margin-top:6px' }, left.length ? `Attackers still alive: ${left.join(', ')}.` : 'No attackers left alive.'));
    $('#end').hidden = false;
  }

  function renderSpeedSeg() {
    const seg = $('#speed-seg');
    seg.textContent = '';
    for (const s of SPEEDS) {
      seg.append(el('button', {
        type: 'button', role: 'radio', title: s.title || `${s.label} real time`,
        'aria-checked': live && live.speedMode === s.id ? 'true' : 'false',
        onclick: () => { live.speedMode = s.id; live.paused = false; updatePauseBtn(); renderSpeedSeg(); },
      }, s.label));
    }
  }
  function updatePauseBtn() {
    const b = $('#btn-pause');
    b.textContent = live && live.paused ? '▶' : '⏸';
    b.title = live && live.paused ? 'Resume (space)' : 'Pause (space)';
  }

  // ---------- events ----------
  function bind() {
    $('#preset-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-preset]');
      if (b) setPreset(b.dataset.preset);
    });
    $('#btn-tune').addEventListener('click', openTune);
    $('#btn-trials').addEventListener('click', runTrials);
    $('#btn-rank').addEventListener('click', () => runRank(state.results && state.results.kind === 'rank' ? state.results.perPair : 20));
    $('#btn-watch').addEventListener('click', () => startWatch({ fullscreen: true }));
    $('#tune').addEventListener('close', () => { if (state.results) renderResults(); });
    $('#tune-reset-g').addEventListener('click', () => { setPreset('grounded'); renderTune(); });
    $('#tune-reset-a').addEventListener('click', () => { setPreset('arcade'); renderTune(); });

    $('#btn-exit').addEventListener('click', exitWatch);
    $('#btn-end-back').addEventListener('click', exitWatch);
    $('#btn-end-replay').addEventListener('click', () => live && startWatch({ picks: live.picks, cfg: live.cfg, seed: live.seed }));
    $('#btn-end-new').addEventListener('click', () => live && startWatch({ picks: live.picks, cfg: live.cfg }));
    $('#btn-pause').addEventListener('click', () => { if (live) { live.paused = !live.paused; updatePauseBtn(); updateHud(); } });
    $('#btn-fs').addEventListener('click', toggleFullscreen);
    if (!$('#sim').requestFullscreen || document.fullscreenEnabled === false) $('#btn-fs').hidden = true;
    // Errors outside the frame loop (e.g. while setting up a run) still get shown.
    window.addEventListener('error', (e) => { if (live) showSimError(e.error || e.message); });

    const canvas = $('#canvas');
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!live) return;
      const r = canvas.getBoundingClientRect();
      live.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (drag && renderer.zoom > 1) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) { drag.moved = true; canvas.classList.add('dragging'); }
        renderer.panBy(dx, dy);
        drag.x = e.clientX; drag.y = e.clientY;
      }
    });
    const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => { if (live) { live.mouse = null; live.hover = null; $('#tooltip').hidden = true; } });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    canvas.addEventListener('dblclick', () => renderer.resetView());

    window.addEventListener('resize', () => renderer.resize());
    document.addEventListener('fullscreenchange', () => setTimeout(() => renderer.resize(), 50));
    document.addEventListener('keydown', (e) => {
      if (!live || e.target.closest('input, select, textarea, dialog')) return;
      if (e.key === ' ') { e.preventDefault(); live.paused = !live.paused; updatePauseBtn(); updateHud(); }
      else if (e.key === 'Escape' && !document.fullscreenElement) exitWatch();
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (/^[1-6]$/.test(e.key)) { live.speedMode = SPEEDS[+e.key - 1].id; renderSpeedSeg(); }
    });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) leaveFullscreen();
    else enterFullscreen();
  }

  load();
  bind();
  renderCards();
  renderActionBar();
})();
