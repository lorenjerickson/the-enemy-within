/** What's drawn over the map's layers: pings, and the editor's highlights and drafts (see MapView). */
import { STRUCTURE_STYLES } from "@/lib/maps";
import type { LightSource, MapNote, MapStructure, MapTile, MapToken, PositionalSound } from "@/lib/db";
import type { TrapArea } from "@/lib/traps";
import { drawTrap } from "./trapDraw";
import { FX_MS, PING_MS, SCENE, SIGHT, cellToRect, gridOrigin, inScene, noteLayout, viewPast, type Area, type CellRect, type MapState } from "./mapLayers";
import { blockingSegments, insidePolygon, visibilityPolygon, type Point, type Segment } from "@/lib/visibility";
import { areaPolygon, caughtBy, placeArea } from "@/lib/aoe";
import { drawAreaFx, drawFx, type Fx } from "@/lib/vfx";
import { FEET_PER_SQUARE, crosses, type Reach } from "@/lib/movement";
import type { Contest } from "@/lib/resolveRound";
import type { PickEntity } from "@/lib/scriptPrompt";
import type { TargetMode } from "../../../../(play)/play/targetMode";

/** Pings: expanding rings with who pinged. `k`: screen pixels per scene unit (outlines keep a constant width). */
export function drawPings(ctx: CanvasRenderingContext2D, state: MapState, pings: { x: number; y: number; name: string; gm: boolean; at: number }[], k: number) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    for (const p of pings) {
      const t = (Date.now() - p.at) / PING_MS;
      if (t >= 1) continue;
      const px = x0 + p.x * size, py = y0 + p.y * size;
      const colour = p.gm ? "250,204,21" : "96,165,250";
      ctx.save();
      for (const lag of [0, 0.25]) {
        const u = ((t * 3 + lag) % 1);
        ctx.strokeStyle = `rgba(${colour},${(1 - u) * (1 - t * 0.5)})`;
        ctx.lineWidth = 3 / k;
        ctx.beginPath();
        ctx.arc(px, py, (6 + u * 34) / k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = `rgb(${colour})`;
      ctx.beginPath();
      ctx.arc(px, py, 4 / k, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${12 / k}px sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(p.name, px, py - 14 / k);
      ctx.fillText(p.name, px, py - 14 / k);
      ctx.restore();
    }
}

/** The editor's highlights (what's picked) and drafts (what's being drawn or placed); each only when it applies. */
export interface EditorAids {
  tile?: MapTile;
  note?: MapNote;
  light?: LightSource;
  sound?: PositionalSound;
  token?: MapToken;
  line?: { start: { x: number; y: number }; end: { x: number; y: number }; kind: keyof typeof STRUCTURE_STYLES } | null; // a wall, door… being drawn
  piece?: MapStructure;
  trap?: TrapArea | null; // a trap being dragged out
  effectArea?: Area | null; // an effect's area being dragged out
  startArea?: Area | null; // the party's start area (shown, or being dragged out)
  placing?: CellRect | null; // the cells a tile being placed will cover
}

export function drawEditorAids(ctx: CanvasRenderingContext2D, state: MapState, k: number, a: EditorAids) {
  // Highlight the tile picked in the editor.
  const highlighted = a.tile;
  if (highlighted) {
    const r = cellToRect(state, SCENE.w, SCENE.h, highlighted);
    ctx.save();
    ctx.strokeStyle = "rgb(129,140,248)";
    ctx.lineWidth = 3 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  // Highlight the note picked in the editor.
  const note = a.note;
  if (note) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    ctx.save();
    ctx.strokeStyle = "rgb(129,140,248)";
    ctx.lineWidth = 3 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    const { width: nw, height: nh } = noteLayout(ctx, note, size);
    ctx.strokeRect(x0 + note.x * size - 4, y0 + note.y * size - 4, nw + 8, nh + 8);
    ctx.restore();
  }
  // Highlight the light picked in the editor.
  const lt = a.light;
  if (lt) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    ctx.save();
    ctx.strokeStyle = "rgb(129,140,248)";
    ctx.lineWidth = 3 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    ctx.beginPath();
    ctx.arc(x0 + lt.x * size, y0 + lt.y * size, size * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Highlight the positional sound picked in the editor.
  const ps = a.sound;
  if (ps) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    ctx.save();
    ctx.strokeStyle = "rgb(129,140,248)";
    ctx.lineWidth = 3 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    ctx.beginPath();
    ctx.arc(x0 + ps.x * size, y0 + ps.y * size, ps.radius * size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Highlight the token picked in the editor.
  const token = a.token;
  if (token) {
    const r = cellToRect(state, SCENE.w, SCENE.h, { col: token.col, row: token.row, cols: 1, rows: 1 });
    const sideOn = state.mapImage.perspective === "portrait" && token.token_side && state.tokenImages.get(token.token_side);
    ctx.save();
    if (sideOn) {
      // Side-on figures aren't round: outline their cell.
      ctx.strokeStyle = "rgb(129,140,248)";
      ctx.lineWidth = 3 / k;
      ctx.setLineDash([6 / k, 4 / k]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else {
      // A 4px ring (on screen, whatever the zoom) around the round token.
      ctx.strokeStyle = token.character_id ? "#93c5fd" : "#fca5a5";
      ctx.lineWidth = 4 / k;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Structure: preview of the line being drawn, and highlight of the selected piece.
  const drawingLine = a.line;
  if (drawingLine) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const style = STRUCTURE_STYLES[drawingLine.kind];
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0 + drawingLine.start.x * size, y0 + drawingLine.start.y * size);
    ctx.lineTo(x0 + drawingLine.end.x * size, y0 + drawingLine.end.y * size);
    ctx.stroke();
    ctx.restore();
  }
  const piece = a.piece;
  if (piece) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    ctx.save();
    ctx.strokeStyle = "rgb(129,140,248)";
    ctx.lineWidth = 3 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    const pad = 6;
    const [ax, bx] = [Math.min(piece.x1, piece.x2), Math.max(piece.x1, piece.x2)];
    const [ay, by] = [Math.min(piece.y1, piece.y2), Math.max(piece.y1, piece.y2)];
    const extra = piece.kind === "staircase" ? 1 : 0;
    ctx.strokeRect(x0 + ax * size - pad, y0 + ay * size - pad, (bx - ax + extra) * size + 2 * pad, (by - ay + extra) * size + 2 * pad);
    ctx.restore();
  }
  // Trap being dragged out.
  if (a.trap) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    drawTrap(ctx, a.trap, (x, y) => ({ x: x0 + x * size, y: y0 + y * size }), size, { draft: true });
  }
  // Effect area being dragged out.
  if (a.effectArea) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const r = a.effectArea;
    ctx.save();
    ctx.fillStyle = "rgba(167,139,250,0.15)";
    ctx.strokeStyle = "rgb(167,139,250)";
    ctx.lineWidth = 2 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    ctx.fillRect(x0 + r.x * size, y0 + r.y * size, r.w * size, r.h * size);
    ctx.strokeRect(x0 + r.x * size, y0 + r.y * size, r.w * size, r.h * size);
    ctx.restore();
  }
  // Party start area (while on the tokens layer), and one being dragged out.
  const startArea = a.startArea;
  if (startArea) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const r = { x: x0 + startArea.x * size, y: y0 + startArea.y * size, w: startArea.w * size, h: startArea.h * size };
    ctx.save();
    ctx.fillStyle = "rgba(52,211,153,0.15)";
    ctx.strokeStyle = "rgb(52,211,153)";
    ctx.lineWidth = 2 / k;
    ctx.setLineDash([6 / k, 4 / k]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgb(52,211,153)";
    ctx.font = `${12 / k}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText("Party start", r.x + 4 / k, r.y + 4 / k);
    ctx.restore();
  }
  // Placement preview: outline of the cells the tile will cover.
  if (a.placing) {
    const r = cellToRect(state, SCENE.w, SCENE.h, a.placing);
    ctx.save();
    ctx.fillStyle = "rgba(99,102,241,0.25)";
    ctx.strokeStyle = "rgb(129,140,248)";
    ctx.lineWidth = 2 / k;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

/** What the session overlays draw from (the map's state of play, worked out in MapView). */
export interface SessionOverlayInputs {
  canvas: HTMLCanvasElement;
  fogged: { visible: Point[][]; explored: Point[][]; tokens: MapToken[]; dark: boolean; viewers: { at: Point; dv: number; blind: boolean }[] } | null; // a player's fog of war
  fogCanvas: { current: { fog: HTMLCanvasElement; mask: HTMLCanvasElement } | null }; // kept between frames
  fogWalls: Segment[];
  replayFrame: ({ pos: Record<number, { col: number; row: number }>; fx?: Fx[] } & ({ scrubbing: boolean } | { k: number } | { startsIn: number })) | null; // the second of a round being played back (scrubbed to, or k of the way through)
  scriptFx: { id: number; starts: number; fx: Fx }[]; // fx() effects playing
  readOnly: boolean;
  gmSel: number | null; // the creature the GM is planning for
  pickEntity: PickEntity | null; // a script's select(): what kind of thing, and which can be chosen
  pickIds: Set<number>;
  scriptPick: { selected: number[] } | null;
  targetMode: TargetMode;
  aimAt: Point | null;
  aimFrom: Point | null;
  actingToken: number | undefined;
  targetCandidates: MapToken[];
  gridless: boolean;
  contest: Contest | null;
  planRoutes: { token: number; points: { col: number; row: number }[] }[];
  planTargets: { from: number; to: number; action: string; label?: string; at?: { col: number; row: number } | null }[];
  selectedTarget: number | null;
  drawnTokens: MapToken[];
  reach: ({ from: { col: number; row: number }; feet: number; perSecond: number; at: MapToken; token: MapToken } & ({ kind: "area"; polys: Point[][]; areas: { poly: Point[]; origin: Point; base: number }[] } | { kind: "squares"; cells: Reach })) | null; // how far they can still move
}

/** A contested move's box: everyone involved, where the two were and are, and the spot (grid cells). */
export function contestBox(c: Contest, tokens: { id: number; col: number; row: number }[]) {
  const pts = [c.spot, c.a.from, c.b.from, ...tokens.filter((t) => t.id === c.a.id || t.id === c.b.id)];
  return {
    c0: Math.floor(Math.min(...pts.map((p) => p.col))) - 1,
    r0: Math.floor(Math.min(...pts.map((p) => p.row))) - 1,
    c1: Math.ceil(Math.max(...pts.map((p) => p.col))) + 2,
    r1: Math.ceil(Math.max(...pts.map((p) => p.row))) + 2,
  };
}

/** Over the layers, in a session: fog of war, round playback and fx, planning, select() picks, aiming and targeting, a contested move, planned routes and targets, the movement overlay. */
export function drawSessionOverlays(ctx: CanvasRenderingContext2D, state: MapState, k: number, o: SessionOverlayInputs) {
  const { canvas, fogged, fogCanvas, fogWalls, replayFrame, scriptFx, readOnly, gmSel, pickEntity, pickIds, scriptPick, targetMode, aimAt, aimFrom, actingToken, targetCandidates, gridless, contest, planRoutes, planTargets, selectedTarget, drawnTokens, reach } = o;
  // Fog of war: black where never seen, dimmed where seen before, clear where in sight now.
  if (fogged) {
    fogCanvas.current ??= { fog: document.createElement("canvas"), mask: document.createElement("canvas") };
    const { fog: f, mask: m } = fogCanvas.current;
    const t = ctx.getTransform();
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const shapes = (polys: Point[][]) => {
      const p = new Path2D();
      for (const poly of polys) {
        poly.forEach((pt, i) => (i ? p.lineTo(x0 + pt.x * size, y0 + pt.y * size) : p.moveTo(x0 + pt.x * size, y0 + pt.y * size)));
        p.closePath();
      }
      return p;
    };
    for (const c of [f, m]) { c.width = canvas.width; c.height = canvas.height; }
    const fc = f.getContext("2d")!, mc = m.getContext("2d")!;
    fc.fillStyle = "#000";
    fc.fillRect(0, 0, f.width, f.height);
    // Explored areas, merged on their own canvas first so overlaps don't clear twice.
    mc.setTransform(t);
    mc.fillStyle = "#fff";
    mc.fill(shapes(fogged.explored));
    fc.globalCompositeOperation = "destination-out";
    fc.globalAlpha = 0.45;
    fc.drawImage(m, 0, 0);
    fc.globalAlpha = 1;
    if (!fogged.dark) {
      fc.setTransform(t);
      fc.fill(shapes(fogged.visible));
    } else {
      // In the dark: what's in sight AND (lit by a light source OR within their darkvision), merged on the mask canvas.
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.clearRect(0, 0, m.width, m.height);
      mc.setTransform(t);
      mc.fillStyle = "#fff";
      for (const l of state.lights) {
        if (!l.enabled) continue;
        const seen = viewPast(state.structures, { x: l.x, y: l.y }, l.radius * 1.05); // the arc below trims it
        mc.save();
        mc.clip(shapes([seen]));
        mc.beginPath();
        const cx = x0 + l.x * size, cy = y0 + l.y * size, r = l.radius * size;
        if (l.kind === "point" || l.spread >= 360) mc.arc(cx, cy, r, 0, Math.PI * 2);
        else { const half = (l.spread * Math.PI) / 360, dir = (l.angle * Math.PI) / 180; mc.moveTo(cx, cy); mc.arc(cx, cy, r, dir - half, dir + half); mc.closePath(); }
        mc.fill();
        mc.restore();
      }
      fogged.viewers.forEach((v) => {
        if (v.blind) { mc.fill(shapes([visibilityPolygon(v.at, SIGHT, fogWalls)])); return; } // blind: their sight is already only what's around them
        if (!v.dv) return;
        mc.beginPath();
        mc.arc(x0 + v.at.x * size, y0 + v.at.y * size, (v.dv / 5) * size, 0, Math.PI * 2);
        mc.fill();
      });
      mc.globalCompositeOperation = "destination-in"; // keep only what's also in their line of sight
      mc.fill(shapes(fogged.visible));
      mc.globalCompositeOperation = "source-over";
      fc.setTransform(1, 0, 0, 1, 0, 0);
      fc.drawImage(m, 0, 0);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(f, 0, 0);
    ctx.restore();
  }
  // Round playback: attacks landing this second (a slash or an arrow, then a hit burst or a miss), as far through as
  // the second is; scrubbing shows them at impact. Players see those involving someone they can see.
  // Script effects (fx(…)) play the same way, for a second from their start.
  const fxNow = [
    ...(replayFrame && "fx" in replayFrame && replayFrame.fx?.length
      ? replayFrame.fx.map((f) => ({ f, k: "scrubbing" in replayFrame ? 0.7 : "k" in replayFrame ? replayFrame.k : 1 }))
      : []),
    ...scriptFx.filter((s) => Date.now() >= s.starts && Date.now() < s.starts + FX_MS).map((s) => ({ f: s.fx, k: (Date.now() - s.starts) / FX_MS })),
  ];
  if (fxNow.length) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const at = (id: number) => {
      const t = state.tokens.find((x) => x.id === id);
      const p = t ?? replayFrame?.pos[id];
      return p && { x: x0 + (p.col + 0.5) * size, y: y0 + (p.row + 0.5) * size, seen: !!t };
    };
    const toPx = (p: Point) => ({ x: x0 + p.x * size, y: y0 + p.y * size });
    for (const { f, k } of fxNow) {
      if (f.look === "area") {
        // Players see an area that touches anyone they can see, or that starts where they can see.
        const shown = !readOnly || [f.from, ...f.hits.map((h) => h.id)].some((id) => at(id)?.seen) || !!fogged?.visible.some((poly) => insidePolygon(f.area.origin, poly));
        if (!shown) continue;
        const clip = inScene(viewPast(state.structures, f.area.origin, f.area.size * 1.05), x0, y0, size);
        drawAreaFx(ctx, f, k, toPx, size, (id) => at(id), clip);
        continue;
      }
      const a = at(f.from), b = at(f.to);
      if (a && b && (a.seen || b.seen)) drawFx(ctx, f, k, a, b, size);
    }
  }
  // The creature the GM is planning for: a bright ring with a soft glow, so it's clear which one they control.
  const planning = !readOnly && gmSel !== null ? state.tokens.find((t) => t.id === gmSel) : undefined;
  if (planning) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const cx = x0 + (planning.col + 0.5) * size, cy = y0 + (planning.row + 0.5) * size;
    ctx.save();
    ctx.fillStyle = "rgba(167,139,250,0.22)";
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgb(167,139,250)";
    ctx.lineWidth = 3 / k;
    ctx.shadowColor = "rgba(167,139,250,0.9)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // A script's select(): dashed outlines on what can be chosen, solid on what is.
  if (pickEntity) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const chosen = new Set(scriptPick!.selected);
    const at = (x: number, y: number) => [x0 + x * size, y0 + y * size] as const;
    for (const on of [false, true]) {
      ctx.save();
      ctx.strokeStyle = on ? "rgb(56,189,248)" : "rgba(250,204,21,0.9)";
      ctx.fillStyle = "rgba(56,189,248,0.25)";
      ctx.lineWidth = (on ? 4 : 2) / k;
      ctx.setLineDash(on ? [] : [4 / k, 3 / k]);
      const shape = (path: () => void) => { ctx.beginPath(); path(); if (on) ctx.fill(); ctx.stroke(); };
      for (const id of pickIds) {
        if (chosen.has(id) !== on) continue;
        if (pickEntity === "token") {
          const t = state.tokens.find((x) => x.id === id);
          if (t) shape(() => ctx.arc(...at(t.col + 0.5, t.row + 0.5), size * 0.6, 0, Math.PI * 2));
        } else if (pickEntity === "door") {
          const d = state.structures.find((x) => x.id === id);
          if (d) {
            ctx.save();
            ctx.lineWidth = (on ? 10 : 6) / k;
            ctx.globalAlpha = on ? 0.9 : 0.7;
            ctx.beginPath(); ctx.moveTo(...at(d.x1, d.y1)); ctx.lineTo(...at(d.x2, d.y2)); ctx.stroke();
            ctx.restore();
          }
        } else if (pickEntity === "light") {
          const l = state.lights.find((x) => x.id === id);
          if (l) shape(() => ctx.arc(...at(l.x, l.y), size * 0.5, 0, Math.PI * 2));
        } else {
          const f = state.effects.find((x) => x.id === id);
          if (f && f.x !== null && f.y !== null) shape(() => ctx.rect(...at(f.x!, f.y!), (f.w ?? 0) * size, (f.h ?? 0) * size));
        }
      }
      ctx.restore();
    }
  }
  // Aiming an area: the shape where it would go (red when a circle is out of range), the squares it covers on grid
  // maps, and a ring on everyone it would catch.
  const aimPoint = targetMode?.aimed ? { x: targetMode.aimed.col, y: targetMode.aimed.row } : aimAt;
  if (targetMode?.area && aimPoint && aimFrom) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const px = (p: Point) => ({ x: x0 + p.x * size, y: y0 + p.y * size });
    const area = placeArea(targetMode.area.shape, targetMode.area.ft, aimFrom, aimPoint);
    const tooFar = targetMode.area.shape === "circle" && Math.hypot(aimPoint.x - aimFrom.x, aimPoint.y - aimFrom.y) > targetMode.area.range + 0.5;
    const walls = blockingSegments(state.structures);
    ctx.save();
    if (targetMode.area.shape === "circle") {
      ctx.setLineDash([4 / k, 4 / k]);
      ctx.strokeStyle = "rgba(250,204,21,0.8)";
      ctx.lineWidth = 1.5 / k;
      ctx.beginPath();
      ctx.arc(px(aimFrom).x, px(aimFrom).y, (targetMode.area.range + 0.5) * size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!gridless) {
      ctx.fillStyle = tooFar ? "rgba(239,68,68,0.15)" : "rgba(249,115,22,0.2)";
      const pts = areaPolygon(area);
      const [c0, c1] = [Math.floor(Math.min(...pts.map((p) => p.x))), Math.ceil(Math.max(...pts.map((p) => p.x)))];
      const [r0, r1] = [Math.floor(Math.min(...pts.map((p) => p.y))), Math.ceil(Math.max(...pts.map((p) => p.y)))];
      for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) if (caughtBy(area, { x: c + 0.5, y: r + 0.5 }, walls)) ctx.fillRect(x0 + c * size, y0 + r * size, size, size);
    }
    ctx.beginPath();
    areaPolygon(area).map(px).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = tooFar ? "rgba(239,68,68,0.2)" : "rgba(249,115,22,0.22)";
    ctx.fill();
    ctx.strokeStyle = tooFar ? "rgb(239,68,68)" : "rgb(234,88,12)";
    ctx.lineWidth = 2 / k;
    ctx.stroke();
    ctx.strokeStyle = "rgb(234,88,12)";
    for (const t of state.tokens) {
      if (t.id === actingToken || !caughtBy(area, { x: t.col + 0.5, y: t.row + 0.5 }, walls)) continue;
      ctx.beginPath();
      ctx.arc(x0 + (t.col + 0.5) * size, y0 + (t.row + 0.5) * size, size * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Picking a target: how far the action reaches from where their plan leaves them (walls block it), so it's
  // clear who's in range; on a grid, the squares it reaches.
  if (targetMode && !targetMode.area && targetMode.range && aimFrom) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const reach = targetMode.range + 0.5, walls = blockingSegments(state.structures);
    const seen = visibilityPolygon(aimFrom, gridless ? reach : reach * 1.5, walls);
    ctx.save();
    ctx.fillStyle = "rgba(250,204,21,0.12)";
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.lineWidth = 1.5 / k;
    if (gridless) {
      ctx.beginPath();
      seen.forEach((p, i) => (i ? ctx.lineTo(x0 + p.x * size, y0 + p.y * size) : ctx.moveTo(x0 + p.x * size, y0 + p.y * size)));
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash([5 / k, 4 / k]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const c0 = Math.floor(aimFrom.x - 0.5), r0 = Math.floor(aimFrom.y - 0.5), n = targetMode.range;
      for (let c = c0 - n; c <= c0 + n; c++) for (let r = r0 - n; r <= r0 + n; r++) {
        if (insidePolygon({ x: c + 0.5, y: r + 0.5 }, seen)) ctx.fillRect(x0 + c * size, y0 + r * size, size, size);
      }
    }
    const label = `${targetMode.range * 5} ft`;
    ctx.font = `bold ${11 / k}px sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    const lx = x0 + aimFrom.x * size, ly = y0 + (aimFrom.y - reach) * size - 4 / k;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = "#fde68a";
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }
  // Picking a target: a faint ring around each token that can be clicked (red if it's out of range from there).
  if (targetMode) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    ctx.save();
    ctx.strokeStyle = "rgba(250,204,21,0.85)";
    ctx.lineWidth = 2 / k;
    ctx.setLineDash([3 / k, 3 / k]);
    const inRange = (t: { col: number; row: number }) => {
      if (!targetMode.range || targetMode.area || !aimFrom) return true;
      const c = { x: t.col + 0.5, y: t.row + 0.5 };
      const near = gridless ? Math.hypot(c.x - aimFrom.x, c.y - aimFrom.y) <= targetMode.range + 0.5 : Math.max(Math.abs(c.x - aimFrom.x), Math.abs(c.y - aimFrom.y)) <= targetMode.range + 1e-6;
      return near && !blockingSegments(state.structures).some((w) => crosses(aimFrom, c, w));
    };
    for (const t of targetCandidates) {
      ctx.strokeStyle = inRange(t) ? "rgba(250,204,21,0.85)" : "rgba(239,68,68,0.85)";
      ctx.beginPath();
      ctx.arc(x0 + (t.col + 0.5) * size, y0 + (t.row + 0.5) * size, size * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Picked so far: a solid, bolder ring.
    ctx.setLineDash([]);
    ctx.lineWidth = 3.5 / k;
    ctx.strokeStyle = "rgb(250,204,21)";
    for (const t of targetCandidates) {
      if (!targetMode.picks?.includes(t.id)) continue;
      ctx.beginPath();
      ctx.arc(x0 + (t.col + 0.5) * size, y0 + (t.row + 0.5) * size, size * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // A contested move waiting on the GM: a see-through box around everyone involved, where the two were when it
  // happened (dashed rings, joined to where they stand now), and the contested spot pulsing.
  if (contest) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const box = contestBox(contest, state.tokens);
    const X = (c: number) => x0 + c * size, Y = (r: number) => y0 + r * size;
    ctx.save();
    ctx.fillStyle = "rgba(251,191,36,0.08)";
    ctx.strokeStyle = "rgba(251,191,36,0.7)";
    ctx.lineWidth = 2 / k;
    ctx.setLineDash([8 / k, 5 / k]);
    ctx.fillRect(X(box.c0), Y(box.r0), X(box.c1) - X(box.c0), Y(box.r1) - Y(box.r0));
    ctx.strokeRect(X(box.c0), Y(box.r0), X(box.c1) - X(box.c0), Y(box.r1) - Y(box.r0));
    for (const who of [contest.a, contest.b]) {
      const t = state.tokens.find((x) => x.id === who.id);
      const fx = X(who.from.col + 0.5), fy = Y(who.from.row + 0.5);
      if (t && (t.col !== who.from.col || t.row !== who.from.row)) {
        ctx.strokeStyle = "rgba(253,230,138,0.6)";
        ctx.beginPath();
        ctx.moveTo(X(t.col + 0.5), Y(t.row + 0.5));
        ctx.lineTo(fx, fy);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(253,230,138,0.95)";
      ctx.beginPath();
      ctx.arc(fx, fy, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fde68a";
      ctx.font = `bold ${11 / k}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(who.name, fx, fy - size * 0.5);
    }
    ctx.setLineDash([]);
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
    ctx.fillStyle = `rgba(245,158,11,${0.25 + 0.3 * pulse})`;
    ctx.strokeStyle = "rgba(245,158,11,1)";
    ctx.lineWidth = (2 + 2 * pulse) / k;
    ctx.fillRect(X(contest.spot.col), Y(contest.spot.row), size, size);
    ctx.strokeRect(X(contest.spot.col), Y(contest.spot.row), size, size);
    ctx.fillStyle = "#fff7ed";
    ctx.font = `bold ${16 / k}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", X(contest.spot.col + 0.5), Y(contest.spot.row + 0.5));
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
  // Planned moves: each plan's route as a linked trail of waypoints (numbered), from where the token stands.
  if (planRoutes.length && !replayFrame) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    for (const r of planRoutes) {
      const t = state.tokens.find((x) => x.id === r.token);
      if (!t) continue;
      const pts = [t, ...r.points].map((p) => ({ x: x0 + (p.col + 0.5) * size, y: y0 + (p.row + 0.5) * size }));
      ctx.save();
      ctx.strokeStyle = "rgba(186,230,253,0.9)";
      ctx.lineWidth = 2 / k;
      ctx.setLineDash([2 / k, 4 / k]);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      pts.slice(1).forEach((p, i) => {
        ctx.fillStyle = "rgba(14,116,144,0.95)";
        ctx.strokeStyle = "rgba(224,242,254,0.95)";
        ctx.lineWidth = 1.5 / k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e0f2fe";
        ctx.font = `bold ${9 / k}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y);
        ctx.textBaseline = "alphabetic";
      });
      ctx.restore();
    }
  }
  // Planned targets: a dashed line to who they're aiming at, from where they'll be when they do it (after the moves
  // planned before it), and a ring on the target.
  // A player's selected target: a red crosshair ring (only on someone they can see).
  if (selectedTarget !== null && !replayFrame) {
    const t = (fogged ? fogged.tokens : drawnTokens).find((x) => x.id === selectedTarget);
    if (t) {
      const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
      const cx = x0 + (t.col + 0.5) * size, cy = y0 + (t.row + 0.5) * size, r = size * 0.62;
      ctx.save();
      ctx.strokeStyle = "rgba(239,68,68,0.95)";
      ctx.lineWidth = 2.5 / k;
      ctx.setLineDash([size * 0.18, size * 0.1]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * r * 0.8, cy + dy * r * 0.8);
        ctx.lineTo(cx + dx * r * 1.25, cy + dy * r * 1.25);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  if (planTargets.length && !replayFrame) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const at = (id: number) => {
      const t = state.tokens.find((x) => x.id === id);
      return t && { x: x0 + (t.col + 0.5) * size, y: y0 + (t.row + 0.5) * size };
    };
    for (const l of planTargets) {
      const a = l.at ? { x: x0 + (l.at.col + 0.5) * size, y: y0 + (l.at.row + 0.5) * size } : at(l.from), b = at(l.to);
      if (!a || !b) continue;
      const colour = l.action === "attack" ? "239,68,68" : l.action === "pursue" ? "249,115,22" : l.action === "evade" ? "59,130,246" : "168,85,247";
      ctx.save();
      ctx.strokeStyle = `rgba(${colour},0.9)`;
      ctx.lineWidth = 2.5 / k;
      ctx.setLineDash([7 / k, 5 / k]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, size * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `bold ${11 / k}px sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.strokeText(l.label ?? l.action, mid.x, mid.y - 4 / k);
      ctx.fillStyle = `rgb(${colour})`;
      ctx.fillText(l.label ?? l.action, mid.x, mid.y - 4 / k);
      ctx.restore();
    }
  }
  // Movement overlay: reachable squares (grid) or the reachable area (gridless), over the fog, with feet left.
  if (reach) {
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    ctx.save();
    // Graded by the second it takes to get there (nearer = deeper), so they can see how much time a move
    // leaves for an action; the first band's seconds are labelled.
    const v = reach.perSecond / FEET_PER_SQUARE; // squares a second
    const total = v > 0 ? reach.feet / reach.perSecond : 0; // seconds of movement left
    const bands = v > 0 ? Math.ceil(total - 1e-6) : 1;
    const shade = (sec: number) => (bands <= 1 ? 0.3 : 0.42 - (0.3 * (sec - 1)) / (bands - 1)); // 1 s deepest
    const labels: { x: number; y: number; text: string }[] = [];
    if (reach.kind === "squares") {
      ctx.strokeStyle = "rgba(125,211,252,0.85)";
      ctx.lineWidth = 1 / k;
      const edge = new Map<number, { col: number; row: number }>(); // per second: the cell to label
      for (const c of reach.cells.values()) {
        const sec = v > 0 && c.steps ? Math.max(1, Math.ceil(c.steps / v - 1e-6)) : 1;
        const r = cellToRect(state, SCENE.w, SCENE.h, { col: c.col, row: c.row, cols: 1, rows: 1 });
        ctx.fillStyle = `rgba(56,189,248,${shade(sec)})`;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        // Label on their row if possible, furthest to the right.
        const e = edge.get(sec), score = (q: { col: number; row: number }) => q.col - Math.abs(q.row - reach.from.row) * 3;
        if (c.steps && (!e || score(c) > score(e))) edge.set(sec, c);
      }
      if (bands > 1) for (const [sec, c] of edge) labels.push({ x: x0 + (c.col + 0.5) * size, y: y0 + (c.row + 0.5) * size, text: `${sec} s` });
    } else {
      // Each band is the area reachable within that many seconds: every polygon cut to the walk left from its own
      // origin. Painted solid, outermost first, on a layer of its own, then laid over the map translucent (so
      // overlapping polygons don't double up).
      const layer = document.createElement("canvas");
      layer.width = ctx.canvas.width;
      layer.height = ctx.canvas.height;
      const lc = layer.getContext("2d")!;
      lc.setTransform(ctx.getTransform());
      const radius = reach.feet / FEET_PER_SQUARE;
      const far = Math.floor(radius / (v || radius)) * v - 0.25, o0 = reach.areas[0].origin;
      const labelAngle = [1, 3, -1, -3, 0, 2, 4, -2].map((q) => (q * Math.PI) / 4).find((ang) => insidePolygon({ x: o0.x + Math.cos(ang) * far, y: o0.y + Math.sin(ang) * far }, reach.areas[0].poly)) ?? Math.PI / 4;
      for (let sec = bands; sec >= 1; sec--) {
        const r = Math.min(radius, sec * v || radius);
        const a = shade(sec) / 0.42; // 0..1: how deep this band is
        lc.fillStyle = `rgb(${Math.round(8 + 140 * (1 - a))},${Math.round(90 + 135 * (1 - a))},${Math.round(170 + 82 * (1 - a))})`; // deep blue → pale
        for (const ar of reach.areas) {
          if (r - ar.base <= 0) continue;
          lc.save();
          lc.beginPath();
          lc.arc(x0 + ar.origin.x * size, y0 + ar.origin.y * size, (r - ar.base) * size, 0, Math.PI * 2);
          lc.clip();
          lc.beginPath();
          ar.poly.forEach((pt, i) => (i ? lc.lineTo(x0 + pt.x * size, y0 + pt.y * size) : lc.moveTo(x0 + pt.x * size, y0 + pt.y * size)));
          lc.closePath();
          lc.fill();
          lc.restore();
        }
        // Label each full second along one open line out from them (the first direction they can walk all the way).
        if (bands > 1 && sec * v <= radius + 1e-6) {
          const o = reach.areas[0].origin, d = sec * v - 0.25;
          const p = { x: o.x + Math.cos(labelAngle) * d, y: o.y + Math.sin(labelAngle) * d };
          labels.push({ x: x0 + p.x * size, y: y0 + p.y * size, text: `${sec} s` });
        }
      }
      ctx.save();
      ctx.resetTransform();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
    ctx.font = `bold ${10 / k}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3 / k;
    for (const l of labels) {
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = "#e0f2fe";
      ctx.fillText(l.text, l.x, l.y);
    }
    ctx.textBaseline = "alphabetic";
    // Where the plan has them so far: a dashed ring, joined to the token.
    if (reach.at.col !== reach.token.col || reach.at.row !== reach.token.row) {
      ctx.setLineDash([4 / k, 3 / k]);
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = "rgba(186,230,253,0.95)";
      ctx.beginPath();
      ctx.moveTo(x0 + (reach.token.col + 0.5) * size, y0 + (reach.token.row + 0.5) * size);
      ctx.lineTo(x0 + (reach.at.col + 0.5) * size, y0 + (reach.at.row + 0.5) * size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x0 + (reach.at.col + 0.5) * size, y0 + (reach.at.row + 0.5) * size, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const tx = x0 + (reach.at.col + 0.5) * size, ty = y0 + reach.at.row * size;
    const label = reach.perSecond > 0 ? `${Math.floor(reach.feet)} ft · ${+(reach.feet / reach.perSecond).toFixed(1)} s` : `${Math.floor(reach.feet)} ft`;
    ctx.font = `bold ${12 / k}px sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(label, tx, ty - 4 / k);
    ctx.fillStyle = "#e0f2fe";
    ctx.fillText(label, tx, ty - 4 / k);
    ctx.restore();
  }
}
