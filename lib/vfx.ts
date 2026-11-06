/**
 * Visual effects for things that happen in a round (an attack swinging, an arrow flying, a hit landing).
 * The server records what happened (Fx, in a replay frame); the map draws it here, by how far through its second it is.
 */
import { areaPolygon, type AreaAt } from "@/lib/aoe";

/** An attack, as played back: who at whom, how it looked, and how it went. */
export interface AttackFx {
  look: "slash" | "arrow";
  from: number; // token ids
  to: number;
  outcome: "hit" | "miss" | "down";
}
/** Someone caught in an area: failed (hit), saved for half, saved for nothing, or dropped. */
export type AreaHit = { id: number; outcome: "hit" | "half" | "save" | "down" };
/** An area attack: the area as placed, and how each one caught fared. */
export interface AreaFx {
  look: "area";
  from: number;
  area: AreaAt;
  hits: AreaHit[];
}
export type Fx = AttackFx | AreaFx;

type P = { x: number; y: number };
const ease = (k: number) => 1 - (1 - k) * (1 - k);
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));

/** Draws an attack at progress k (0..1 through the second it lands in), from a to b (map pixels), cell = a square's size. */
export function drawFx(ctx: CanvasRenderingContext2D, fx: AttackFx, k: number, a: P, b: P, cell: number) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const IMPACT = fx.look === "arrow" ? 0.5 : 0.55; // when it lands
  ctx.save();
  ctx.lineCap = "round";
  if (fx.look === "arrow") {
    // Flies from the attacker; a miss sails on past.
    const end = fx.outcome === "miss" ? { x: b.x + Math.cos(ang + 0.25) * cell * 1.2, y: b.y + Math.sin(ang + 0.25) * cell * 1.2 } : b;
    const travel = clamp01(k / (fx.outcome === "miss" ? 0.7 : IMPACT));
    if (travel < 1) {
      const head = { x: a.x + (end.x - a.x) * travel, y: a.y + (end.y - a.y) * travel };
      const tail = { x: head.x - Math.cos(ang) * cell * 0.45, y: head.y - Math.sin(ang) * cell * 0.45 };
      const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(255,244,214,0.95)");
      // A dark edge under the light shaft, so it shows on light map art too.
      for (const [style, w] of [["rgba(20,20,20,0.55)", 0.11], [grad, 0.06]] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = Math.max(2, cell * w);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      }
    }
  } else {
    // A blade sweeping across the target, square to the line of attack.
    const sweep = clamp01((k - 0.15) / (IMPACT - 0.15));
    if (sweep > 0 && k < 0.9) {
      const r = cell * 0.62, span = 1.9, start = ang + Math.PI - span / 2; // the side facing the attacker
      const fade = k > IMPACT ? 1 - (k - IMPACT) / (0.9 - IMPACT) : 1;
      const end = start + span * ease(sweep);
      // A dark edge under the blade's arc, so it shows on light map art too.
      ctx.strokeStyle = `rgba(20,20,20,${0.5 * fade})`;
      ctx.lineWidth = Math.max(3, cell * 0.14);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r - cell * 0.06, Math.max(start, end - 0.9), end);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = fx.outcome === "miss" ? `rgba(200,200,210,${0.5 * fade})` : `rgba(255,255,255,${(0.9 - i * 0.25) * fade})`;
        ctx.lineWidth = Math.max(1.5, cell * (0.09 - i * 0.025));
        ctx.beginPath();
        ctx.arc(b.x, b.y, r - i * cell * 0.06, Math.max(start, end - 0.9), end);
        ctx.stroke();
      }
    }
  }
  // The impact: a red burst on a hit (bigger and darker when it drops them), a grey puff on a miss.
  if (k >= IMPACT) {
    const p = clamp01((k - IMPACT) / (1 - IMPACT));
    const fade = 1 - p;
    if (fx.outcome === "miss") {
      if (fx.look === "slash") {
        ctx.fillStyle = `rgba(220,220,230,${0.35 * fade})`;
        ctx.beginPath();
        ctx.arc(b.x + Math.cos(ang + Math.PI / 2) * cell * 0.5, b.y + Math.sin(ang + Math.PI / 2) * cell * 0.5, cell * (0.15 + 0.2 * p), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const big = fx.outcome === "down" ? 1.5 : 1;
      const rgb = fx.outcome === "down" ? "150,20,20" : "239,68,68";
      ctx.strokeStyle = `rgba(${rgb},${0.9 * fade})`;
      ctx.lineWidth = Math.max(2, cell * 0.07);
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * (0.3 + 0.45 * ease(p)) * big, 0, Math.PI * 2);
      ctx.stroke();
      // Sparks thrown away from the attacker.
      ctx.lineWidth = Math.max(1.5, cell * 0.04);
      for (let i = -2; i <= 2; i++) {
        const s = ang + i * 0.45, r0 = cell * (0.25 + 0.3 * p) * big, r1 = r0 + cell * 0.25 * fade * big;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(s) * r0, b.y + Math.sin(s) * r0);
        ctx.lineTo(b.x + Math.cos(s) * r1, b.y + Math.sin(s) * r1);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * Draws an area attack at progress k: the shape sweeps out from where it starts and fades, and each one caught gets a
 * burst (red on a failed save, orange for half, a grey puff when they saved for nothing). `toPx` maps grid units to
 * map pixels; `clip` (map pixels) keeps it out from behind walls.
 */
export function drawAreaFx(ctx: CanvasRenderingContext2D, fx: AreaFx, k: number, toPx: (p: P) => P, cell: number, at: (id: number) => P | undefined, clip?: P[]) {
  const grow = ease(clamp01(k / 0.35)), fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  const o = toPx(fx.area.origin);
  ctx.save();
  if (clip?.length) {
    ctx.beginPath();
    clip.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();
  }
  ctx.beginPath();
  areaPolygon(fx.area).map(toPx).forEach((p, i) => {
    const q = { x: o.x + (p.x - o.x) * grow, y: o.y + (p.y - o.y) * grow }; // sweeping out from its start
    if (i) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
  const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.max(1, fx.area.size * cell));
  g.addColorStop(0, `rgba(254,215,170,${0.75 * fade})`);
  g.addColorStop(1, `rgba(234,88,12,${0.45 * fade})`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `rgba(124,45,18,${0.7 * fade})`;
  ctx.lineWidth = Math.max(1.5, cell * 0.04);
  ctx.stroke();
  ctx.restore();
  if (k < 0.35) return;
  const p = clamp01((k - 0.35) / 0.65);
  for (const h of fx.hits) {
    const b = at(h.id);
    if (!b) continue;
    ctx.save();
    if (h.outcome === "save") {
      ctx.fillStyle = `rgba(220,220,230,${0.45 * (1 - p)})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * (0.2 + 0.25 * p), 0, Math.PI * 2);
      ctx.fill();
    } else {
      const rgb = h.outcome === "down" ? "150,20,20" : h.outcome === "half" ? "249,115,22" : "239,68,68";
      ctx.strokeStyle = `rgba(${rgb},${0.9 * (1 - p)})`;
      ctx.lineWidth = Math.max(2, cell * 0.07);
      ctx.beginPath();
      ctx.arc(b.x, b.y, cell * (0.3 + 0.45 * ease(p)) * (h.outcome === "down" ? 1.5 : h.outcome === "half" ? 0.8 : 1), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
