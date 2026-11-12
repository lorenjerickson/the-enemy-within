/** The map's geometry helpers and how each layer is drawn (one canvas, layer by layer; see MapView). */
import { useEffect, useState } from "react";
import { STRUCTURE_STYLES, type MapBackground, type MapGrid, type MapImage, type MapLayer } from "@/lib/maps";
import { blockingSegments, visibilityPolygon, type Point } from "@/lib/visibility";
import type { MapSecret, MapEffect, LightSource, MapNote, MapStructure, MapTile, MapToken, PositionalSound } from "@/lib/db";
import { drawLasting } from "@/lib/vfx";
import { type LastingArea } from "@/lib/aoe";
import { drawTrap } from "./trapDraw";
import type { Trap } from "@/lib/traps";
import { drawEffect } from "@/lib/effects";

export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export type Area = { x: number; y: number; w: number; h: number };

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/** Everything layers draw from: the location's settings plus any images already loaded. */
export interface MapState {
  background: MapBackground;
  backgroundImage: HTMLImageElement | null;
  mapImage: MapImage;
  mapImageEl: HTMLImageElement | null;
  grid: MapGrid;
  tiles: MapTile[];
  tileImages: Map<string, HTMLImageElement>;
  structures: MapStructure[];
  showWalls: boolean; // wall lines: GM only, and only while not hidden (they're still walls either way)
  tokens: MapToken[];
  down: Set<number>; // tokens at 0 health: drawn with a skull
  lifted?: number | null; // the token the GM has picked up to move: drawn raised, with a shadow
  tokenImages: Map<string, HTMLImageElement>;
  positional: PositionalSound[];
  illumination: number;
  figureHeight: number; // portrait maps: grid cells a 1.8 m figure stands
  lights: LightSource[];
  showLightAreas: boolean; // outline each light's area (while editing lighting)
  notes: MapNote[];
  secrets: MapSecret[];
  traps: Trap[]; // the GM's; a player's map gets only found ones
  effects: MapEffect[];
  lasting: LastingArea[]; // areas actions left on the map for a while
  time: number; // seconds, drives animated effects
  showEffectAreas: boolean; // outline placed effects (while editing effects)
}

export type CellRect = { col: number; row: number; cols: number; rows: number };

/** Loads an image URL into an element (null until loaded, or when there's no URL). */
export function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!url) return;
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = url;
  }, [url]);
  return img;
}

/** Where the map image is drawn: fitted inside the background's padded region, centred, aspect ratio preserved. */
export function mapRect({ background: { padding: p }, mapImageEl: img }: MapState, w: number, h: number) {
  if (!img) return null;
  const innerW = Math.max(0, w - p.left - p.right);
  const innerH = Math.max(0, h - p.top - p.bottom);
  const scale = Math.min(innerW / img.naturalWidth, innerH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  return { x: p.left + (innerW - drawW) / 2, y: p.top + (innerH - drawH) / 2, w: drawW, h: drawH };
}

/**
 * Sticky note geometry for a given grid size: the note's own width and height (in cells),
 * made taller if its word-wrapped text needs more room. Text size follows the grid, not the note.
 */
export function noteLayout(ctx: CanvasRenderingContext2D, note: Pick<MapNote, "text" | "w" | "h">, size: number) {
  const text = note.text;
  const width = size * note.w, pad = size * 0.13, fold = size * 0.24;
  const fontSize = Math.max(6, size * 0.176);
  ctx.save();
  ctx.font = `${fontSize}px sans-serif`;
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width - 2 * pad && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  ctx.restore();
  const height = Math.max(size * note.h, 2 * pad + lines.length * fontSize * 1.2 + fold * 0.6);
  return { width, height, pad, fold, fontSize, lines };
}

/**
 * The scene's fixed size in map space. Everything is drawn at this size and then scaled to fit the canvas,
 * so the map art, grid and everything placed on it stay aligned whatever size the canvas is.
 * (1408×792 is the size the first levels were drawn at.)
 */
export const SCENE = { w: 1408, h: 792 };
/** Drawing structures without the grid: an end this close (in cells) to another piece's end joins it. */
export const JOIN_DISTANCE = 0.3;

/** How the scene is scaled (s) and centred (ox, oy) to fit a canvas of this CSS size. */
export function fitScene(w: number, h: number) {
  const s = Math.min(w / SCENE.w, h / SCENE.h) || 1;
  return { s, ox: (w - SCENE.w * s) / 2, oy: (h - SCENE.h * s) / 2 };
}

/** Grid cell geometry: top-left of cell (0,0) and the cell size, in map space. */

export function gridOrigin(state: MapState, w: number, h: number) {
  const { size, offsetX, offsetY } = state.grid;
  const p = state.background.padding;
  const r = mapRect(state, w, h) ?? { x: p.left, y: p.top, w: w - p.left - p.right, h: h - p.top - p.bottom };
  const first = (start: number, offset: number) => start + (((offset % size) + size) % size);
  return { x0: first(r.x, offsetX), y0: first(r.y, offsetY), size };
}

/**
 * What a spot sees past walls and closed doors within `radius` cells, in grid units: worked out once per spot, reach
 * and set of walls (a new walls array means they changed), not on every frame while lights flicker or effects play.
 */
export const viewCache = new WeakMap<MapStructure[], Map<string, Point[]>>();
export function viewPast(structures: MapStructure[], at: Point, radius: number): Point[] {
  let views = viewCache.get(structures);
  if (!views) viewCache.set(structures, (views = new Map()));
  const key = `${at.x},${at.y},${radius}`;
  let v = views.get(key);
  if (!v) views.set(key, (v = visibilityPolygon(at, radius, blockingSegments(structures))));
  return v;
}
/** A view (grid units) in scene pixels. */
export const inScene = (poly: Point[], x0: number, y0: number, size: number) => poly.map((p) => ({ x: x0 + p.x * size, y: y0 + p.y * size }));

/** How many grid cells tall a side-on token stands: the level's figure height for 1.8 m, scaled by the creature's height. */
export const figureCells = (figureHeight: number, t: { height: number }) => (figureHeight * (t.height || 1.8)) / 1.8;

export const cellToRect = (state: MapState, w: number, h: number, c: CellRect) => {
  const { x0, y0, size } = gridOrigin(state, w, h);
  return { x: x0 + c.col * size, y: y0 + c.row * size, w: c.cols * size, h: c.rows * size };
};

/** How each layer draws itself. Layers without an entry have nothing to draw yet. */
/** A semi-transparent skull over a downed token: cranium, jaw and two dark eye sockets, sized to the token. */
export function drawSkull(ctx: CanvasRenderingContext2D, cx: number, cy: number, rad: number) {
  const s = rad * 0.75;
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#f3f4f6";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.12, s * 0.62, Math.PI * 0.85, Math.PI * 2.15); // cranium
  ctx.lineTo(cx + s * 0.38, cy + s * 0.55); // jaw
  ctx.lineTo(cx - s * 0.38, cy + s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111827";
  for (const dx of [-0.25, 0.25]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * s, cy - s * 0.05, s * 0.16, s * 0.19, 0, 0, Math.PI * 2); // eye sockets
    ctx.fill();
  }
  ctx.beginPath(); // nose
  ctx.moveTo(cx, cy + s * 0.12);
  ctx.lineTo(cx - s * 0.07, cy + s * 0.26);
  ctx.lineTo(cx + s * 0.07, cy + s * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.05; // teeth
  ctx.strokeStyle = "#111827";
  for (const dx of [-0.18, 0, 0.18]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * s, cy + s * 0.38);
    ctx.lineTo(cx + dx * s, cy + s * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

/** Press-and-hold time before a ping, and how long a ping shows (ms). */
export const HOLD_MS = 500;
/** How long the GM holds on a token before it lifts, to be moved. */
export const LIFT_MS = 350;
export const PING_MS = 3000;
export const FX_MS = 1000; // how long a script's effect plays

/** How far characters see (grid units): as far as walls allow. */
export const SIGHT = 500;

/** Layers only the GM ever sees. */
export const GM_ONLY_LAYERS: MapLayer[] = ["notes", "controls", "sounds"];

export const LAYER_RENDERERS: Partial<Record<MapLayer, (state: MapState) => Draw>> = {
  base: () => (ctx, w, h) => {
    ctx.fillStyle = "#15191e";
    ctx.fillRect(0, 0, w, h);
  },
  background: ({ background, backgroundImage: img }) => (ctx, w, h) => {
    if (background.mode === "color" || !img) {
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, w, h);
    } else if (background.fit === "tile") {
      ctx.fillStyle = ctx.createPattern(img, "repeat")!;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
  },
  tiles: (state) => (ctx, w, h) => {
    for (const t of state.tiles) {
      const img = state.tileImages.get(t.url);
      const r = cellToRect(state, w, h, t);
      if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }
  },
  structure: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    ctx.save();
    ctx.lineCap = "round";
    for (const s of state.structures) {
      if ((s.kind === "wall" || s.kind === "window") && !state.showWalls) continue; // GM only (windows are drawn on the map art)
      if (s.kind === "staircase") {
        const r = cellToRect(state, w, h, { col: s.x1, row: s.y1, cols: 1, rows: 1 });
        ctx.fillStyle = "rgba(17,24,39,0.7)";
        ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) {
          const y = r.y + (r.h * i) / 4;
          ctx.beginPath();
          ctx.moveTo(r.x + r.w * 0.2, y);
          ctx.lineTo(r.x + r.w * 0.8, y);
          ctx.stroke();
        }
        ctx.fillStyle = "#e5e7eb";
        ctx.font = `${Math.max(9, size / 6)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(s.target_name ?? "?", r.x + r.w / 2, r.y + r.h - 4);
      } else if (s.kind === "stairs") {
        // A flight: treads and risers from one end to the other, about four steps per cell across.
        const [top, bottom] = s.y1 <= s.y2 ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] : [{ x: s.x2, y: s.y2 }, { x: s.x1, y: s.y1 }];
        const steps = Math.max(2, Math.round(Math.abs(bottom.x - top.x) * 4));
        const dx = ((bottom.x - top.x) / steps) * size, dy = ((bottom.y - top.y) / steps) * size;
        ctx.strokeStyle = STRUCTURE_STYLES.stairs.color;
        ctx.lineWidth = STRUCTURE_STYLES.stairs.width;
        ctx.lineJoin = "miter";
        ctx.beginPath();
        let px = x0 + top.x * size, py = y0 + top.y * size;
        ctx.moveTo(px, py);
        for (let i = 0; i < steps; i++) {
          ctx.lineTo((px += dx), py);
          ctx.lineTo(px, (py += dy));
        }
        ctx.stroke();
      } else {
        const style = STRUCTURE_STYLES[s.kind];
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;
        ctx.setLineDash(s.kind === "door" && s.open ? [style.width, style.width * 1.5] : []); // open doors are dashed
        ctx.globalAlpha = s.kind === "door" && s.open ? 0.6 : 1;
        ctx.beginPath();
        ctx.moveTo(x0 + s.x1 * size, y0 + s.y1 * size);
        ctx.lineTo(x0 + s.x2 * size, y0 + s.y2 * size);
        ctx.stroke();
        if (s.kind === "door" && s.locked && state.showWalls) {
          // GM only: a padlock dot at the middle of a locked door.
          const mx = x0 + ((s.x1 + s.x2) / 2) * size, my = y0 + ((s.y1 + s.y2) / 2) * size;
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#facc15";
          ctx.beginPath();
          ctx.arc(mx, my, style.width, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  },
  // Global illumination: darken everything below by (1 - illumination), across the whole visible area.
  // GM-only yellow sticky notes: fixed width, growing taller to fit their text, with a folded corner.
  // Animated effects, in the order added: whole-map ones fill the scene, placed ones fill their circle.
  effects: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    for (const e of state.effects) {
      if (!e.enabled) continue; // switched off
      const placed = e.x !== null && e.y !== null && e.w !== null && e.h !== null;
      const area = placed
        ? { x: x0 + e.x! * size, y: y0 + e.y! * size, w: e.w! * size, h: e.h! * size, placed: true }
        : { x: 0, y: 0, w, h, placed: false };
      drawEffect(ctx, e.kind, area, e.intensity, state.time, size);
      if (placed && state.showEffectAreas) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(167,139,250,0.6)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(area.x, area.y, area.w, area.h);
        ctx.restore();
      }
    }
    // Lasting areas left by actions (a fire wall), kept out from behind walls.
    const toPx = (p: Point) => ({ x: x0 + p.x * size, y: y0 + p.y * size });
    for (const l of state.lasting) {
      const clip = inScene(viewPast(state.structures, l.area.origin, l.area.size * 1.05), x0, y0, size); // a little beyond its edge
      drawLasting(ctx, l, toPx, size, state.time, clip);
    }
  },
  // Traps: dashed while hidden from players, solid once found.
  traps: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    for (const t of state.traps) drawTrap(ctx, t.area, (x, y) => ({ x: x0 + x * size, y: y0 + y * size }), size, { found: !!t.found, label: t.name });
  },
  // Secrets: the GM sees every one (a dashed ring with "?", solid with "!" once revealed); players get only revealed ones.
  secrets: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    for (const s of state.secrets) {
      const x = x0 + s.x * size, y = y0 + s.y * size, r = size * 0.28;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.revealed ? "rgba(245,158,11,0.9)" : "rgba(168,85,247,0.25)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.strokeStyle = s.revealed ? "#fde68a" : "#c084fc";
      if (!s.revealed) ctx.setLineDash([size * 0.08, size * 0.06]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = s.revealed ? "#1f2937" : "#e9d5ff";
      ctx.font = `bold ${r * 1.2}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.revealed ? "!" : "?", x, y + r * 0.05);
      // A short label under it, scaled to the grid (long discovery titles are cut).
      const label = s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name;
      ctx.font = `${size * 0.18}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineWidth = size * 0.03;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(label, x, y + r * 1.15);
      ctx.fillStyle = "#f9fafb";
      ctx.fillText(label, x, y + r * 1.15);
      ctx.restore();
    }
  },
  notes: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    for (const n of state.notes) {
      const x = x0 + n.x * size, y = y0 + n.y * size;
      const { width: side, height, pad, fold, fontSize, lines } = noteLayout(ctx, n, size);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + side, y);
      ctx.lineTo(x + side, y + height - fold);
      ctx.lineTo(x + side - fold, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(x + side, y + height - fold);
      ctx.lineTo(x + side - fold, y + height - fold);
      ctx.lineTo(x + side - fold, y + height);
      ctx.closePath();
      ctx.fill();
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = "#1f2937";
      ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * fontSize * 1.2));
      ctx.restore();
    }
  },
  // Global illumination darkens everything below; light sources cut lit areas out of that darkness.
  // Flickering lights vary their reach a little on every redraw.
  lighting: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    const darkness = 1 - state.illumination;
    // Flicker: each frame a flickering light gets one random draw that moves its range and its strength
    // together (a flare reaches further and burns brighter), shared by the darkness cut-out and the warm overlay.
    const flicker = new Map(
      state.lights.map((l) => {
        const u = Math.random();
        return [l, l.flicker ? { range: 0.85 + 0.2 * u, strength: 0.55 + 0.45 * u } : { range: 1, strength: 1 }];
      })
    );
    const light = (l: LightSource) => {
      const cx = x0 + l.x * size, cy = y0 + l.y * size;
      const { range, strength } = flicker.get(l)!;
      const r = l.radius * size * range;
      const half = (l.spread * Math.PI) / 360, dir = (l.angle * Math.PI) / 180;
      const seen = inScene(viewPast(state.structures, { x: l.x, y: l.y }, l.radius * 1.05), x0, y0, size); // walls and closed doors block light; at its furthest flicker (the arc below trims it)
      return {
        cx, cy, r, strength,
        // The light's shape (circle or cone), clipped to what it can see past walls.
        path: (c: CanvasRenderingContext2D) => {
          c.beginPath();
          seen.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
          c.closePath();
          c.clip();
          c.beginPath();
          if (l.kind === "point" || l.spread >= 360) c.arc(cx, cy, r, 0, Math.PI * 2);
          else { c.moveTo(cx, cy); c.arc(cx, cy, r, dir - half, dir + half); c.closePath(); }
        },
      };
    };
    if (darkness > 0) {
      const off = document.createElement("canvas");
      off.width = ctx.canvas.width;
      off.height = ctx.canvas.height;
      const o = off.getContext("2d")!;
      o.fillStyle = `rgba(0,0,0,${darkness})`;
      o.fillRect(0, 0, off.width, off.height);
      o.setTransform(ctx.getTransform());
      o.globalCompositeOperation = "destination-out";
      for (const l of state.lights) {
        if (!l.enabled) continue; // switched off: no light
        const { cx, cy, r, strength, path } = light(l);
        const g = o.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(0,0,0,${strength})`);
        g.addColorStop(0.6, `rgba(0,0,0,${0.8 * strength})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        o.save();
        o.fillStyle = g;
        path(o);
        o.fill();
        o.restore();
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }
    // Warm overlay marking each light's area of effect, plus a bulb icon.
    for (const l of state.lights) {
      const { cx, cy, r, strength, path } = light(l);
      ctx.save();
      path(ctx);
      if (!l.enabled) ctx.globalAlpha = 0; // switched off: no glow (its bulb still shows while editing)
      // Warm glow fading out towards the edge of the light's range (no hard edge).
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, `rgba(253,224,71,${0.2 * strength})`);
      glow.addColorStop(0.5, `rgba(253,224,71,${0.1 * strength})`);
      glow.addColorStop(1, "rgba(253,224,71,0)");
      ctx.fillStyle = glow;
      ctx.fill();
      if (state.showLightAreas) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(253,224,71,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
      if (state.showLightAreas) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = l.enabled ? "#facc15" : "#6b7280"; // grey bulb = switched off
        ctx.fill();
        ctx.restore();
      }
    }
  },
  // Positional sounds: a speaker icon with a faint circle showing the effective range.
  sounds: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    for (const p of state.positional) {
      const cx = x0 + p.x * size, cy = y0 + p.y * size;
      const heard = inScene(viewPast(state.structures, { x: p.x, y: p.y }, p.radius), x0, y0, size); // like light, cut off by walls and closed doors
      ctx.save();
      ctx.beginPath();
      heard.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(16,185,129,0.10)";
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(16,185,129,0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = "#065f46";
      ctx.fill();
      ctx.fillStyle = "#ecfdf5";
      ctx.font = `${size * 0.26}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("♪", cx, cy);
      ctx.restore();
    }
  },
  // Round token per creature/character, filling its cell: portrait if there is one, otherwise the initial.
  tokens: (state) => (ctx, w, h) => {
    for (const t of state.tokens) {
      const r = cellToRect(state, w, h, { col: t.col, row: t.row, cols: 1, rows: 1 });
      // Picked up to move: raised a little and larger, over its own shadow.
      const up = state.lifted === t.id;
      if (up) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.filter = `blur(${Math.max(2, r.w * 0.08)}px)`;
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2 + r.w * 0.06, r.y + r.h / 2 + r.h * 0.12, r.w * 0.44, r.h * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2 - (up ? r.h * 0.12 : 0), rad = r.w * (up ? 0.5 : 0.42);
      // Side-on maps show the side-on figure standing on its floor, scaled to fit the cell.
      const side = state.mapImage.perspective === "portrait" && t.token_side ? state.tokenImages.get(t.token_side) : undefined;
      if (side) {
        // Drawn to scale: a 1.8 m figure is figureHeight cells tall; others by their height. Feet on the floor, centred on the column.
        const dh = figureCells(state.figureHeight, t) * r.h;
        const dw = (side.naturalWidth / side.naturalHeight) * dh;
        ctx.drawImage(side, r.x + (r.w - dw) / 2, r.y + r.h - dh, dw, dh);
        if (state.down.has(t.id)) drawSkull(ctx, cx, r.y + r.h - dh / 2, rad);
        continue;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = t.character_id ? "#1d4ed8" : "#7f1d1d";
      ctx.fill();
      // From above: the overhead token, else the portrait cropped to a circle.
      const art = (state.mapImage.perspective === "portrait" ? null : t.token_overhead) ?? t.image;
      const img = art ? state.tokenImages.get(art) : undefined;
      if (img) {
        ctx.clip();
        ctx.drawImage(img, cx - rad, cy - rad, rad * 2, rad * 2);
      } else {
        ctx.fillStyle = "#f9fafb";
        ctx.font = `bold ${rad}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.name[0]?.toUpperCase() ?? "?", cx, cy);
      }
      ctx.restore();
      if (state.down.has(t.id)) drawSkull(ctx, cx, cy, rad);
    }
  },
  map: (state) => (ctx, w, h) => {
    const r = mapRect(state, w, h);
    if (r && state.mapImageEl) ctx.drawImage(state.mapImageEl, r.x, r.y, r.w, r.h);
  },
  // Over the map image (or the padded region when there's no image yet): squares for overhead maps,
  // columns (horizontal movement distance) for portrait maps, nothing for scenic maps.
  grid: (state) => (ctx, w, h) => {
    const perspective = state.mapImage.perspective;
    if (perspective === "scenic" || state.grid.gridless) return;
    const { size, color, offsetX, offsetY } = state.grid;
    const first = (start: number, offset: number) => start + (((offset % size) + size) % size);
    const p = state.background.padding;
    const r = mapRect(state, w, h) ?? { x: p.left, y: p.top, w: w - p.left - p.right, h: h - p.top - p.bottom };
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = first(r.x, offsetX); x <= r.x + r.w + 0.5; x += size) { ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); }
    if (perspective === "overhead") {
      for (let y = first(r.y, offsetY); y <= r.y + r.h + 0.5; y += size) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
    }
    ctx.stroke();
    ctx.restore();
  },
};
