/*
 * Arena survival simulation engine.
 *
 * Pure logic, no DOM. Everything lives inside the SimCore factory so the whole
 * engine can be stringified into a Web Worker for Monte Carlo runs
 * (see trials.js) while the page uses the same code for the visual replay.
 *
 * Units: metres and seconds. The sim advances in fixed steps of WORLD.dt so a
 * given (config, picks, seed) always replays identically.
 */
function SimCore() {
  'use strict';

  const WORLD = {
    w: 120,
    h: 80,
    pond: { x: 96, y: 21, r: 11 },
    start: { x: 58, y: 46 },
    duration: 3600,
    dt: 0.2,
    guardZone: 15, // defenders within this range of you intimidate attackers
    leash: 20, // defenders won't chase further than this from you
    ratCluster: 50, // rats are simulated in clusters of this many
  };

  // Per-second rates that scale each species' aggression into an attack decision.
  const RATE = { commit: 0.04, dive: 0.02, swarm: 0.02, fire: 1.2 };

  const ORDER = ['hawk', 'croc', 'bear', 'wolf', 'hunter', 'buffalo', 'rat', 'gorilla', 'lion'];

  // Grounded defaults. Damage is in "health points"; you have 100.
  const BASE = {
    hawk: {
      name: 'Hawk', plural: 'Hawks', emoji: '🦅', count: 50,
      hp: 6, armor: 0, speed: 17, cruise: 9, dmg: 0.6, atkInterval: 1.5,
      aggression: 0.25, courage: 60, persistence: 10, fleeAt: 0.5, power: 1, feedChance: 0.9, feedTime: 60,
      radius: 0.35, reach: 0.5, swarmKill: 1, antiAir: 0.6, ratCap: 3, retaliate: 0, stamina: 999,
      flying: true, eats: 'small',
      blurb: 'Fast, many and hard to hit, but light. Real hawks hunt rats, not people. They harass rather than kill.',
    },
    croc: {
      name: 'Crocodile', plural: 'Crocodiles', emoji: '🐊', count: 10,
      hp: 350, armor: 5, speed: 4.5, cruise: 1.2, dmg: 55, atkInterval: 3,
      aggression: 0.3, courage: 40, persistence: 40, fleeAt: 0.3, power: 25, feedChance: 0.7, feedTime: 600,
      radius: 1.1, reach: 1.4, swarmKill: 2, antiAir: 0.05, ratCap: 40, retaliate: 0.7, stamina: 15,
      amphibious: true, waterSpeed: 8, eats: 'meat',
      blurb: 'Lethal in or near the pond, sluggish and quick to tire on land. Armoured against small biters.',
    },
    bear: {
      name: 'Brown bear', plural: 'Brown bears', emoji: '🐻', count: 3,
      hp: 600, armor: 3, speed: 13, cruise: 5, dmg: 45, atkInterval: 1.4,
      aggression: 0.3, courage: 150, persistence: 25, fleeAt: 0.35, power: 90, feedChance: 0.5, feedTime: 400,
      radius: 1.1, reach: 1.3, swarmKill: 4, antiAir: 0.25, ratCap: 60, retaliate: 0.85, stamina: 40,
      eats: 'meat',
      blurb: 'Huge, tough and terrifying. Few things here will take on a grizzly. Only three of them, though.',
    },
    wolf: {
      name: 'Wolf', plural: 'Wolves', emoji: '🐺', count: 15,
      hp: 55, armor: 0.5, speed: 15, cruise: 7, dmg: 13, atkInterval: 1,
      aggression: 0.4, courage: 45, persistence: 30, fleeAt: 0.45, power: 18, feedChance: 0.6, feedTime: 200,
      radius: 0.6, reach: 0.9, swarmKill: 2, antiAir: 0.2, ratCap: 20, retaliate: 0.6, stamina: 120,
      pack: true, eats: 'meat',
      blurb: 'Coordinated pack hunters with great stamina. Individually fragile, dangerous together.',
    },
    hunter: {
      name: 'Hunter', plural: 'Hunter', emoji: '🤠', count: 1,
      hp: 100, armor: 0.5, speed: 6, cruise: 2, dmg: 6, atkInterval: 1.5,
      aggression: 0.3, courage: 1000, persistence: 60, fleeAt: 0.4, power: 50, feedChance: 0, feedTime: 0,
      radius: 0.4, reach: 0.8, swarmKill: 1, antiAir: 0.1, ratCap: 20, retaliate: 1, stamina: 30,
      ranged: true, ammo: 40, accuracy: 0.6, rifleDmg: 80, range: 150, aimTime: 2, bolt: 1.5, magazine: 5, reload: 5,
      eats: 'none',
      blurb: 'One shot can end it, either way. Limited ammo, needs a clear line of fire, useless against rats.',
    },
    buffalo: {
      name: 'Buffalo', plural: 'Buffalo', emoji: '🐃', count: 7,
      hp: 750, armor: 4, speed: 14, cruise: 5, dmg: 40, atkInterval: 2,
      aggression: 0.15, courage: 100, persistence: 20, fleeAt: 0.3, power: 80, feedChance: 0, feedTime: 0,
      radius: 1.3, reach: 1.5, swarmKill: 5, antiAir: 0.03, ratCap: 80, retaliate: 0.9, stamina: 40,
      trample: true, eats: 'none',
      blurb: 'Half a tonne of horn and temper. Lions fear them. A wall of meat that also tramples rats.',
    },
    rat: {
      name: 'Rat', plural: 'Rats', emoji: '🐀', count: 10000,
      hp: 1, armor: 0, speed: 3.5, cruise: 1.5, dmg: 0.2, atkInterval: 1,
      aggression: 0.5, courage: 1000, persistence: 20, fleeAt: 0.5, power: 0.03, feedChance: 0.8, feedTime: 180,
      radius: 0.2, reach: 0.3, swarmKill: 1, antiAir: 0.05, ratCap: 0, retaliate: 0.5, stamina: 999,
      swarm: true, eats: 'any',
      blurb: 'Individually nothing. Ten thousand of them is a carpet of teeth that never stops coming.',
    },
    gorilla: {
      name: 'Gorilla', plural: 'Gorillas', emoji: '🦍', count: 5,
      hp: 220, armor: 1.5, speed: 10, cruise: 4, dmg: 28, atkInterval: 1.2,
      aggression: 0.15, courage: 90, persistence: 20, fleeAt: 0.4, power: 55, feedChance: 0, feedTime: 0,
      radius: 0.9, reach: 1.3, swarmKill: 4, antiAir: 0.4, ratCap: 45, retaliate: 0.85, stamina: 30,
      eats: 'none',
      blurb: 'Enormously strong with hands that grab, swat hawks and crush rats. Not natural killers.',
    },
    lion: {
      name: 'Lion', plural: 'Lions', emoji: '🦁', count: 4,
      hp: 220, armor: 1.5, speed: 16, cruise: 6, dmg: 50, atkInterval: 1.3,
      aggression: 0.4, courage: 90, persistence: 30, fleeAt: 0.35, power: 70, feedChance: 0.6, feedTime: 400,
      radius: 1.0, reach: 1.3, swarmKill: 3, antiAir: 0.25, ratCap: 45, retaliate: 0.75, stamina: 25,
      eats: 'meat',
      blurb: 'Apex ambush predators: explosive sprint, killing bite. Tire fast, and hesitate against big animals.',
    },
  };

  const PERSON = {
    name: 'You', plural: 'You', emoji: '🧍', count: 1,
    hp: 100, armor: 0, speed: 6, cruise: 1.6, dmg: 3, atkInterval: 1,
    radius: 0.4, reach: 0.6, swarmKill: 1, antiAir: 0.15, ratCap: 15, stamina: 20, power: 0,
  };

  // Stats exposed in the settings table. `hunterOnly` fields only apply to the hunter.
  const FIELDS = [
    { key: 'count', label: 'Count', step: 1, min: 0, help: 'How many are in the arena.' },
    { key: 'hp', label: 'Health', step: 1, min: 1, help: 'Hit points. You have 100.' },
    { key: 'armor', label: 'Armour', step: 0.5, min: 0, help: 'Flat damage removed from every hit (hide, fat, scales).' },
    { key: 'speed', label: 'Sprint', step: 0.5, min: 0, help: 'Burst speed in m/s, limited by stamina.' },
    { key: 'cruise', label: 'Cruise', step: 0.5, min: 0, help: 'Sustainable speed in m/s.' },
    { key: 'dmg', label: 'Damage', step: 0.1, min: 0, help: 'Damage per landed hit (per bite, for rats).' },
    { key: 'atkInterval', label: 'Secs/hit', step: 0.1, min: 0.2, help: 'Seconds between attacks.' },
    { key: 'aggression', label: 'Aggression', step: 0.05, min: 0, max: 1, help: 'Chance per second to commit to an attack on you.' },
    { key: 'courage', label: 'Courage', step: 5, min: 1, help: 'How much intimidation from your defenders it tolerates before hanging back.' },
    { key: 'power', label: 'Intimidation', step: 1, min: 0, help: 'How much it deters attackers when guarding you.' },
    { key: 'persistence', label: 'Persistence', step: 1, min: 1, help: 'Minutes until its interest in attacking halves.' },
    { key: 'fleeAt', label: 'Flee at', step: 0.05, min: 0, max: 1, help: 'Runs away when health drops below this fraction.' },
    { key: 'feedChance', label: 'Stops to eat', step: 0.05, min: 0, max: 1, help: 'Chance it stops to eat a fresh kill.' },
  ];
  const HUNTER_FIELDS = [
    { key: 'ammo', label: 'Rounds', step: 1, min: 0, help: 'Total rifle rounds.' },
    { key: 'accuracy', label: 'Accuracy', step: 0.05, min: 0, max: 1, help: 'Hit chance on a clear, close, still target.' },
    { key: 'rifleDmg', label: 'Rifle dmg', step: 5, min: 0, help: 'Damage per rifle hit (vital hits do 2.5×).' },
  ];

  const PRESETS = {
    grounded: { label: 'Grounded', desc: 'Animals behave roughly as they would: they hesitate, tire, flee when hurt and stop to eat.' },
    arcade: { label: 'Arcade', desc: 'Everything attacks relentlessly for the whole hour. No fear, no fleeing, no snacks.' },
  };

  function defaultConfig(preset) {
    const cfg = { preset: preset || 'grounded', species: {}, person: Object.assign({}, PERSON) };
    for (const k of ORDER) cfg.species[k] = Object.assign({}, BASE[k]);
    if (cfg.preset === 'arcade') {
      for (const k of ORDER) {
        Object.assign(cfg.species[k], { aggression: 1, courage: 100000, persistence: 100000, fleeAt: 0, feedChance: 0 });
      }
      Object.assign(cfg.species.hunter, { ammo: 200, accuracy: 0.85 });
    }
    return cfg;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hyp(x, y) { return Math.sqrt(x * x + y * y); }

  // Every species object gets the same keys in the same order so the JIT sees
  // one shape (this matters a lot for headless trial speed).
  const SHAPE = {
    name: '', plural: '', emoji: '', count: 0, hp: 1, armor: 0, speed: 1, cruise: 1, dmg: 0, atkInterval: 1,
    aggression: 0, courage: 1, persistence: 1, fleeAt: 0, power: 0, feedChance: 0, feedTime: 0,
    radius: 0.4, reach: 0.5, swarmKill: 1, antiAir: 0, ratCap: 10, retaliate: 0, stamina: 10,
    flying: false, swarm: false, ranged: false, amphibious: false, pack: false, trample: false,
    waterSpeed: 0, eats: 'none', ammo: 0, accuracy: 0, rifleDmg: 0, range: 0, aimTime: 0, bolt: 0, magazine: 0, reload: 0,
    blurb: '',
  };
  function normalize(sp) {
    const o = {};
    for (const k in SHAPE) {
      const v = sp[k];
      o[k] = v === undefined || v === null || (typeof SHAPE[k] === 'number' && !isFinite(+v)) ? SHAPE[k] : (typeof SHAPE[k] === 'number' ? +v : v);
    }
    return o;
  }

  function ratRadius(n) { return Math.max(0.2, 0.17 * Math.sqrt(n)); }

  function createSim(config, picks, seed, opts) {
    opts = opts || {};
    const fxOn = !!opts.fx;
    const R = mulberry32(seed >>> 0);
    const dt = WORLD.dt;
    const pond = WORLD.pond;
    const S = {};
    for (const k of ORDER) S[k] = normalize(config.species[k]);
    const personSp = normalize(config.person);
    const defSet = new Set(picks);

    const units = [];
    const corpses = [];
    const fx = [];
    const events = [];
    let t = 0;
    let done = false;
    let result = null;
    let nextId = 1;

    const stats = {
      dmgBy: {}, // damage dealt to you, by species
      kills: { def: {}, att: {} }, // kills by team then species: { units, rats }
      shots: 0,
    };

    // ---------- spawning ----------
    function addUnit(key, team, x, y, sp, extra) {
      const u = {
        id: nextId++, key, team, sp, x, y, px: x, py: y,
        hp: sp.hp, maxHp: sp.hp, r: sp.radius, alive: true,
        state: 'idle', target: null, cd: R() * (sp.atkInterval || 1), decideT: R() * 0.6, timer: 0,
        stam: sp.stamina || 10, alt: sp.flying ? 1 : 0, face: R() < 0.5 ? -1 : 1, moving: 0,
        fleeAt: sp.fleeAt, lastHitBy: null, lastHitT: -99, stunT: 0, slowT: 0, ratLoad: 0, engagedBy: 0,
        interestMult: 1, gx: x, gy: y, burst: false, dP: 0, count: 1, count0: 1,
        orbitA: R() * Math.PI * 2, orbitR: 18 + R() * 12, slot: 0, slotN: 1, role: null, corpse: null,
        kills: 0, chargeT: 0, blockedT: 0, cx: x, cy: y, ga: 0, gr: 0, sprint: false,
        ammo: 0, mag: 0, aimT: 0, reloadT: 0, mode: '', wantFire: false, lastBlocker: null,
      };
      if (extra) Object.assign(u, extra);
      units.push(u);
      return u;
    }

    const person = addUnit('person', 'you', WORLD.start.x, WORLD.start.y, personSp);
    person.state = 'hold';

    const SPAWN = {
      lion: { x: 12, y: 12 }, wolf: { x: 10, y: 68 }, bear: { x: 58, y: 6 }, buffalo: { x: 108, y: 70 },
      gorilla: { x: 36, y: 74 }, hunter: { x: 5, y: 40 },
    };

    function clampPos(u) {
      const r = u.r;
      if (u.x < r) u.x = r; else if (u.x > WORLD.w - r) u.x = WORLD.w - r;
      if (u.y < r) u.y = r; else if (u.y > WORLD.h - r) u.y = WORLD.h - r;
    }

    for (const key of ORDER) {
      const sp = S[key];
      const team = defSet.has(key) ? 'def' : 'att';
      let n = Math.max(0, Math.round(sp.count));
      if (n === 0) continue;
      if (sp.swarm) {
        const k = WORLD.ratCluster;
        const clusters = Math.ceil(n / k);
        for (let i = 0; i < clusters; i++) {
          const c = Math.min(k, n - i * k);
          let x, y;
          if (team === 'def') {
            const a = R() * Math.PI * 2, rr = 3.5 + R() * 6;
            x = person.x + Math.cos(a) * rr; y = person.y + Math.sin(a) * rr;
          } else {
            // spread along the walls
            const p = R() * 2 * (WORLD.w + WORLD.h);
            const off = 1 + R() * 4;
            if (p < WORLD.w) { x = p; y = off; }
            else if (p < WORLD.w + WORLD.h) { x = WORLD.w - off; y = p - WORLD.w; }
            else if (p < 2 * WORLD.w + WORLD.h) { x = p - WORLD.w - WORLD.h; y = WORLD.h - off; }
            else { x = off; y = p - 2 * WORLD.w - WORLD.h; }
          }
          const u = addUnit(key, team, x, y, sp, { count: c, count0: c, hp: c, maxHp: c, r: ratRadius(c) });
          u.state = team === 'def' ? 'guard' : 'lurk';
          u.ga = R() * Math.PI * 2; u.gr = 3 + R() * 7;
          clampPos(u);
        }
        continue;
      }
      for (let i = 0; i < n; i++) {
        let x, y;
        if (team === 'def') {
          const a = (i / n) * Math.PI * 2 + R() * 0.4, rr = 2.5 + sp.radius * 2 + R() * 1.5;
          x = person.x + Math.cos(a) * rr; y = person.y + Math.sin(a) * rr;
        } else if (sp.flying) {
          x = 10 + R() * (WORLD.w - 20); y = 8 + R() * (WORLD.h - 16);
        } else if (sp.amphibious) {
          const a = R() * Math.PI * 2, rr = R() * (pond.r - 2);
          x = pond.x + Math.cos(a) * rr; y = pond.y + Math.sin(a) * rr;
        } else {
          const s = SPAWN[key] || { x: 10, y: 10 };
          x = s.x + (R() - 0.5) * 10; y = s.y + (R() - 0.5) * 10;
        }
        const u = addUnit(key, team, x, y, sp);
        if (sp.flying) {
          u.state = 'soar';
          u.cx = team === 'def' ? person.x : x; u.cy = team === 'def' ? person.y : y;
        } else if (team === 'def') {
          u.state = 'guard';
        } else {
          u.state = 'stalk';
        }
        if (sp.ranged) { u.ammo = sp.ammo; u.mag = Math.min(sp.magazine, sp.ammo); u.aimT = 0; u.reloadT = 0; }
        clampPos(u);
      }
    }

    // Guard slots: ground, non-swarm defenders form a ring around you.
    const guards = units.filter(u => u.team === 'def' && !u.sp.swarm && !u.sp.flying && !u.sp.ranged);
    guards.sort((a, b) => b.r - a.r);
    guards.forEach((u, i) => { u.slot = i; u.slotN = guards.length; });
    // The two fastest ground defenders are designated to run down an enemy rifleman.
    const enemyHunter = units.find(u => u.team === 'att' && u.sp.ranged) || null;
    if (enemyHunter) {
      guards.slice().sort((a, b) => b.sp.speed - a.sp.speed).slice(0, 2).forEach(u => { u.role = 'flanker'; });
      const ratDefs = units.filter(u => u.team === 'def' && u.sp.swarm);
      ratDefs.slice(0, 8).forEach(u => { u.role = 'flanker'; });
      const hawkDefs = units.filter(u => u.team === 'def' && u.sp.flying);
      hawkDefs.slice(0, Math.ceil(hawkDefs.length * 0.3)).forEach(u => { u.role = 'flanker'; });
    }
    const crocAttackers = units.filter(u => u.team === 'att' && u.sp.amphibious);

    // ---------- spatial grid ----------
    const CELL = 5, GW = Math.ceil(WORLD.w / CELL), GH = Math.ceil(WORLD.h / CELL);
    const cellHead = new Int32Array(GW * GH);
    const cellNext = new Int32Array(units.length);
    function cellIdx(x, y) {
      let cx = (x / CELL) | 0, cy = (y / CELL) | 0;
      if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
      if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
      return cy * GW + cx;
    }
    function buildGrid() {
      cellHead.fill(-1);
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (!u.alive) continue;
        const c = cellIdx(u.x, u.y);
        cellNext[i] = cellHead[c];
        cellHead[c] = i;
      }
    }
    // Calls fn(unit, distSq) for alive units within rad of (x, y).
    function forNear(x, y, rad, fn) {
      let x0 = ((x - rad) / CELL) | 0, x1 = ((x + rad) / CELL) | 0;
      let y0 = ((y - rad) / CELL) | 0, y1 = ((y + rad) / CELL) | 0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      if (x1 >= GW) x1 = GW - 1; if (y1 >= GH) y1 = GH - 1;
      const r2 = rad * rad;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          for (let i = cellHead[cy * GW + cx]; i !== -1; i = cellNext[i]) {
            const u = units[i];
            const dx = u.x - x, dy = u.y - y, d2 = dx * dx + dy * dy;
            if (d2 <= r2) fn(u, d2);
          }
        }
      }
    }

    // ---------- helpers ----------
    function dist(a, b) { return hyp(a.x - b.x, a.y - b.y); }
    function inPond(u) { return hyp(u.x - pond.x, u.y - pond.y) < pond.r - 0.3; }
    function isEnemy(a, b) { return (a.team === 'att') !== (b.team === 'att'); }
    function interest(u) {
      return Math.pow(0.5, t / (u.sp.persistence * 60)) * u.interestMult;
    }
    function active(u) { return u.alive && u.state !== 'flee' && u.state !== 'feed'; }
    function airborne(u) { return u.sp.flying && u.alt > 0.35; }
    function danger(u) {
      if (u.sp.ranged) return u.ammo > 0 ? 45 : 4;
      const dps = u.sp.dmg / u.sp.atkInterval;
      return u.sp.swarm ? u.count * dps * 0.35 : dps;
    }
    function label(u, cap) {
      if (u === person) return cap ? 'You' : 'you';
      const name = u.sp.name.toLowerCase();
      let s;
      if (u.sp.swarm) s = (u.team === 'def' ? 'your rats' : 'rats');
      else if (u.sp.ranged) s = u.team === 'def' ? 'your hunter' : 'the hunter';
      else s = (u.team === 'def' ? 'your ' : (/^[aeiou]/.test(name) ? 'an ' : 'a ')) + name;
      return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }
    function event(text, kind, team) {
      if (!fxOn) return;
      events.push({ t, text, kind, team });
      if (events.length > 300) events.splice(0, events.length - 300);
    }
    function addFx(o) { if (fxOn) fx.push(o); }

    function speedFor(u, burst) {
      const sp = u.sp;
      let s;
      if (burst && u.stam > 0) { s = sp.speed; u.burst = true; } else { s = sp.cruise; u.burst = false; }
      if (sp.amphibious && inPond(u)) s = sp.waterSpeed;
      if (u.slowT > 0) s *= 0.25;
      return s;
    }
    function moveTo(u, tx, ty, spd, stop) {
      const dx = tx - u.x, dy = ty - u.y;
      const d = hyp(dx, dy);
      if (d <= stop || d < 1e-6) { u.moving = 0; return d; }
      const s = Math.min(spd * dt, d - stop);
      u.x += (dx / d) * s; u.y += (dy / d) * s;
      if (Math.abs(dx) > 0.05) u.face = dx < 0 ? -1 : 1;
      u.moving = s / dt;
      return d;
    }
    function moveAway(u, fx_, fy_, spd) {
      let dx = u.x - fx_, dy = u.y - fy_;
      const d = hyp(dx, dy) || 1;
      dx /= d; dy /= d;
      // steer off walls
      const m = 8;
      if (u.x < m) dx += (m - u.x) / m; if (u.x > WORLD.w - m) dx -= (u.x - WORLD.w + m) / m;
      if (u.y < m) dy += (m - u.y) / m; if (u.y > WORLD.h - m) dy -= (u.y - WORLD.h + m) / m;
      moveTo(u, u.x + dx * 10, u.y + dy * 10, spd, 0);
    }
    function nearestCorpse(u, rad, eatsAny) {
      let best = null, bd = rad;
      for (const c of corpses) {
        if (c.meat <= 0) continue;
        if (!eatsAny && c.small) continue;
        const d = hyp(c.x - u.x, c.y - u.y);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }
    function startFeed(u, corpse, time) {
      u.state = 'feed'; u.corpse = corpse; u.timer = time; u.target = null;
    }
    // Fleeing happens once per wound level: a returning animal fights on until
    // it is hurt much worse.
    function startFlee(u, time) {
      if (u.state !== 'flee' && !u.sp.swarm) event(`${label(u, true)} flees, badly hurt.`, 'info', u.team);
      u.state = 'flee'; u.timer = time; u.target = null; u.interestMult *= 0.5; u.fleeAt *= 0.4;
    }

    // ---------- damage ----------
    function armorDmg(dmg, v) { return Math.max(dmg * 0.12, dmg - (v.sp.armor || 0) - (v.sp.amphibious && inPond(v) ? 2 : 0)); }
    function credit(src, rats, unitsK) {
      const tk = src.team === 'att' ? 'att' : 'def';
      const k = src.key;
      const rec = stats.kills[tk][k] || (stats.kills[tk][k] = { units: 0, rats: 0 });
      rec.rats += rats; rec.units += unitsK;
    }
    function hurt(v, dmg, src) {
      if (!v.alive) return;
      v.hp -= dmg;
      v.lastHitBy = src; v.lastHitT = t;
      if (v.cd < 0.3) v.cd = 0.3;
      if (v.sp.ranged) v.aimT = 0;
      if (v === person) {
        stats.dmgBy[src.key] = (stats.dmgBy[src.key] || 0) + dmg;
        if (dmg >= 6) event(`${label(src, true)} hit you (−${Math.round(dmg)}).`, 'hurt', 'you');
      }
      addFx({ type: 'hit', x: v.x, y: v.y, big: dmg > 20, you: v === person });
      if (v.hp <= 0) die(v, src);
    }
    function killRats(v, n, src) {
      if (!v.alive) return;
      n = Math.min(n, v.count);
      if (n <= 0) return;
      v.count -= n; v.hp = v.count;
      v.r = ratRadius(v.count);
      v.lastHitBy = src; v.lastHitT = t;
      credit(src, n, 0);
      addFx({ type: 'ratdie', x: v.x, y: v.y, n });
      if (v.count <= 0) { v.alive = false; return; }
      if (v.state !== 'flee' && v.count < v.count0 * v.fleeAt) startFlee(v, 40 + R() * 60);
      else if (v.state !== 'flee' && R() < 0.15 * v.sp.fleeAt) { v.state = 'flee'; v.timer = 4 + R() * 6; v.target = null; }
    }
    function die(v, src) {
      v.alive = false;
      credit(src, 0, 1);
      src.kills++;
      if (!v.sp.swarm) {
        corpses.push({
          x: v.x, y: v.y, key: v.key, team: v.team, emoji: v.sp.emoji, face: v.face,
          meat: v.sp.flying ? 0 : v.maxHp, small: !!v.sp.flying, t,
        });
      }
      if (v === person) {
        event(`${label(src, true)} killed you.`, 'death', 'you');
        finish(false, src);
      } else {
        event(`${label(src, true)} killed ${label(v)}.`, 'kill', src.team);
      }
    }

    // A melee (or swarm) attack attempt. Returns true if in range.
    function tryAttack(u, v) {
      const reach = u.sp.reach + u.r + v.r;
      const d = dist(u, v);
      if (d > reach) return false;
      if (u.cd > 0) return true;
      if (airborne(v) && !u.sp.flying) return false;
      u.cd = u.sp.atkInterval * (0.85 + R() * 0.3);
      if (u.sp.swarm) { ratBite(u, v); return true; }
      let hitP = 0.85;
      if (v.sp.flying && !u.sp.flying) hitP = u.sp.antiAir;
      if (v === person && person.burst) hitP *= 0.75;
      if (R() > hitP) return true;
      if (v.sp.swarm) { killRats(v, u.sp.swarmKill, u); return true; }
      let dmg = u.sp.dmg * (0.7 + R() * 0.6);
      if (u.sp.pack) {
        let n = 0;
        forNear(v.x, v.y, 3, w => { if (w !== u && w.key === u.key && w.team === u.team && w.target === v) n++; });
        dmg *= 1 + 0.15 * Math.min(n, 4);
      }
      if (u.sp.trample && u.chargeT > 1.5) { dmg *= 1.6; u.chargeT = 0; }
      if (u.sp.amphibious) {
        v.slowT = inPond(u) ? 3 : 1.5; // grabbed
        if (inPond(u)) dmg *= 1.3;
      }
      hurt(v, armorDmg(dmg, v), u);
      return true;
    }
    function ratBite(u, v) {
      if (v.sp.swarm) { killRats(v, Math.max(1, Math.round(u.count * 0.03)), u); return; }
      let cap = v.sp.ratCap || 10;
      if (v.sp.flying) cap = v.alt < 0.35 ? 3 : 0;
      const bites = Math.min(u.count, Math.max(0, Math.floor(cap - v.ratLoad)));
      if (bites <= 0) return;
      v.ratLoad += bites;
      const dmg = bites * armorDmg(u.sp.dmg, v) * (0.7 + R() * 0.6);
      hurt(v, dmg, u);
    }

    // Line of fire: the first sizeable body between shooter and target, if any.
    function firstBlocker(s, tg) {
      const dx = tg.x - s.x, dy = tg.y - s.y, L2 = dx * dx + dy * dy || 1;
      let best = null, bt = 1;
      for (const v of units) {
        if (!v.alive || v === s || v === tg || v.sp.swarm || airborne(v) || v.r < 0.35) continue;
        const tt = ((v.x - s.x) * dx + (v.y - s.y) * dy) / L2;
        if (tt <= 0 || tt >= bt) continue;
        const cx = s.x + dx * tt - v.x, cy = s.y + dy * tt - v.y;
        const rr = v.r * 0.85;
        if (cx * cx + cy * cy < rr * rr) { best = v; bt = tt; }
      }
      return best;
    }
    function fire(h, target, blocker) {
      const sp = h.sp;
      const victim = blocker || target;
      const d = dist(h, victim);
      let p;
      if (blocker) p = 0.85;
      else {
        p = sp.accuracy * Math.max(0.15, 1 - d / 250);
        if (target.moving > 5) p *= 0.6;
        if (target.sp.flying) p *= 0.3;
        if (target.sp.amphibious && inPond(target)) p *= 0.5;
        if (target.sp.swarm) p = 0.9;
      }
      if (h.stunT > 0) p *= 0.4;
      h.mag--; h.ammo--; h.cd = sp.bolt; h.aimT = 0;
      stats.shots++;
      const hit = R() < p;
      addFx({ type: 'shot', x1: h.x, y1: h.y, x2: victim.x + (hit ? 0 : (R() - 0.5) * 6), y2: victim.y + (hit ? 0 : (R() - 0.5) * 6), hit });
      if (hit) {
        if (victim.sp.swarm) killRats(victim, 1, h);
        else {
          const dmg = sp.rifleDmg * (0.7 + R() * 0.6) * (R() < 0.2 ? 2.5 : 1);
          hurt(victim, armorDmg(dmg, victim), h);
        }
      }
      if (h.ammo <= 0) event(`${label(h, true)} is out of ammunition.`, 'info', h.team);
    }

    // ---------- per-step shared state ----------
    let deter = 0, airDeter = 0;
    const threats = []; // attackers near you, for defender targeting
    let enemyHunterUp = false;

    function computeShared() {
      deter = 0; airDeter = 0;
      threats.length = 0;
      enemyHunterUp = !!(enemyHunter && enemyHunter.alive && enemyHunter.ammo > 0);
      for (const u of units) {
        if (!u.alive) continue;
        u.dP = dist(u, person);
        u.engagedBy = 0;
        u.ratLoad *= 0.82; // bites in roughly the last second
        if (u.team === 'def' && active(u) && u.dP < WORLD.guardZone) {
          const w = u.sp.swarm ? u.count : u.hp / u.maxHp;
          deter += u.sp.power * w;
          if (u.sp.flying || u.sp.ranged) airDeter += u.sp.power * w;
        }
        if (u.team === 'att' && u.dP < 35) threats.push(u);
      }
      for (const u of units) {
        if (u.alive && u.team === 'def' && u.target && u.target.alive) u.target.engagedBy++;
      }
    }

    // ---------- AI: you ----------
    function thinkPerson(u) {
      let ax = 0, ay = 0, wsum = 0;
      for (const v of units) {
        if (!v.alive || v.team !== 'def' || v.sp.flying || !active(v) || v.dP > 30) continue;
        const w = (v.sp.swarm ? 0.02 * v.count : 1) * (v.sp.power + 5);
        ax += v.x * w; ay += v.y * w; wsum += w;
      }
      let gx = u.x, gy = u.y;
      if (wsum > 0) { gx = ax / wsum; gy = ay / wsum; }
      // Keep a big body between you and an armed hunter.
      if (enemyHunterUp) {
        let shield = null, sr = 0;
        for (const v of units) {
          if (!v.alive || v.team !== 'def' || v.sp.flying || v.sp.swarm || !active(v) || v.dP > 10) continue;
          if (v.r > sr) { sr = v.r; shield = v; }
        }
        if (shield && shield.r >= 0.55) {
          const hx = shield.x - enemyHunter.x, hy = shield.y - enemyHunter.y, hd = hyp(hx, hy) || 1;
          gx = shield.x + (hx / hd) * (shield.r + u.r + 0.2);
          gy = shield.y + (hy / hd) * (shield.r + u.r + 0.2);
        }
      }
      // Get away from things that are coming for you.
      let rx = 0, ry = 0, threatened = false;
      forNear(u.x, u.y, 18, (v, d2) => {
        if (v.team !== 'att' || v.state === 'flee' || airborne(v)) return;
        const d = Math.sqrt(d2) || 0.1;
        const committed = v.target === u;
        if (!committed && d > 8) return;
        const w = Math.min(danger(v), 60) * (committed ? 1 : 0.3) / Math.max(1, d * d) * 4;
        rx += ((u.x - v.x) / d) * w; ry += ((u.y - v.y) / d) * w;
        if (committed && d < 10) threatened = true;
      });
      if (crocAttackers.length) {
        const pd = hyp(u.x - pond.x, u.y - pond.y);
        const lim = pond.r + 10;
        if (pd < lim) { rx += ((u.x - pond.x) / pd) * (lim - pd) * 0.6; ry += ((u.y - pond.y) / pd) * (lim - pd) * 0.6; }
      }
      const m = 6;
      if (u.x < m) rx += (m - u.x) * 0.5; if (u.x > WORLD.w - m) rx -= (u.x - WORLD.w + m) * 0.5;
      if (u.y < m) ry += (m - u.y) * 0.5; if (u.y > WORLD.h - m) ry -= (u.y - WORLD.h + m) * 0.5;
      const rl = hyp(rx, ry);
      if (rl > 0) { const k = Math.min(10, rl * 3) / rl; gx += rx * k; gy += ry * k; }
      u.gx = gx; u.gy = gy; u.sprint = threatened;
    }
    function actPerson(u) {
      const far = hyp(u.gx - u.x, u.gy - u.y) > 3;
      moveTo(u, u.gx, u.gy, speedFor(u, u.sprint || far), 0.3);
      // Fight back against whatever is on you.
      if (u.cd <= 0) {
        let foe = null, fd = 99;
        forNear(u.x, u.y, 3, (v, d2) => {
          if (v.team !== 'att' || airborne(v)) return;
          if (v.target === u && d2 < fd) { fd = d2; foe = v; }
        });
        if (foe) {
          u.target = foe;
          tryAttack(u, foe);
          u.target = null;
        }
      }
    }

    // ---------- AI: hawks ----------
    function thinkHawk(u) {
      const sp = u.sp;
      if (u.hp < u.fleeAt * u.maxHp && u.state !== 'flee') { startFlee(u, 120 + R() * 120); return; }
      if (u.state === 'flee' || u.state === 'feed') {
        if (u.timer <= 0) { u.state = 'soar'; u.alt = Math.max(u.alt, 0.5); }
        return;
      }
      if (u.state === 'dive') {
        if (!u.target || !u.target.alive || u.timer <= 0) { u.state = 'climb'; u.timer = 3; }
        return;
      }
      if (u.state === 'climb') { if (u.timer <= 0) u.state = 'soar'; return; }
      // soaring: choose whether to dive
      if (u.team === 'att') {
        u.cx = person.x + Math.cos(u.orbitA) * 6; u.cy = person.y + Math.sin(u.orbitA) * 6;
        const fear = airDeter / sp.courage;
        const p = sp.aggression * interest(u) / (1 + fear * fear) * RATE.dive;
        if (R() < p) { u.state = 'dive'; u.target = person; u.timer = 8; }
      } else {
        u.cx = person.x; u.cy = person.y;
        let tgt = null;
        if (u.role === 'flanker' && enemyHunterUp) tgt = enemyHunter;
        if (!tgt) {
          // prey first: rats near you
          let bd = 625;
          forNear(person.x, person.y, 25, (v, d2) => {
            if (v.team === 'att' && v.sp.swarm && d2 < bd) { bd = d2; tgt = v; }
          });
        }
        if (!tgt) {
          let bs = 0;
          for (const v of threats) {
            if (v.state === 'flee' || v.dP > 20) continue;
            const s = (v.sp.flying ? 3 : 1) * (v.target === person ? 2 : 1) / (1 + v.dP / 5);
            if (s > bs) { bs = s; tgt = v; }
          }
        }
        if (tgt && R() < 0.5) { u.state = 'dive'; u.target = tgt; u.timer = 8; }
      }
    }
    function actHawk(u) {
      const sp = u.sp;
      if (u.state === 'soar') {
        u.orbitA += dt * (sp.cruise / u.orbitR) * (u.id % 2 ? 1 : -1);
        const tx = u.cx + Math.cos(u.orbitA) * u.orbitR, ty = u.cy + Math.sin(u.orbitA) * u.orbitR;
        moveTo(u, tx, ty, sp.speed * 0.8, 0);
        u.alt = Math.min(1, u.alt + dt * 0.5);
      } else if (u.state === 'dive') {
        const v = u.target;
        if (!v || !v.alive) return;
        const d = moveTo(u, v.x, v.y, sp.speed, 0);
        u.alt = Math.max(0, Math.min(1, (d - 1) / 12));
        if (d <= sp.reach + u.r + v.r + 0.4) {
          // strike
          u.alt = 0;
          if (v.sp.swarm) {
            killRats(v, 1, u);
            if (R() < sp.feedChance) { u.state = 'feed'; u.timer = sp.feedTime * (0.6 + R() * 0.8); u.alt = 0; return; }
          } else if (R() < 0.7) {
            hurt(v, armorDmg(sp.dmg * (0.6 + R() * 0.8), v), u);
            v.stunT = 1.2;
          }
          u.state = 'climb'; u.timer = 3 + R() * 4;
          u.cx = u.x; u.cy = u.y;
        }
      } else if (u.state === 'climb') {
        moveAway(u, person.x, person.y, sp.cruise);
        u.alt = Math.min(1, u.alt + dt * 0.4);
      } else if (u.state === 'flee') {
        moveAway(u, person.x, person.y, sp.cruise);
        u.alt = Math.min(1, u.alt + dt * 0.4);
      } else if (u.state === 'feed') {
        u.alt = 0;
        u.moving = 0;
        if (u.lastHitT > t - 0.3) { u.state = 'climb'; u.timer = 4; }
      }
    }

    // ---------- AI: hunter ----------
    function thinkHunter(u) {
      const sp = u.sp;
      if (u.ammo <= 0) { thinkGround(u); return; }
      if (u.hp < u.fleeAt * u.maxHp && u.state !== 'flee') { startFlee(u, 60 + R() * 60); }
      if (u.state === 'flee') { if (u.timer <= 0) u.state = u.team === 'att' ? 'snipe' : 'guard'; }
      // Self-defence: something dangerous closing in.
      let threat = null, td = 22 * 22;
      forNear(u.x, u.y, 22, (v, d2) => {
        if (!isEnemy(u, v) || v === person || v.sp.swarm || airborne(v) || v.state === 'flee' || v.state === 'feed') return;
        if (v.target !== u && d2 > 64) return;
        if (d2 < td) { td = d2; threat = v; }
      });
      if (u.team === 'att') {
        if (threat) { u.target = threat; u.mode = 'defend'; return; }
        u.mode = 'snipe';
        u.target = person;
        u.wantFire = R() < sp.aggression * interest(u) * RATE.fire;
      } else {
        let tgt = threat;
        if (!tgt && enemyHunterUp && enemyHunter.dP < sp.range) tgt = enemyHunter;
        if (!tgt) {
          let bs = 0;
          for (const v of threats) {
            if (v.sp.swarm || v.state === 'flee' || v.state === 'feed') continue;
            if (airborne(v) && !(v.state === 'dive' && v.dP < 10)) continue;
            const s = danger(v) * (v.target === person ? 3 : 1) / (1 + v.dP / 8);
            if (v.dP > 30 && v.target !== person) continue;
            if (s > bs) { bs = s; tgt = v; }
          }
        }
        u.target = tgt;
        u.wantFire = true;
      }
    }
    function actHunter(u) {
      const sp = u.sp;
      if (u.ammo <= 0) { actGround(u); return; }
      if (u.state === 'flee') { moveAway(u, person.x, person.y, speedFor(u, true)); return; }
      if (u.mag <= 0) {
        u.reloadT += dt;
        if (u.reloadT >= sp.reload) { u.mag = Math.min(sp.magazine, u.ammo); u.reloadT = 0; }
      }
      const v = u.target;
      // Positioning
      if (u.team === 'att') {
        if (u.mode === 'defend' && v) {
          if (dist(u, v) < 5) moveAway(u, v.x, v.y, speedFor(u, true));
        } else {
          // keep 30-55 m from you, circle slowly for a clear shot
          const d = u.dP;
          if (d > 55) moveTo(u, person.x, person.y, sp.cruise, 0);
          else if (d < 30) moveAway(u, person.x, person.y, sp.cruise);
          else if (u.blockedT > 2) {
            const ax = -(person.y - u.y) / d, ay = (person.x - u.x) / d;
            const dir = (u.id + Math.floor(t / 20)) % 2 ? 1 : -1;
            moveTo(u, u.x + ax * 5 * dir, u.y + ay * 5 * dir, sp.cruise, 0);
          } else u.moving = 0;
        }
      } else {
        // stay just behind you
        const tx = v ? person.x - (v.x - person.x) / (v.dP || 1) * 1.6 : person.x + 1.5;
        const ty = v ? person.y - (v.y - person.y) / (v.dP || 1) * 1.6 : person.y + 1;
        if (u.blockedT > 1) moveTo(u, tx + (u.id % 2 ? 2 : -2), ty + 2, sp.cruise, 0);
        else moveTo(u, tx, ty, hyp(tx - u.x, ty - u.y) > 6 ? speedFor(u, true) : sp.cruise, 0.4);
      }
      if (!v || !v.alive) { u.aimT = 0; return; }
      if (u.moving < 1) u.aimT += dt; else u.aimT = Math.max(0, u.aimT - dt);
      const d = dist(u, v);
      if (d < u.r + v.r + sp.reach + 0.2 && u.mag <= 0) { tryAttack(u, v); return; }
      if (u.cd > 0 || u.mag <= 0 || d > sp.range || u.aimT < sp.aimTime || !u.wantFire) return;
      const blocker = firstBlocker(u, v);
      if (blocker) {
        const friendly = !isEnemy(u, blocker);
        if (friendly || (u.team === 'att' && v === person && u.blockedT < 25)) { u.blockedT += dt; return; }
      }
      u.blockedT = 0;
      fire(u, v, blocker);
    }

    // ---------- AI: rats ----------
    function thinkRat(u) {
      const sp = u.sp;
      if (u.state === 'flee') { if (u.timer <= 0) u.state = u.team === 'att' ? 'lurk' : 'guard'; return; }
      if (u.state === 'feed') {
        if (u.timer <= 0 || !u.corpse || u.corpse.meat <= 0) u.state = u.team === 'att' ? 'lurk' : 'guard';
        else if (u.lastHitT > t - 1 && u.lastHitBy && u.lastHitBy.alive && R() < sp.retaliate) { u.state = 'swarm'; u.target = u.lastHitBy; }
        return;
      }
      // Fresh meat is very distracting.
      if (sp.feedChance > 0 && R() < sp.feedChance * 0.25) {
        const c = nearestCorpse(u, u.team === 'att' ? 20 : 8, true);
        if (c) { startFeed(u, c, sp.feedTime * (0.5 + R())); return; }
      }
      if (u.team === 'att') {
        if (u.state === 'lurk') {
          if (R() < sp.aggression * interest(u) * RATE.swarm) { u.state = 'swarm'; u.target = person; u.chargeT = 0; }
          return;
        }
        // swarming: go for the nearest enemy close by, else you
        if (u.chargeT > 60 && R() > interest(u)) { u.state = 'lurk'; u.target = null; return; }
        let best = null, bd = 8 * 8;
        forNear(u.x, u.y, 8, (v, d2) => {
          if (v.team === 'att' || airborne(v)) return;
          if (v.sp.swarm) d2 *= 4;
          if (d2 < bd) { bd = d2; best = v; }
        });
        u.target = best || person;
      } else {
        if (u.role === 'flanker' && enemyHunterUp) { u.state = 'swarm'; u.target = enemyHunter; return; }
        let best = null, bd = 1e9;
        forNear(person.x, person.y, 16, (v, d2) => {
          if (v.team !== 'att' || airborne(v) || v.state === 'flee') return;
          const dm = hyp(v.x - u.x, v.y - u.y);
          const s = dm + Math.sqrt(d2) * 0.5;
          if (s < bd) { bd = s; best = v; }
        });
        if (best) { u.state = 'swarm'; u.target = best; } else { u.state = 'guard'; u.target = null; }
      }
    }
    function actRat(u) {
      const sp = u.sp;
      if (u.state === 'flee') {
        // rats bolt for the walls
        const wx = u.x < WORLD.w / 2 ? 0 : WORLD.w, wy = u.y < WORLD.h / 2 ? 0 : WORLD.h;
        if (Math.abs(u.x - wx) < Math.abs(u.y - wy)) moveTo(u, wx, u.y + (R() - 0.5) * 4, sp.speed, 1.5);
        else moveTo(u, u.x + (R() - 0.5) * 4, wy, sp.speed, 1.5);
        return;
      }
      if (u.state === 'feed') {
        const c = u.corpse;
        moveTo(u, c.x, c.y, sp.cruise, 0.5);
        c.meat -= u.count * 0.004 * dt;
        return;
      }
      if (u.state === 'lurk') {
        // hug the walls and drift along them
        const dl = u.x, dr = WORLD.w - u.x, dtp = u.y, db = WORLD.h - u.y;
        const m = Math.min(dl, dr, dtp, db);
        u.orbitA += dt * 0.05;
        const drift = Math.sin(u.orbitA + u.id) * 3;
        if (m === dl) moveTo(u, 2, u.y + drift, sp.cruise, 0);
        else if (m === dr) moveTo(u, WORLD.w - 2, u.y + drift, sp.cruise, 0);
        else if (m === dtp) moveTo(u, u.x + drift, 2, sp.cruise, 0);
        else moveTo(u, u.x + drift, WORLD.h - 2, sp.cruise, 0);
        return;
      }
      if (u.state === 'guard') {
        moveTo(u, person.x + Math.cos(u.ga) * u.gr, person.y + Math.sin(u.ga) * u.gr, u.dP > 14 ? sp.speed : sp.cruise, 0.5);
        return;
      }
      const v = u.target;
      if (!v || !v.alive) { u.state = u.team === 'att' ? 'swarm' : 'guard'; u.target = u.team === 'att' ? person : null; return; }
      u.chargeT += dt;
      if (!tryAttack(u, v)) moveTo(u, v.x, v.y, sp.speed, 0);
      else u.moving = 0;
    }

    // ---------- AI: everything else on the ground ----------
    function thinkGround(u) {
      const sp = u.sp;
      if (u.hp < u.fleeAt * u.maxHp && u.state !== 'flee') { startFlee(u, u.team === 'att' ? 120 + R() * 120 : 20 + R() * 40); return; }
      if (u.state === 'flee') { if (u.timer <= 0) u.state = u.team === 'att' ? 'stalk' : 'guard'; return; }
      if (u.state === 'feed') {
        const hitBy = u.lastHitT > t - 1.5 ? u.lastHitBy : null;
        if (hitBy && hitBy.alive && !hitBy.sp.swarm && R() < sp.retaliate) { u.state = 'fight'; u.target = hitBy; return; }
        if (u.timer <= 0 || !u.corpse || u.corpse.meat <= 0) { u.state = u.team === 'att' ? 'stalk' : 'guard'; u.corpse = null; }
        return;
      }
      const hitBy = u.lastHitT > t - 2 ? u.lastHitBy : null;
      if (u.team === 'att') {
        // Retaliate against whatever just hurt us.
        if (hitBy && hitBy.alive && hitBy !== person && u.target !== hitBy && !airborne(hitBy) && R() < sp.retaliate) {
          u.state = 'fight'; u.target = hitBy; return;
        }
        if (u.state === 'fight' || u.state === 'charge') {
          const v = u.target;
          if (!v || !v.alive) {
            u.state = 'stalk'; u.target = null;
            return;
          }
          if (u.state === 'charge' && u.chargeT > 25) { u.state = 'stalk'; u.target = null; return; }
          if (u.state === 'fight' && v !== person && u.chargeT > 40 && dist(u, v) > 6) { u.state = 'stalk'; u.target = null; return; }
          return;
        }
        // stalking
        if (sp.feedChance > 0 && sp.eats === 'meat' && R() < sp.feedChance * 0.1) {
          const c = nearestCorpse(u, 25, false);
          if (c) { startFeed(u, c, sp.feedTime * (0.5 + R())); return; }
        }
        const fear = deter / sp.courage;
        let p = sp.aggression * interest(u) / (1 + fear * fear) * RATE.commit;
        if (sp.amphibious) {
          const pd = hyp(person.x - pond.x, person.y - pond.y) - pond.r;
          p *= pd < 6 ? 4 : 0.25;
        }
        if (R() < p) { u.state = 'charge'; u.target = person; u.chargeT = 0; }
      } else {
        // defender
        let tgt = null;
        if (u.role === 'flanker' && enemyHunterUp && enemyHunter.dP < 90) tgt = enemyHunter;
        if (!tgt && hitBy && hitBy.alive && !airborne(hitBy) && dist(u, hitBy) < 5 && R() < sp.retaliate) tgt = hitBy;
        if (!tgt) {
          let bs = 0;
          for (const v of threats) {
            if (v.state === 'flee' && v.dP > 6) continue;
            if (v.state === 'feed' && v.dP > 10) continue;
            if (airborne(v) && !(v.state === 'dive' && sp.antiAir >= 0.2 && dist(u, v) < 4)) continue;
            // Bodyguards don't pick fights: only things that are coming for you,
            // got too close, or are mauling another guard.
            const committed = v.target === person;
            const onGuard = v.target && v.target.team === 'def' && v.dP < 14;
            if (!(committed && v.dP < 25) && v.dP > 7 && !onGuard) continue;
            if (v.sp.ranged) continue;
            const dm = dist(u, v);
            let s = danger(v) * (committed ? 2.5 : 1) / (1 + v.dP / 6) / (1 + dm / 12) / (1 + v.engagedBy * 0.8);
            if (v.sp.swarm) s *= v.dP < 4 ? 1.5 : 0.4;
            if (v === u.target) s *= 1.3;
            if (s > bs) { bs = s; tgt = v; }
          }
        }
        if (tgt) {
          if (u.target !== tgt) u.chargeT = 0;
          u.state = 'engage'; u.target = tgt;
        } else { u.state = 'guard'; u.target = null; }
      }
    }
    // Guards in the way body-block a charge: bigger guards stop it more often.
    // Checked every step so fast chargers can't slip between decisions.
    function checkBlock(u) {
      if (u.dP > 14) return;
      let blocker = null;
      forNear(u.x, u.y, u.r + 2.6, v2 => {
        if (v2.team === 'def' && !v2.sp.swarm && !airborne(v2) && active(v2) && v2 !== u.lastBlocker &&
          (!blocker || v2.sp.power > blocker.sp.power)) blocker = v2;
      });
      if (!blocker) return;
      u.lastBlocker = blocker;
      if (R() < blocker.sp.power / (blocker.sp.power + u.sp.power) * 1.6) {
        u.state = 'fight'; u.target = blocker; u.chargeT = 0;
        if (blocker.state !== 'engage' || !blocker.target || blocker.target.dP > u.dP) { blocker.state = 'engage'; blocker.target = u; }
        event(`${label(blocker, true)} blocked ${label(u)}.`, 'info', 'def');
      }
    }

    function actGround(u) {
      const sp = u.sp;
      if (u.state === 'flee') {
        let fx_ = person.x, fy_ = person.y;
        if (u.team === 'def' && u.lastHitBy && u.lastHitBy.alive) { fx_ = u.lastHitBy.x; fy_ = u.lastHitBy.y; }
        moveAway(u, fx_, fy_, speedFor(u, true));
        return;
      }
      if (u.state === 'feed') {
        const c = u.corpse;
        if (c) { moveTo(u, c.x, c.y, sp.cruise, u.r * 0.8); c.meat -= dt * 0.5; } else u.moving = 0;
        return;
      }
      if (u.state === 'guard') {
        let base = u.slot / u.slotN * Math.PI * 2;
        if (enemyHunterUp) base += Math.atan2(enemyHunter.y - person.y, enemyHunter.x - person.x);
        const rr = 1.6 + u.r + person.r + (u.slotN > 6 ? 2 : 0) + (u.slot >= 6 ? 2.5 : 0);
        const tx = person.x + Math.cos(base) * rr, ty = person.y + Math.sin(base) * rr;
        const d = hyp(tx - u.x, ty - u.y);
        moveTo(u, tx, ty, speedFor(u, d > 8), 0.3);
        return;
      }
      if (u.state === 'stalk') {
        if (sp.amphibious) {
          // lurk in the water on the side nearest you
          const a = Math.atan2(person.y - pond.y, person.x - pond.x) + Math.sin(t * 0.02 + u.id) * 0.6;
          const rr = pond.r - 1.5 - (u.id % 3);
          moveTo(u, pond.x + Math.cos(a) * rr, pond.y + Math.sin(a) * rr, speedFor(u, false), 0.5);
          return;
        }
        u.orbitA += dt * 0.04 * (u.id % 2 ? 1 : -1);
        const tx = person.x + Math.cos(u.orbitA) * u.orbitR, ty = person.y + Math.sin(u.orbitA) * u.orbitR;
        moveTo(u, tx, ty, sp.cruise, 0.5);
        return;
      }
      const v = u.target;
      if (!v || !v.alive) { u.moving = 0; return; }
      u.chargeT += dt;
      if (u.team === 'def' && u.state === 'engage' && v.dP > WORLD.leash && !(u.role === 'flanker' && v === enemyHunter)) {
        u.state = 'guard'; u.target = null; return;
      }
      if (u.state === 'charge') checkBlock(u);
      if (u.target !== v) return;
      if (!tryAttack(u, v)) {
        moveTo(u, v.x, v.y, speedFor(u, true), 0);
      } else u.moving = 0;
    }

    // ---------- step ----------
    function separate() {
      // Big bodies push each other apart. Rat clusters are left to pile up and
      // climb over things, which is also what rats do.
      for (const u of units) {
        if (!u.alive || u.sp.flying || u.sp.swarm) continue;
        forNear(u.x, u.y, u.r + 1.5, v => {
          if (v === u || v.id < u.id || v.sp.flying || v.sp.swarm) return;
          const dx = v.x - u.x, dy = v.y - u.y, d = hyp(dx, dy) || 0.01;
          const min = (u.r + v.r) * 0.95;
          if (d >= min) return;
          const push = (min - d) * 0.5;
          const mu = u.r * u.r, mv = v.r * v.r, tot = mu + mv;
          u.x -= (dx / d) * push * (mv / tot) * 2; u.y -= (dy / d) * push * (mv / tot) * 2;
          v.x += (dx / d) * push * (mu / tot) * 2; v.y += (dy / d) * push * (mu / tot) * 2;
        });
      }
    }
    function constrain(u) {
      if (!u.sp.flying && !u.sp.amphibious) {
        const dx = u.x - pond.x, dy = u.y - pond.y, d = hyp(dx, dy) || 0.01;
        const min = pond.r + u.r * 0.5;
        if (d < min) { u.x = pond.x + (dx / d) * min; u.y = pond.y + (dy / d) * min; }
      }
      clampPos(u);
    }

    function step() {
      if (done) return;
      t += dt;
      for (const u of units) { u.px = u.x; u.py = u.y; }
      buildGrid();
      computeShared();

      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (!u.alive) continue;
        u.cd -= dt; u.timer -= dt;
        if (u.stunT > 0) u.stunT -= dt;
        if (u.slowT > 0) u.slowT -= dt;
        if (!u.burst && u.stam < (u.sp.stamina || 10)) u.stam = Math.min(u.sp.stamina || 10, u.stam + dt * 0.35);
        u.burst = false;
        u.decideT -= dt;
        const sp = u.sp;
        if (u === person) {
          if (u.decideT <= 0) { u.decideT = 0.25; thinkPerson(u); }
          actPerson(u);
        } else if (sp.flying) {
          if (u.decideT <= 0) { u.decideT = 1; thinkHawk(u); }
          actHawk(u);
        } else if (sp.swarm) {
          if (u.decideT <= 0) { u.decideT = 1; thinkRat(u); }
          actRat(u);
        } else if (sp.ranged) {
          if (u.decideT <= 0) { u.decideT = 0.5; thinkHunter(u); }
          actHunter(u);
        } else {
          if (u.decideT <= 0) { u.decideT = 0.5; thinkGround(u); }
          actGround(u);
        }
        if (done) return;
        if (u.alive) constrain(u);
      }
      separate();
      for (const u of units) if (u.alive) constrain(u);

      if (t >= WORLD.duration - 1e-6) { finish(true, null); return; }
      let attackersLeft = false;
      for (const u of units) if (u.alive && u.team === 'att') { attackersLeft = true; break; }
      if (!attackersLeft) { event('Every attacker is dead.', 'info', 'def'); finish(true, null, true); }
    }

    function tally(team) {
      const out = {};
      for (const u of units) {
        if (u.team !== team) continue;
        const rec = out[u.key] || (out[u.key] = { alive: 0, total: 0 });
        rec.total += u.sp.swarm ? u.count0 : 1;
        if (u.alive) rec.alive += u.sp.swarm ? u.count : 1;
      }
      return out;
    }

    function finish(survived, killer, cleared) {
      done = true;
      result = {
        survived, seed, picks: picks.slice(), time: t, cleared: !!cleared,
        killedBy: killer ? killer.key : null,
        personHp: Math.max(0, person.hp),
        dmgBy: stats.dmgBy, kills: stats.kills,
        defenders: tally('def'), attackers: tally('att'),
        shots: stats.shots,
      };
      if (survived) event(cleared ? 'You survived: nothing is left to attack you.' : 'You survived the hour!', 'win', 'you');
    }

    return {
      step,
      get t() { return t; },
      get done() { return done; },
      get result() { return result; },
      units, corpses, fx, events, person, world: WORLD,
      tally,
    };
  }

  function runHeadless(config, picks, seed) {
    const sim = createSim(config, picks, seed, { fx: false });
    while (!sim.done) sim.step();
    return sim.result;
  }

  function allPairs() {
    const out = [];
    for (let i = 0; i < ORDER.length; i++) for (let j = i + 1; j < ORDER.length; j++) out.push([ORDER[i], ORDER[j]]);
    return out;
  }

  return { WORLD, ORDER, BASE, PERSON, FIELDS, HUNTER_FIELDS, PRESETS, defaultConfig, createSim, runHeadless, allPairs, mulberry32 };
}

if (typeof window !== 'undefined') window.Sim = SimCore();
if (typeof module !== 'undefined') module.exports = SimCore;
