/** What's drawn over the map's layers: pings, and the editor's highlights and drafts (see MapView). */
import { STRUCTURE_STYLES } from "@/lib/maps";
import type { LightSource, MapNote, MapStructure, MapTile, MapToken, PositionalSound } from "@/lib/db";
import type { TrapArea } from "@/lib/traps";
import { drawTrap } from "./trapDraw";
import { PING_MS, SCENE, cellToRect, gridOrigin, noteLayout, type Area, type CellRect, type MapState } from "./mapLayers";

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
