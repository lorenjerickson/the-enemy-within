/**
 * Built-in animated effects for the map's Effects layer, drawn procedurally (no image or video files).
 * Each frame is a pure function of time, so nothing needs to be remembered between frames: particle i's
 * position comes from a hash of i and the current time. Effects have no hard edges: everything fades out
 * towards the edge of its area.
 */
export const EFFECT_KINDS = ["rain", "snow", "wind", "fog", "clouds", "fire", "lightning", "poison", "acid", "necrotic", "radiant", "psychic", "force", "oil"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EFFECT_LABELS: Record<EffectKind, string> = {
  rain: "Rain",
  snow: "Snow",
  wind: "Wind",
  fog: "Fog",
  clouds: "Clouds",
  fire: "Fire",
  lightning: "Lightning",
  poison: "Poison vapour",
  acid: "Acid pool",
  necrotic: "Necrotic gloom",
  radiant: "Radiant glow",
  psychic: "Psychic ripples",
  force: "Force shimmer",
  oil: "Oil sheen",
};

/** The colour an area of this look is tinted with (under its animation). */
export const LOOK_TINT: Partial<Record<EffectKind, string>> = {
  fire: "rgba(234,88,12,0.18)", poison: "rgba(101,163,13,0.2)", acid: "rgba(190,242,100,0.22)", necrotic: "rgba(46,16,101,0.3)",
  radiant: "rgba(253,224,71,0.16)", psychic: "rgba(236,72,153,0.14)", force: "rgba(96,165,250,0.14)", oil: "rgba(28,25,23,0.45)",
  snow: "rgba(186,230,253,0.18)", lightning: "rgba(165,180,252,0.14)",
};

/**
 * Where an effect is drawn, in scene pixels. A placed effect fades out in an oval inside its rectangle;
 * a whole-map effect fades out over a band along the scene's edges.
 */
export type EffectArea = { x: number; y: number; w: number; h: number; placed: boolean };

/** Deterministic pseudo-random number in [0, 1) for particle n. */
const rnd = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const mod = (a: number, m: number) => ((a % m) + m) % m;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How strongly something at (px, py) shows: 1 well inside the area, easing to 0 at its edge. */
function fader(area: EffectArea, cell: number) {
  const { x, y, w, h } = area;
  if (area.placed) {
    const cx = x + w / 2, cy = y + h / 2;
    return (px: number, py: number) => {
      const d = Math.hypot((px - cx) / (w / 2), (py - cy) / (h / 2)); // 0 at the centre, 1 on the oval
      return clamp01((1 - d) / 0.45);
    };
  }
  const band = cell * 1.5;
  return (px: number, py: number) => clamp01(Math.min(px - x, x + w - px, py - y, y + h - py) / band);
}

/** Draws one effect at time t (seconds). `cell` is a grid cell in pixels, so whole-map particles scale with the map. */
export function drawEffect(ctx: CanvasRenderingContext2D, kind: EffectKind, area: EffectArea, intensity: number, t: number, cell: number) {
  const { x, y, w, h } = area;
  if (w <= 0 || h <= 0) return;
  const k = clamp01(intensity);
  // A placed effect is sized to its area (a fire fills it whatever the grid size); a whole-map one to the grid.
  const unit = area.placed ? Math.min(w, h) / 4 : cell;
  // Particle counts scale with intensity, and for the whole map with the area covered (relative to a 1408×792 scene).
  const density = area.placed ? 0.6 : Math.max(0.05, (w * h) / (1408 * 792));
  const count = (base: number, extra: number) => Math.round((base + extra * k) * density);
  const fade = fader(area, cell);
  ctx.save();
  // Whole-map effects stay within the scene (big puffs would otherwise spill past it); they already fade out before its edge.
  if (!area.placed) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }

  if (kind === "rain") {
    ctx.strokeStyle = `rgba(190,210,255,${0.35 + 0.3 * k})`;
    ctx.lineWidth = Math.max(1, unit * 0.025);
    const len = unit * 0.45;
    for (let i = 0; i < count(80, 420); i++) {
      const speed = h * (1.1 + 0.6 * rnd(i + 0.3));
      const px = x + rnd(i) * (w + len) - len * 0.2;
      const py = y + mod(rnd(i + 0.7) * h + t * speed, h + len);
      const a = fade(px, py - len / 2);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - len * 0.2, py - len);
      ctx.stroke();
    }
  } else if (kind === "snow") {
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.3 * k})`;
    for (let i = 0; i < count(60, 300); i++) {
      const speed = unit * (0.4 + 0.5 * rnd(i + 0.3));
      const py = y + mod(rnd(i + 0.7) * h + t * speed, h);
      const px = x + mod(rnd(i) * w + Math.sin(t * 0.8 + i) * unit * 0.35, w);
      const a = fade(px, py);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(px, py, unit * (0.03 + 0.05 * rnd(i + 0.9)), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "wind") {
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, unit * 0.03);
    for (let i = 0; i < count(12, 50); i++) {
      const speed = w * (0.35 + 0.3 * rnd(i + 0.3));
      const len = unit * (1.2 + rnd(i + 0.5) * 1.5);
      const px = x + mod(rnd(i) * w + t * speed, w + 2 * len) - len;
      const py = y + rnd(i + 0.7) * h + Math.sin(t * 1.5 + i) * unit * 0.2;
      const gust = Math.sin(mod(t * 0.7 + rnd(i + 0.1), 1) * Math.PI); // gusts come and go
      const a = fade(px + len / 2, py) * gust;
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(230,240,255,${(0.12 + 0.25 * k) * a})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + len / 2, py - unit * 0.25, px + len, py);
      ctx.stroke();
    }
  } else if (kind === "poison" || kind === "necrotic") {
    // Vapour: low puffs drifting (poison a sickly green, rising a little; necrotic dark violet, sinking).
    const [r0, g0, b0] = kind === "poison" ? [132, 204, 22] : [59, 7, 100];
    if (kind === "necrotic") ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < count(12, 28); i++) {
      const r = unit * (1.2 + 1.6 * rnd(i + 0.5));
      const drift = (kind === "poison" ? -1 : 1) * mod(t * unit * 0.12 + rnd(i + 0.9) * h, h);
      const px = x + mod(rnd(i) * w + t * unit * (0.1 + 0.15 * rnd(i + 0.3)), w + 2 * r) - r;
      const py = y + mod(rnd(i + 0.7) * h + drift, h);
      const f = (0.18 + 0.22 * k) * fade(px, py);
      if (f <= 0) continue;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${r0},${g0},${b0},${f})`);
      g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
    }
  } else if (kind === "acid" || kind === "oil") {
    // A pool: bubbles that swell and pop (acid hissing yellow-green; oil slow, dark, with a rainbow glint).
    const life = kind === "acid" ? 1.2 : 3.5;
    for (let i = 0; i < count(25, 60); i++) {
      const phase = mod(t / life + rnd(i + 0.2), 1);
      const px = x + rnd(i) * w, py = y + rnd(i + 0.6) * h;
      const a = fade(px, py);
      if (a <= 0) continue;
      const r = unit * (0.05 + 0.18 * rnd(i + 0.4)) * phase + 1;
      ctx.strokeStyle = kind === "acid" ? `rgba(217,249,157,${0.7 * a * (1 - phase)})` : `hsla(${Math.round(mod(t * 40 + i * 37, 360))},70%,60%,${0.35 * a * (1 - phase)})`;
      ctx.lineWidth = Math.max(1, unit * 0.03);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === "radiant") {
    // Golden motes rising, twinkling.
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count(30, 90); i++) {
      const phase = mod(t / 2.5 + rnd(i), 1);
      const px = x + rnd(i + 0.3) * w + Math.sin(t * 2 + i) * unit * 0.1, py = y + h - phase * h;
      const a = fade(px, py) * Math.sin(phase * Math.PI) * (0.6 + 0.4 * Math.sin(t * 9 + i));
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(254,240,138,${0.8 * a})`;
      ctx.beginPath();
      ctx.arc(px, py, unit * 0.06 + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "psychic" || kind === "force") {
    // Rings spreading from the middle and fading (psychic pink and uneven; force blue and even).
    const cx = x + w / 2, cy = y + h / 2, n = 4;
    for (let i = 0; i < n; i++) {
      const phase = mod(t / 2.2 + i / n, 1);
      const wobble = kind === "psychic" ? 1 + 0.08 * Math.sin(t * 5 + i * 2) : 1;
      ctx.strokeStyle = kind === "psychic" ? `rgba(244,114,182,${0.6 * (1 - phase) * (0.5 + 0.5 * k)})` : `rgba(147,197,253,${0.55 * (1 - phase) * (0.5 + 0.5 * k)})`;
      ctx.lineWidth = Math.max(1.5, unit * 0.06);
      ctx.beginPath();
      ctx.ellipse(cx, cy, (w / 2) * phase * wobble, (h / 2) * phase, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === "fog" || kind === "clouds") {
    // Soft puffs: fog is many small, low, even ones; clouds are big, slow clusters with shape.
    const puffs: { px: number; py: number; r: number; a: number }[] = [];
    if (kind === "fog") {
      for (let i = 0; i < count(10, 30); i++) {
        const r = unit * (2 + 2.5 * rnd(i + 0.5));
        const px = x + mod(rnd(i) * w + t * unit * (0.15 + 0.2 * rnd(i + 0.3)), w + 2 * r) - r;
        const py = y + rnd(i + 0.7) * h + Math.sin(t * 0.2 + i) * unit * 0.5;
        puffs.push({ px, py, r, a: 0.1 + 0.18 * k });
      }
    } else {
      for (let c = 0; c < count(3, 7); c++) {
        const size = unit * (3 + 3 * rnd(c + 0.5));
        const cx = x + mod(rnd(c) * w + t * unit * (0.25 + 0.2 * rnd(c + 0.3)), w + 4 * size) - 2 * size;
        const cy = y + rnd(c + 0.7) * h + Math.sin(t * 0.15 + c) * unit * 0.3;
        for (let p = 0; p < 6; p++) {
          const n = c * 10 + p;
          puffs.push({
            px: cx + (rnd(n + 0.4) - 0.5) * size * 1.6,
            py: cy + (rnd(n + 0.6) - 0.5) * size * 0.6,
            r: size * (0.45 + 0.4 * rnd(n + 0.2)),
            a: 0.18 + 0.25 * k,
          });
        }
      }
    }
    for (const { px, py, r, a } of puffs) {
      const f = a * fade(px, py);
      if (f <= 0) continue;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(235,238,245,${f})`);
      g.addColorStop(0.6, `rgba(225,228,238,${f * 0.5})`);
      g.addColorStop(1, "rgba(225,228,238,0)");
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
    }
  } else if (kind === "fire") {
    // Seen from above: tongues of flame flicker in place all over the area, swelling and dying, hottest
    // (yellow-white) towards the middle and redder towards the edge, with a few embers drifting outward.
    ctx.globalCompositeOperation = "lighter";
    const cx = x + w / 2, cy = y + h / 2;
    for (let i = 0; i < count(40, 140) * (area.placed ? 1 : 0.5); i++) {
      const life = 0.5 + 0.6 * rnd(i + 0.8);
      const phase = mod(t / life + rnd(i), 1);
      const born = Math.floor(t / life + rnd(i)); // each life of a tongue appears somewhere new
      const px = x + rnd(i * 7 + born * 13.1) * w + Math.sin(t * 7 + i) * unit * 0.05;
      const py = y + rnd(i * 11 + born * 17.3 + 0.5) * h + Math.cos(t * 6 + i) * unit * 0.05;
      const a = fade(px, py) * Math.sin(phase * Math.PI);
      if (a <= 0) continue;
      const edge = Math.min(1, Math.hypot((px - cx) / (w / 2), (py - cy) / (h / 2))); // 0 middle, 1 edge
      const r = unit * (0.2 + 0.25 * k) * (0.6 + 0.6 * rnd(i + 0.4)) * Math.sin(phase * Math.PI) + 1;
      const gr = Math.round(230 - 160 * edge);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,${Math.min(255, gr + 25)},${Math.round(120 * (1 - edge))},${0.6 * a})`);
      g.addColorStop(0.5, `rgba(255,${gr},40,${0.35 * a})`);
      g.addColorStop(1, `rgba(220,${Math.round(gr * 0.4)},20,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
    }
    // Embers: small sparks leaving the middle in every direction, fading as they go.
    for (let i = 0; i < count(8, 30); i++) {
      const phase = mod(t / 1.6 + rnd(i + 0.15), 1);
      const ang = rnd(i + 0.35 + Math.floor(t / 1.6 + rnd(i + 0.15))) * Math.PI * 2;
      const dist = phase * 0.9;
      const px = cx + Math.cos(ang) * dist * w / 2, py = cy + Math.sin(ang) * dist * h / 2;
      const a = fade(px, py) * (1 - phase);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,${Math.round(200 - 120 * phase)},60,${0.8 * a})`;
      ctx.beginPath();
      ctx.arc(px, py, unit * 0.03 + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "lightning") {
    // A strike every few seconds (more often when stronger): a soft flash and a jagged bolt.
    const period = 7 - 5 * k;
    const cycle = Math.floor(t / period);
    const since = t - cycle * period;
    const cx = x + w / 2, cy = y + h / 2;
    if (since < 0.35) {
      // The flash is an oval glow over the area, brightest in the middle.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(w / 2, h / 2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const a = 0.55 * (1 - since / 0.35);
      g.addColorStop(0, `rgba(235,240,255,${a})`);
      g.addColorStop(0.6, `rgba(235,240,255,${a * 0.6})`);
      g.addColorStop(1, "rgba(235,240,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    if (since < 0.2) {
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.shadowColor = "rgba(170,190,255,0.9)";
      ctx.shadowBlur = unit * 0.4;
      ctx.lineWidth = Math.max(1.5, unit * 0.05);
      ctx.lineCap = "round";
      let px = x + w * (0.3 + 0.4 * rnd(cycle + 0.1));
      let py = y;
      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        const nx = px + (rnd(cycle * 31 + s) - 0.5) * unit * 1.2;
        const ny = y + (h * s) / steps;
        ctx.globalAlpha = fade((px + nx) / 2, (py + ny) / 2);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        px = nx;
        py = ny;
      }
    }
  }
  ctx.restore();
}
