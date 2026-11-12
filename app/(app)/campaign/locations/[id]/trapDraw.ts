import type { TrapArea } from "@/lib/traps";

export type TrapShape = TrapArea["shape"];
type Drag = { start: { x: number; y: number }; end: { x: number; y: number } };

/** The area a drag on the map draws (grid units): a rectangle corner to corner, a circle from its centre, a tripwire end to end. */
export function trapFromDrag(shape: TrapShape, d: Drag): TrapArea | null {
  const { start: a, end: b } = d;
  if (shape === "rect") {
    const area = { shape, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    return area.w >= 0.25 && area.h >= 0.25 ? area : null;
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.25) return null; // a click without a drag draws nothing
  return shape === "circle" ? { shape, x: a.x, y: a.y, r: len } : { shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** Draws a trap's area (canvas in scene units; `toPx` maps grid units). Found ones solid, hidden ones dashed; `draft` while drawing. */
export function drawTrap(ctx: CanvasRenderingContext2D, a: TrapArea, toPx: (x: number, y: number) => { x: number; y: number }, size: number, o: { found?: boolean; draft?: boolean; label?: string } = {}) {
  ctx.save();
  ctx.lineWidth = Math.max(1, size * (a.shape === "line" ? 0.08 : 0.05));
  ctx.strokeStyle = o.draft ? "rgb(248,113,113)" : o.found ? "rgb(239,68,68)" : "rgba(248,113,113,0.85)";
  ctx.fillStyle = o.found ? "rgba(239,68,68,0.28)" : "rgba(248,113,113,0.14)";
  if (!o.found) ctx.setLineDash([size * 0.12, size * 0.08]);
  ctx.beginPath();
  let labelAt: { x: number; y: number };
  if (a.shape === "circle") {
    const c = toPx(a.x, a.y);
    ctx.arc(c.x, c.y, a.r * size, 0, Math.PI * 2);
    ctx.fill();
    labelAt = c;
  } else if (a.shape === "rect") {
    const p = toPx(a.x, a.y);
    ctx.rect(p.x, p.y, a.w * size, a.h * size);
    ctx.fill();
    labelAt = toPx(a.x + a.w / 2, a.y + a.h / 2);
  } else {
    const p = toPx(a.x1, a.y1), q = toPx(a.x2, a.y2);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    labelAt = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  }
  ctx.stroke();
  if (o.label) {
    ctx.setLineDash([]);
    ctx.font = `bold ${size * 0.2}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = size * 0.04;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(o.label, labelAt.x, labelAt.y);
    ctx.fillStyle = "#fecaca";
    ctx.fillText(o.label, labelAt.x, labelAt.y);
  }
  ctx.restore();
}
