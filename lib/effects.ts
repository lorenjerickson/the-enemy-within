/**
 * Built-in animated effects for the map's Effects layer, drawn procedurally (no image or video files).
 * Each frame is a pure function of time, so nothing needs to be remembered between frames: particle i's
 * position comes from a hash of i and the current time.
 */
export const EFFECT_KINDS = ["rain", "snow", "wind", "fog", "clouds", "fire", "lightning"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EFFECT_LABELS: Record<EffectKind, string> = {
  rain: "Rain",
  snow: "Snow",
  wind: "Wind",
  fog: "Fog",
  clouds: "Clouds",
  fire: "Fire",
  lightning: "Lightning",
};

/** Where an effect is drawn, in scene pixels: a rectangle (whole map) or a circle (placed effect). */
export type EffectArea = { x: number; y: number; w: number; h: number; circle: boolean };

/** Deterministic pseudo-random number in [0, 1) for particle n. */
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Draws one effect at time t (seconds). `unit` is a grid cell in pixels, so particles scale with the map. */
export function drawEffect(ctx: CanvasRenderingContext2D, kind: EffectKind, area: EffectArea, intensity: number, t: number, cell: number) {
  const { x, y, w, h } = area;
  const k = Math.max(0, Math.min(1, intensity));
  // A placed effect is sized to its circle (a fire fills it whatever the grid size); a whole-map one to the grid.
  const unit = area.circle ? Math.min(w, h) / 4 : cell;
  // Particle counts scale with intensity, and for the whole map with the area covered (relative to a 1408×792 scene).
  const density = area.circle ? 0.6 : Math.max(0.05, (w * h) / (1408 * 792));
  const count = (base: number, extra: number) => Math.round((base + extra * k) * density);
  ctx.save();
  ctx.beginPath();
  if (area.circle) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.rect(x, y, w, h);
  ctx.clip();

  if (kind === "rain") {
    ctx.strokeStyle = `rgba(190,210,255,${0.35 + 0.3 * k})`;
    ctx.lineWidth = Math.max(1, unit * 0.025);
    ctx.beginPath();
    const len = unit * 0.45;
    for (let i = 0; i < count(80, 420); i++) {
      const speed = h * (1.1 + 0.6 * rnd(i + 0.3));
      const px = x + rnd(i) * (w + len) - len * 0.2;
      const py = y + mod(rnd(i + 0.7) * h + t * speed, h + len);
      ctx.moveTo(px, py);
      ctx.lineTo(px - len * 0.2, py - len);
    }
    ctx.stroke();
  } else if (kind === "snow") {
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.3 * k})`;
    for (let i = 0; i < count(60, 300); i++) {
      const speed = unit * (0.4 + 0.5 * rnd(i + 0.3));
      const py = y + mod(rnd(i + 0.7) * h + t * speed, h);
      const px = x + mod(rnd(i) * w + Math.sin(t * 0.8 + i) * unit * 0.35, w);
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
      const fade = Math.sin(mod(t * 0.7 + rnd(i + 0.1), 1) * Math.PI); // gusts come and go
      ctx.strokeStyle = `rgba(230,240,255,${(0.12 + 0.25 * k) * fade})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + len / 2, py - unit * 0.25, px + len, py);
      ctx.stroke();
    }
  } else if (kind === "fog") {
    for (let i = 0; i < count(10, 30); i++) {
      const r = unit * (2 + 2.5 * rnd(i + 0.5));
      const px = x + mod(rnd(i) * w + t * unit * (0.15 + 0.2 * rnd(i + 0.3)), w + 2 * r) - r;
      const py = y + rnd(i + 0.7) * h + Math.sin(t * 0.2 + i) * unit * 0.5;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(210,215,225,${0.1 + 0.18 * k})`);
      g.addColorStop(1, "rgba(210,215,225,0)");
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
    }
  } else if (kind === "clouds") {
    // Big, slow clusters of soft puffs drifting across (fog is a low, even haze; clouds have shape).
    const lift = (i: number) => Math.sin(t * 0.15 + i) * unit * 0.3;
    for (let c = 0; c < count(3, 7); c++) {
      const size = unit * (3 + 3 * rnd(c + 0.5));
      const cx = x + mod(rnd(c) * w + t * unit * (0.25 + 0.2 * rnd(c + 0.3)), w + 4 * size) - 2 * size;
      const cy = y + rnd(c + 0.7) * h + lift(c);
      for (let p = 0; p < 6; p++) {
        const n = c * 10 + p;
        const r = size * (0.45 + 0.4 * rnd(n + 0.2));
        const px = cx + (rnd(n + 0.4) - 0.5) * size * 1.6;
        const py = cy + (rnd(n + 0.6) - 0.5) * size * 0.6;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(240,242,248,${0.18 + 0.25 * k})`);
        g.addColorStop(0.6, `rgba(225,228,238,${0.08 + 0.12 * k})`);
        g.addColorStop(1, "rgba(225,228,238,0)");
        ctx.fillStyle = g;
        ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
      }
    }
  } else if (kind === "fire") {
    // Flames rise from the bottom of the area, shrinking and cooling from yellow to red as they go.
    ctx.globalCompositeOperation = "lighter";
    const life = 1.1;
    for (let i = 0; i < count(40, 160) * (area.circle ? 1 : 0.5); i++) {
      const phase = mod(t / life + rnd(i), 1);
      const spread = (rnd(i + 0.3) - 0.5) * w * (area.circle ? 0.7 : 1) * (1 - phase * 0.6);
      const px = x + w / 2 + spread + Math.sin(t * 6 + i) * unit * 0.08;
      const py = y + h * (area.circle ? 0.85 : 1) - phase * h * (0.6 + 0.3 * k);
      const r = unit * (0.12 + 0.2 * k) * (1 - phase) + 1;
      const g = Math.round(220 - 170 * phase);
      ctx.fillStyle = `rgba(255,${g},40,${0.55 * (1 - phase)})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "lightning") {
    // A strike every few seconds (more often when stronger): a brief flash and a jagged bolt.
    const period = 7 - 5 * k;
    const cycle = Math.floor(t / period);
    const since = t - cycle * period;
    if (since < 0.35) {
      ctx.fillStyle = `rgba(235,240,255,${0.55 * (1 - since / 0.35)})`;
      ctx.fillRect(x, y, w, h);
    }
    if (since < 0.2) {
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.shadowColor = "rgba(170,190,255,0.9)";
      ctx.shadowBlur = unit * 0.4;
      ctx.lineWidth = Math.max(1.5, unit * 0.05);
      ctx.beginPath();
      let px = x + w * (0.2 + 0.6 * rnd(cycle + 0.1));
      let py = y;
      ctx.moveTo(px, py);
      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        px += (rnd(cycle * 31 + s) - 0.5) * unit * 1.2;
        py = y + (h * s) / steps;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}
