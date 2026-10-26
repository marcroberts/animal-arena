/*
 * Canvas renderer for a live sim. Reads sim state, never writes it.
 * World units are metres; the camera maps them to CSS pixels.
 */
const Renderer = (() => {
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
  const GPM = 10; // ground texture pixels per metre

  // Drawn size (metres) per species; exaggerated a little so things read on screen.
  const DRAW_SIZE = { person: 1.9, hawk: 1.7, croc: 3.0, bear: 2.7, wolf: 1.7, hunter: 1.9, buffalo: 3.1, gorilla: 2.4, lion: 2.6 };
  const MIN_PX = { person: 24, hawk: 15, hunter: 20 };

  const COLORS = {
    def: '#4f9cf0',
    att: '#e66767',
    you: '#f2c14e',
    ratAtt: '#8a7b68',
    ratDef: '#8fb3e8',
  };

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, DPR = 1;
    let world = null;
    let fitScale = 10, zoom = 1, camX = 60, camY = 40;
    const sprites = new Map();
    let effects = [];
    let shake = 0;
    let clock = 0;
    let ground = null, decals = null, decalCtx = null;
    const ratOffsets = new Map();

    function sprite(emoji, px, variant) {
      px = Math.max(8, Math.round(px / 2) * 2);
      const key = emoji + '|' + px + '|' + (variant || '');
      let c = sprites.get(key);
      if (c) return c;
      c = document.createElement('canvas');
      const s = Math.ceil(px * 1.35);
      c.width = s; c.height = s;
      const g = c.getContext('2d');
      g.font = `${px}px ${EMOJI_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (variant === 'flip') { g.translate(s, 0); g.scale(-1, 1); }
      g.fillText(emoji, s / 2, s / 2 + px * 0.06);
      if (variant === 'gray') {
        g.globalCompositeOperation = 'saturation';
        g.fillStyle = '#808080';
        g.fillRect(0, 0, s, s);
        g.globalCompositeOperation = 'destination-in';
        g.font = `${px}px ${EMOJI_FONT}`;
        g.fillText(emoji, s / 2, s / 2 + px * 0.06);
      }
      sprites.set(key, c);
      if (sprites.size > 600) sprites.delete(sprites.keys().next().value);
      return c;
    }

    // Deterministic pseudo-random for decoration.
    function hash(n) {
      n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
      return (n >>> 0) / 4294967296;
    }

    function buildGround(w) {
      const gw = w.w * GPM, gh = w.h * GPM;
      ground = document.createElement('canvas');
      ground.width = gw; ground.height = gh;
      const g = ground.getContext('2d');
      // packed dirt
      const grad = g.createRadialGradient(gw / 2, gh / 2, 50, gw / 2, gh / 2, gw * 0.7);
      grad.addColorStop(0, '#7a6347');
      grad.addColorStop(1, '#5a4733');
      g.fillStyle = grad;
      g.fillRect(0, 0, gw, gh);
      for (let i = 0; i < 9000; i++) {
        const x = hash(i * 3 + 1) * gw, y = hash(i * 3 + 2) * gh, r = 0.6 + hash(i * 3 + 3) * 2.2;
        g.fillStyle = hash(i * 7) < 0.5 ? 'rgba(40,28,16,0.18)' : 'rgba(200,170,120,0.10)';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      // darker, trampled patches
      for (let i = 0; i < 40; i++) {
        const x = hash(i + 900) * gw, y = hash(i + 950) * gh, r = 30 + hash(i + 990) * 90;
        const pg = g.createRadialGradient(x, y, 0, x, y, r);
        pg.addColorStop(0, 'rgba(45,32,20,0.16)');
        pg.addColorStop(1, 'rgba(45,32,20,0)');
        g.fillStyle = pg;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // pond
      const p = w.pond;
      const px = p.x * GPM, py = p.y * GPM, pr = p.r * GPM;
      g.fillStyle = 'rgba(52,44,30,0.6)';
      g.beginPath(); g.arc(px, py, pr + 14, 0, Math.PI * 2); g.fill();
      const pg = g.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#2f6f7a');
      pg.addColorStop(0.7, '#1f4e5e');
      pg.addColorStop(1, '#173a45');
      g.fillStyle = pg;
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(160,200,190,0.25)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(px, py, pr - 2, 0, Math.PI * 2); g.stroke();
      // reeds
      g.font = `${Math.round(1.6 * GPM)}px ${EMOJI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i < 14; i++) {
        const a = hash(i + 300) * Math.PI * 2, rr = pr + 6 + hash(i + 400) * 10;
        g.globalAlpha = 0.8;
        g.fillText('🌾', px + Math.cos(a) * rr, py + Math.sin(a) * rr);
      }
      g.globalAlpha = 1;
      // a few rocks
      for (let i = 0; i < 10; i++) {
        const x = hash(i + 500) * gw, y = hash(i + 600) * gh;
        g.fillStyle = 'rgba(90,82,70,0.8)';
        g.beginPath(); g.ellipse(x, y, 6 + hash(i + 700) * 10, 4 + hash(i + 800) * 6, hash(i) * 3, 0, Math.PI * 2); g.fill();
      }
      decals = document.createElement('canvas');
      decals.width = gw; decals.height = gh;
      decalCtx = decals.getContext('2d');
    }

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      if (world) fitScale = Math.min(W / (world.w + 6), H / (world.h + 6));
    }

    function reset(sim) {
      world = sim.world;
      if (!ground) buildGround(world);
      decalCtx.clearRect(0, 0, decals.width, decals.height);
      effects = [];
      ratOffsets.clear();
      zoom = 1; camX = world.w / 2; camY = world.h / 2;
      resize();
    }

    const scale = () => fitScale * zoom;
    function toScreen(x, y) {
      const s = scale();
      return [(x - camX) * s + W / 2, (y - camY) * s + H / 2];
    }
    function toWorld(sx, sy) {
      const s = scale();
      return [(sx - W / 2) / s + camX, (sy - H / 2) / s + camY];
    }
    function zoomAt(sx, sy, factor) {
      const [wx, wy] = toWorld(sx, sy);
      zoom = Math.min(6, Math.max(1, zoom * factor));
      const s = scale();
      camX = wx - (sx - W / 2) / s; camY = wy - (sy - H / 2) / s;
      clampCam();
    }
    function panBy(dx, dy) {
      const s = scale();
      camX -= dx / s; camY -= dy / s;
      clampCam();
    }
    function clampCam() {
      if (!world) return;
      if (zoom <= 1.001) { camX = world.w / 2; camY = world.h / 2; return; }
      camX = Math.min(world.w, Math.max(0, camX));
      camY = Math.min(world.h, Math.max(0, camY));
    }
    function resetView() { zoom = 1; clampCam(); }

    function splat(x, y, size, color) {
      if (!decalCtx) return;
      decalCtx.fillStyle = color;
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * size * 0.8;
        decalCtx.beginPath();
        decalCtx.arc((x + Math.cos(a) * d) * GPM, (y + Math.sin(a) * d) * GPM, (0.15 + Math.random() * size * 0.35) * GPM, 0, Math.PI * 2);
        decalCtx.fill();
      }
    }

    function ingest(sim) {
      const list = sim.fx;
      for (const f of list) {
        if (f.type === 'shot') {
          effects.push({ type: 'shot', x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, hit: f.hit, life: 0.35, max: 0.35 });
          effects.push({ type: 'flash', x: f.x1, y: f.y1, life: 0.12, max: 0.12 });
        } else if (f.type === 'hit') {
          if (effects.length < 500) effects.push({ type: 'hit', x: f.x, y: f.y, big: f.big, life: f.big ? 0.5 : 0.3, max: f.big ? 0.5 : 0.3, seed: Math.random() * 1000 });
          if (f.big) splat(f.x, f.y, 0.9, 'rgba(110,10,10,0.35)');
          if (f.you) shake = Math.min(1, shake + (f.big ? 0.8 : 0.25));
        } else if (f.type === 'ratdie') {
          splat(f.x, f.y, 0.4, 'rgba(50,30,25,0.25)');
        }
      }
      list.length = 0;
      if (effects.length > 800) effects.splice(0, effects.length - 800);
    }

    function stateBadge(u) {
      if (u.state === 'feed') return '🍖';
      if (u.state === 'flee') return '💨';
      if (u.sp.ranged && u.mag <= 0 && u.ammo > 0) return '🔄';
      return null;
    }

    function drawRatCluster(u, alpha, s) {
      let offs = ratOffsets.get(u.id);
      if (!offs) {
        offs = new Float32Array(u.count0 * 3);
        for (let i = 0; i < u.count0; i++) {
          const a = hash(u.id * 977 + i * 3) * Math.PI * 2, r = Math.sqrt(hash(u.id * 977 + i * 3 + 1));
          offs[i * 3] = Math.cos(a) * r; offs[i * 3 + 1] = Math.sin(a) * r; offs[i * 3 + 2] = hash(u.id * 31 + i) * 6.28;
        }
        ratOffsets.set(u.id, offs);
      }
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      const [sx, sy] = toScreen(x, y);
      const rr = u.r * s * 1.15;
      if (sx < -rr - 10 || sy < -rr - 10 || sx > W + rr + 10 || sy > H + rr + 10) return;
      const dot = Math.max(1.6, 0.16 * s);
      const wig = u.moving > 0.2 ? 0.35 : 0.12;
      ctx.fillStyle = u.team === 'def' ? COLORS.ratDef : COLORS.ratAtt;
      for (let i = 0; i < u.count; i++) {
        const ph = offs[i * 3 + 2] + clock * 9;
        const ox = offs[i * 3] * rr + Math.sin(ph) * wig * dot * 2;
        const oy = offs[i * 3 + 1] * rr + Math.cos(ph * 1.3) * wig * dot * 2;
        ctx.fillRect(sx + ox - dot / 2, sy + oy - dot / 2, dot * 1.4, dot);
      }
    }

    function drawUnit(u, alpha, s, hovered) {
      const key = u.key;
      const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
      let [sx, sy] = toScreen(x, y);
      const size = Math.max(MIN_PX[key] || 16, (DRAW_SIZE[key] || 2) * s);
      if (sx < -size || sy < -size * 2 || sx > W + size || sy > H + size) return;
      const flying = u.sp.flying;
      const alt = flying ? u.alt : 0;
      const lift = alt * 2.2 * s;
      const bob = u.moving > 0.5 ? Math.sin(clock * 14 + u.id) * size * 0.04 : 0;
      const submerged = u.sp.amphibious && Math.hypot(u.x - world.pond.x, u.y - world.pond.y) < world.pond.r - 0.3;

      // shadow
      ctx.fillStyle = flying ? `rgba(0,0,0,${0.35 - alt * 0.2})` : 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + size * 0.32, size * (flying ? 0.25 : 0.42), size * (flying ? 0.1 : 0.16), 0, 0, Math.PI * 2);
      ctx.fill();

      // team ring
      const col = u.team === 'you' ? COLORS.you : u.team === 'def' ? COLORS.def : COLORS.att;
      if ((!flying || alt < 0.5) && !submerged) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = u.team === 'att' ? 0.55 : 0.9;
        ctx.lineWidth = u.team === 'you' ? 2.5 : 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy + size * 0.32, size * 0.5, size * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (u.team === 'you') {
        const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
        ctx.strokeStyle = `rgba(242,193,78,${0.25 + pulse * 0.25})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, size * (0.9 + pulse * 0.15), 0, Math.PI * 2); ctx.stroke();
      }

      const variant = u.face > 0 && key !== 'person' && key !== 'hunter' ? 'flip' : '';
      const img = sprite(u.sp.emoji, size, variant);
      ctx.globalAlpha = submerged ? 0.5 : 1;
      if (flying && u.team === 'def') {
        ctx.fillStyle = 'rgba(79,156,240,0.28)';
        ctx.beginPath(); ctx.arc(sx, sy - lift, size * 0.55, 0, Math.PI * 2); ctx.fill();
      }
      ctx.drawImage(img, sx - img.width / 2, sy - img.height / 2 - lift + bob - size * 0.05);
      ctx.globalAlpha = 1;
      if (submerged && u.moving > 0.3) {
        const rp = (clock * 0.8 + u.id * 0.37) % 1;
        ctx.strokeStyle = `rgba(200,230,230,${0.3 * (1 - rp)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(sx, sy + size * 0.1, size * (0.4 + rp * 0.4), size * (0.15 + rp * 0.15), 0, 0, Math.PI * 2); ctx.stroke();
      }

      // health bar
      if (u.team !== 'you' && u.hp < u.maxHp && !u.sp.swarm) {
        const bw = Math.max(16, size * 0.8), bh = 3;
        const bx = sx - bw / 2, by = sy - size * 0.62 - lift;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = u.team === 'def' ? COLORS.def : COLORS.att;
        ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), bh);
      }
      const badge = stateBadge(u);
      if (badge) {
        const b = sprite(badge, Math.max(12, size * 0.42), '');
        ctx.drawImage(b, sx + size * 0.28, sy - size * 0.75 - lift);
      }
      if (hovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(sx, sy - lift, size * 0.7, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function draw(sim, alpha, realDt, hoverId) {
      clock += realDt;
      ingest(sim);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#0d0c0b';
      ctx.fillRect(0, 0, W, H);

      shake = Math.max(0, shake - realDt * 2.5);
      const shx = shake > 0 ? (Math.random() - 0.5) * shake * 8 : 0;
      const shy = shake > 0 ? (Math.random() - 0.5) * shake * 8 : 0;
      ctx.save();
      ctx.translate(shx, shy);

      const s = scale();
      const [gx, gy] = toScreen(0, 0);
      const gw = world.w * s, gh = world.h * s;
      // arena wall
      ctx.fillStyle = '#2b2620';
      const wall = Math.max(6, 1.6 * s);
      ctx.fillRect(gx - wall, gy - wall, gw + wall * 2, gh + wall * 2);
      ctx.strokeStyle = '#4a4137';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx - wall, gy - wall, gw + wall * 2, gh + wall * 2);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ground, gx, gy, gw, gh);
      ctx.drawImage(decals, gx, gy, gw, gh);

      // pond ripples
      const p = world.pond;
      const [px, py] = toScreen(p.x, p.y);
      ctx.strokeStyle = 'rgba(190,225,225,0.12)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const ph = ((clock * 0.15 + i / 3) % 1);
        ctx.beginPath(); ctx.arc(px + Math.sin(i * 2) * p.r * 0.3 * s, py + Math.cos(i * 3) * p.r * 0.3 * s, ph * p.r * 0.6 * s, 0, Math.PI * 2); ctx.stroke();
      }

      // corpses
      for (const c of sim.corpses) {
        const [cx, cy] = toScreen(c.x, c.y);
        const size = Math.max(MIN_PX[c.key] || 14, (DRAW_SIZE[c.key] || 2) * s * 0.9);
        const img = sprite(c.emoji, size, 'gray');
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((c.face > 0 ? 1 : -1) * Math.PI / 2);
        ctx.globalAlpha = c.meat > 0 ? 0.75 : 0.35;
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // rats on the ground
      for (const u of sim.units) if (u.alive && u.sp.swarm) drawRatCluster(u, alpha, s);

      // ground units, back to front
      const ground_ = [], air = [];
      for (const u of sim.units) {
        if (!u.alive || u.sp.swarm) continue;
        if (u.sp.flying && u.alt > 0.05) air.push(u); else ground_.push(u);
      }
      if (!sim.person.alive) ground_.push(sim.person);
      ground_.sort((a, b) => a.y - b.y);
      for (const u of ground_) drawUnit(u, alpha, s, u.id === hoverId);

      // shots and hits
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.life -= realDt;
        if (e.life <= 0) { effects.splice(i, 1); continue; }
        const k = e.life / e.max;
        if (e.type === 'shot') {
          const [x1, y1] = toScreen(e.x1, e.y1), [x2, y2] = toScreen(e.x2, e.y2);
          ctx.strokeStyle = `rgba(255,236,170,${k * 0.9})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        } else if (e.type === 'flash') {
          const [x, y] = toScreen(e.x, e.y);
          ctx.fillStyle = `rgba(255,220,120,${k})`;
          ctx.beginPath(); ctx.arc(x, y, 6 + (1 - k) * 8, 0, Math.PI * 2); ctx.fill();
        } else if (e.type === 'hit') {
          const [x, y] = toScreen(e.x, e.y);
          const n = e.big ? 9 : 4;
          ctx.fillStyle = `rgba(200,30,30,${k})`;
          for (let j = 0; j < n; j++) {
            const a = hash(Math.floor(e.seed) + j) * Math.PI * 2;
            const d = (1 - k) * (e.big ? 1.6 : 0.9) * s;
            ctx.fillRect(x + Math.cos(a) * d - 1.5, y + Math.sin(a) * d - 1.5, 3, 3);
          }
        }
      }

      for (const u of air) drawUnit(u, alpha, s, u.id === hoverId);
      ctx.restore();
    }

    // Unit nearest a screen point, for hover tooltips.
    function pick(sim, sx, sy) {
      if (!world) return null;
      const s = scale();
      let best = null, bd = Infinity;
      for (const u of sim.units) {
        if (!u.alive && u !== sim.person) continue;
        const lift = u.sp.flying ? u.alt * 2.2 * s : 0;
        const [ux, uy] = toScreen(u.x, u.y);
        const size = u.sp.swarm ? u.r * s * 1.2 : Math.max(MIN_PX[u.key] || 16, (DRAW_SIZE[u.key] || 2) * s) * 0.6;
        const d = Math.hypot(ux - sx, uy - lift - sy);
        if (d < size && d < bd) { bd = d; best = u; }
      }
      return best;
    }

    return { resize, reset, draw, pick, zoomAt, panBy, resetView, get zoom() { return zoom; } };
  }

  return { create, COLORS };
})();
