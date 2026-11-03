"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { MAP_LAYERS, STRUCTURE_STYLES, type MapBackground, type MapGrid, type MapImage, type MapLayer, type TemplateColors } from "@/lib/maps";
import TemplatesEditor from "./TemplatesEditor";
import TilesEditor from "./TilesEditor";
import { blockingSegments, visibilityPolygon, type Segment } from "@/lib/visibility";
import { landingRow, snapHeight } from "@/lib/gravity";
import type { MapEffect, AmbientSound, Asset, LightSource, MapControl, MapNote, MapStructure, MapTile, MapToken, PositionalSound } from "@/lib/db";
import SoundsEditor, { type PositionalTool } from "./SoundsEditor";
import LightingEditor, { type LightTool } from "./LightingEditor";
import NotesEditor from "./NotesEditor";
import EffectsEditor, { type EffectTool } from "./EffectsEditor";
import { drawEffect } from "@/lib/effects";
import ControlsEditor from "./ControlsEditor";
import GameIcon from "./GameIcon";
import TokensEditor, { type TokenCreature } from "./TokensEditor";
import StructureEditor, { type StructureTool } from "./StructureEditor";
import GridEditor from "./GridEditor";
import BackgroundEditor from "./BackgroundEditor";
import MapImageEditor from "./MapImageEditor";
import { moveEffectTo, placeEffect, changeEffectIntensity, removeEffect, movePositionalSoundTo, changeFigureHeight, placeCharacterTokenAt, runControl, changeNoteSize, editNote, placeNote, removeNote, toggleDoor, changeIllumination, placeLight, removeLight, placePositionalSound, moveTileTo, moveTokenTo, placeCreatureToken, placeStructure, placeTile, removeStructure, removeTile, removeToken, toggleLayer } from "../actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/** Everything layers draw from: the location's settings plus any images already loaded. */
interface MapState {
  background: MapBackground;
  backgroundImage: HTMLImageElement | null;
  mapImage: MapImage;
  mapImageEl: HTMLImageElement | null;
  grid: MapGrid;
  tiles: MapTile[];
  tileImages: Map<string, HTMLImageElement>;
  structures: MapStructure[];
  tokens: MapToken[];
  tokenImages: Map<string, HTMLImageElement>;
  positional: PositionalSound[];
  illumination: number;
  figureHeight: number; // portrait maps: grid cells a 1.8 m figure stands
  lights: LightSource[];
  showLightAreas: boolean; // outline each light's area (while editing lighting)
  notes: MapNote[];
  effects: MapEffect[];
  time: number; // seconds, drives animated effects
  showEffectAreas: boolean; // outline placed effects (while editing effects)
}

type CellRect = { col: number; row: number; cols: number; rows: number };

/** Loads an image URL into an element (null until loaded, or when there's no URL). */
function useImage(url: string | null): HTMLImageElement | null {
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
function mapRect({ background: { padding: p }, mapImageEl: img }: MapState, w: number, h: number) {
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
function noteLayout(ctx: CanvasRenderingContext2D, note: Pick<MapNote, "text" | "w" | "h">, size: number) {
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
const SCENE = { w: 1408, h: 792 };

/** How the scene is scaled (s) and centred (ox, oy) to fit a canvas of this CSS size. */
function fitScene(w: number, h: number) {
  const s = Math.min(w / SCENE.w, h / SCENE.h) || 1;
  return { s, ox: (w - SCENE.w * s) / 2, oy: (h - SCENE.h * s) / 2 };
}

/** Grid cell geometry: top-left of cell (0,0) and the cell size, in map space. */
function gridOrigin(state: MapState, w: number, h: number) {
  const { size, offsetX, offsetY } = state.grid;
  const p = state.background.padding;
  const r = mapRect(state, w, h) ?? { x: p.left, y: p.top, w: w - p.left - p.right, h: h - p.top - p.bottom };
  const first = (start: number, offset: number) => start + (((offset % size) + size) % size);
  return { x0: first(r.x, offsetX), y0: first(r.y, offsetY), size };
}

/** Walls and closed doors as segments in scene space (they block light and sound). */
const blockersInScene = (state: MapState, x0: number, y0: number, size: number): Segment[] =>
  blockingSegments(state.structures).map(({ a, b }) => ({ a: { x: x0 + a.x * size, y: y0 + a.y * size }, b: { x: x0 + b.x * size, y: y0 + b.y * size } }));

/** How many grid cells tall a side-on token stands: the level's figure height for 1.8 m, scaled by the creature's height. */
const figureCells = (figureHeight: number, t: { height: number }) => (figureHeight * (t.height || 1.8)) / 1.8;

const cellToRect = (state: MapState, w: number, h: number, c: CellRect) => {
  const { x0, y0, size } = gridOrigin(state, w, h);
  return { x: x0 + c.col * size, y: y0 + c.row * size, w: c.cols * size, h: c.rows * size };
};

/** How each layer draws itself. Layers without an entry have nothing to draw yet. */
const LAYER_RENDERERS: Partial<Record<MapLayer, (state: MapState) => Draw>> = {
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
    // Walls and closed doors block light.
    const blockers = blockersInScene(state, x0, y0, size);
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
      const seen = visibilityPolygon({ x: cx, y: cy }, r, blockers);
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
        ctx.fillStyle = "#facc15";
        ctx.fill();
        ctx.restore();
      }
    }
  },
  // Positional sounds: a speaker icon with a faint circle showing the effective range.
  sounds: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    // Like light, a positional sound's range is cut off by walls and closed doors.
    const blockers = blockersInScene(state, x0, y0, size);
    for (const p of state.positional) {
      const cx = x0 + p.x * size, cy = y0 + p.y * size;
      const heard = visibilityPolygon({ x: cx, y: cy }, p.radius * size, blockers);
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
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = r.w * 0.42;
      // Side-on maps show the side-on figure standing on its floor, scaled to fit the cell.
      const side = state.mapImage.perspective === "portrait" && t.token_side ? state.tokenImages.get(t.token_side) : undefined;
      if (side) {
        // Drawn to scale: a 1.8 m figure is figureHeight cells tall; others by their height. Feet on the floor, centred on the column.
        const dh = figureCells(state.figureHeight, t) * r.h;
        const dw = (side.naturalWidth / side.naturalHeight) * dh;
        ctx.drawImage(side, r.x + (r.w - dw) / 2, r.y + r.h - dh, dw, dh);
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
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = t.character_id ? "#93c5fd" : "#fca5a5";
      ctx.stroke();
      ctx.restore();
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
    if (perspective === "scenic") return;
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

/**
 * The location's map, drawn on a single canvas layer by layer (base first, controls last),
 * with a panel to show or hide each layer. Layer contents come later.
 */
export default function MapView({
  locationId,
  levelId,
  hidden,
  background,
  mapImage,
  grid,
  templateColors,
  tileAssets,
  tiles,
  structures,
  otherLevels,
  tokens,
  creatures,
  sounds,
  audioAssets,
  positional,
  illumination,
  figureHeight,
  lights,
  notes,
  effects,
  controls,
}: {
  locationId: number;
  levelId: number;
  hidden: MapLayer[];
  background: MapBackground;
  mapImage: MapImage;
  grid: MapGrid;
  templateColors: TemplateColors;
  tileAssets: Asset[];
  tiles: MapTile[];
  structures: MapStructure[];
  otherLevels: { id: number; name: string }[];
  tokens: MapToken[];
  creatures: TokenCreature[];
  sounds: AmbientSound[];
  audioAssets: Asset[];
  positional: PositionalSound[];
  illumination: number;
  figureHeight: number;
  lights: LightSource[];
  notes: MapNote[];
  effects: MapEffect[];
  controls: MapControl[];
}) {
  const [, startTransition] = useTransition();
  /** What the last clicked control button's script returned. */
  const [controlResult, setControlResult] = useState<{ label: string; ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<MapLayer | null>(null); // layer whose editor is open
  const [hiddenSet, setHidden] = useOptimistic(new Set(hidden), (set: Set<MapLayer>, [layer, visible]: [MapLayer, boolean]) => {
    const next = new Set(set);
    if (visible) next.delete(layer);
    else next.add(layer);
    return next;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const backgroundImage = useImage(background.mode === "texture" ? background.image : null);
  const mapImageEl = useImage(mapImage.image);

  // Tile images, loaded once per URL; bump a counter to redraw as each arrives.
  const tileImages = useRef(new Map<string, HTMLImageElement>()).current;
  const [, setLoaded] = useState(0);
  useEffect(() => {
    const tokenArt = tokens.flatMap((t) => [t.image, t.token_overhead, t.token_side].filter((u): u is string => !!u));
    for (const url of new Set([...tiles.map((t) => t.url), ...tokenArt])) {
      if (tileImages.has(url)) continue;
      const img = new Image();
      img.onload = () => setLoaded((n) => n + 1);
      img.src = url;
      tileImages.set(url, img);
    }
  }, [tiles, tokens, tileImages]);
  const loadedTileImages = new Map([...tileImages].filter(([, img]) => img.complete && img.naturalWidth > 0));

  // Tile placement: with the Tiles layer selected and an asset chosen, left click / drag covers grid cells.
  const [tileAsset, setTileAsset] = useState<Asset | null>(null);
  const [placing, setPlacing] = useState<{ start: { col: number; row: number }; end: { col: number; row: number } } | null>(null);
  type TileChange = { add: MapTile } | { move: { id: number; col: number; row: number } } | { remove: number };
  const [optimisticTiles, changeTiles] = useOptimistic(tiles, (ts: MapTile[], c: TileChange) =>
    "add" in c
      ? [...ts, c.add]
      : "move" in c
        ? ts.map((t) => (t.id === c.move.id ? { ...t, col: c.move.col, row: c.move.row } : t))
        : ts.filter((t) => t.id !== c.remove)
  );
  // A placed tile picked in the editor: highlighted on the map, draggable to move.
  const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
  const [moving, setMoving] = useState<{ grab: { col: number; row: number }; delta: { col: number; row: number } } | null>(null);
  const selectedTile = optimisticTiles.find((t) => t.id === selectedTileId) ?? null;
  // While moving, draw the selected tile at its dragged position.
  const drawnTiles = moving
    ? optimisticTiles.map((t) => (t.id === selectedTileId ? { ...t, col: t.col + moving.delta.col, row: t.row + moving.delta.row } : t))
    : optimisticTiles;
  // Structure placement: lines between grid corners, or a staircase in a cell.
  const [structureTool, setStructureTool] = useState<StructureTool>({ kind: "wall", targetLevelId: otherLevels[0]?.id ?? null });
  const [drawingLine, setDrawingLine] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState<number | null>(null);
  type StructureChange = { add: MapStructure } | { remove: number };
  const [optimisticStructures, changeStructures] = useOptimistic(structures, (ss: MapStructure[], c: StructureChange) =>
    "add" in c ? [...ss, c.add] : ss.filter((s) => s.id !== c.remove)
  );
  /** On portrait maps a placed token drops to the floor below (the server does the same). */
  const portrait = mapImage.perspective === "portrait";
  const settle = (col: number, row: number) => (portrait ? landingRow(optimisticStructures, col, row) : row);

  // Token placement: pick a creature, then click a cell.
  const [tokenCreature, setTokenCreature] = useState<TokenCreature | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  type TokenChange = { add: MapToken } | { move: { id: number; col: number; row: number } } | { remove: number };
  const [optimisticTokens, changeTokens] = useOptimistic(tokens, (ts: MapToken[], c: TokenChange) =>
    "add" in c
      ? [...ts, c.add]
      : "move" in c
        ? ts.map((t) => (t.id === c.move.id ? { ...t, col: c.move.col, row: c.move.row } : t))
        : ts.filter((t) => t.id !== c.remove)
  );
  // Dragging a token: which one, and the cell it's currently over.
  const [draggingToken, setDraggingToken] = useState<{ id: number; col: number; row: number } | null>(null);
  const drawnTokens = draggingToken
    ? optimisticTokens.map((t) => (t.id === draggingToken.id ? { ...t, col: draggingToken.col, row: draggingToken.row } : t))
    : optimisticTokens;

  // Positional sound placement: choose audio + range, then click the map (snaps to the cell centre).
  const [positionalTool, setPositionalTool] = useState<PositionalTool>({ asset: null, radius: 3 });
  const [selectedPositionalId, setSelectedPositionalId] = useState<number | null>(null);
  type PositionalChange = { add: PositionalSound } | { move: { id: number; x: number; y: number } };
  const [optimisticPositional, changePositional] = useOptimistic(positional, (ps: PositionalSound[], c: PositionalChange) =>
    "add" in c ? [...ps, c.add] : ps.map((p) => (p.id === c.move.id ? { ...p, x: c.move.x, y: c.move.y } : p))
  );
  // Dragging a positional sound: which one, and the cell centre it's currently over.
  const [draggingSound, setDraggingSound] = useState<{ id: number; x: number; y: number } | null>(null);
  const drawnPositional = draggingSound
    ? optimisticPositional.map((p) => (p.id === draggingSound.id ? { ...p, x: draggingSound.x, y: draggingSound.y } : p))
    : optimisticPositional;

  // Illumination being previewed in the lighting editor (null = use the saved level).
  const [previewIllumination, setPreviewIllumination] = useState<number | null>(null);
  // Keep showing the previewed value until the saved value catches up, so the slider never jumps back.
  useEffect(() => {
    if (previewIllumination !== null && Math.abs(previewIllumination - illumination) < 1e-6) setPreviewIllumination(null);
  }, [illumination, previewIllumination]);
  const shownIllumination = previewIllumination ?? illumination;

  // Light source placement: choose kind/range/direction/flicker, then click the map (snaps to the cell centre).
  const [lightTool, setLightTool] = useState<LightTool>({ kind: "point", radius: 4, angle: 0, spread: 60, flicker: false });
  const [selectedLightId, setSelectedLightId] = useState<number | null>(null);
  type LightChange = { add: LightSource } | { remove: number };
  const [optimisticLights, changeLights] = useOptimistic(lights, (ls: LightSource[], c: LightChange) =>
    "add" in c ? [...ls, c.add] : ls.filter((l) => l.id !== c.remove)
  );
  // Animate: ~25 frames a second while effects are showing, ~8 while any light flickers.
  const [, setFlickerTick] = useState(0);
  const anyFlicker = optimisticLights.some((l) => l.flicker) && !hiddenSet.has("lighting");
  const anyEffect = effects.length > 0 && !hiddenSet.has("effects");
  // Placed effects, with moves shown straight away (optimistic) and the one being dragged offset by the drag.
  const [optimisticEffects, moveEffectLocally] = useOptimistic(effects, (es: MapEffect[], m: { id: number; x: number; y: number }) =>
    es.map((e) => (e.id === m.id ? { ...e, x: m.x, y: m.y } : e))
  );
  const [draggingEffect, setDraggingEffect] = useState<{ id: number; grab: { x: number; y: number }; dx: number; dy: number } | null>(null);
  const drawnEffects = draggingEffect
    ? optimisticEffects.map((e) => (e.id === draggingEffect.id ? { ...e, x: e.x! + draggingEffect.dx, y: e.y! + draggingEffect.dy } : e))
    : optimisticEffects;
  const frameMs = anyEffect ? 40 : anyFlicker ? 120 : 0;
  useEffect(() => {
    if (!frameMs) return;
    const t = setInterval(() => setFlickerTick((n) => n + 1), frameMs);
    return () => clearInterval(t);
  }, [frameMs]);

  // Effects: choose a built-in effect, then add it to the whole map or click to place it.
  const [effectTool, setEffectTool] = useState<EffectTool>({ kind: "rain", intensity: 0.5, wholeMap: true });
  // Dragging out a placed effect's area, corner to corner, in grid units.
  const [effectDrag, setEffectDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const quarter = (v: number) => Math.round(v * 4) / 4;
  const effectRect = (d: NonNullable<typeof effectDrag>) => ({
    x: Math.min(d.start.x, d.end.x),
    y: Math.min(d.start.y, d.end.y),
    w: Math.abs(d.end.x - d.start.x),
    h: Math.abs(d.end.y - d.start.y),
  });

  // Note placement: write the note, then click the map; the note's corner goes where you click.
  const [noteDraft, setNoteDraft] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  type NoteChange = { add: MapNote } | { resize: { id: number; w: number; h: number } } | { remove: number };
  const [optimisticNotes, changeNotes] = useOptimistic(notes, (ns: MapNote[], c: NoteChange) =>
    "add" in c
      ? [...ns, c.add]
      : "resize" in c
        ? ns.map((n) => (n.id === c.resize.id ? { ...n, w: c.resize.w, h: c.resize.h } : n))
        : ns.filter((n) => n.id !== c.remove)
  );
  // Resizing a note by dragging its folded corner: live size in grid cells.
  const [resizingNote, setResizingNote] = useState<{ id: number; w: number; h: number } | null>(null);
  const drawnNotes = resizingNote
    ? optimisticNotes.map((n) => (n.id === resizingNote.id ? { ...n, w: resizingNote.w, h: resizingNote.h } : n))
    : optimisticNotes;

  const state: MapState = {
    background, backgroundImage, mapImage, mapImageEl, grid,
    tiles: drawnTiles, tileImages: loadedTileImages, structures: optimisticStructures,
    tokens: drawnTokens, tokenImages: loadedTileImages, positional: drawnPositional, illumination: shownIllumination, figureHeight,
    lights: optimisticLights, showLightAreas: selected === "lighting", notes: drawnNotes,
    effects: drawnEffects, time: performance.now() / 1000, showEffectAreas: selected === "effects",
  };

  /** Pointer position in grid units (fractional), accounting for zoom and pan. */
  function gridAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fit = fitScene(rect.width, rect.height);
    const mx = ((e.clientX - rect.left - view.x) / view.zoom - fit.ox) / fit.s;
    const my = ((e.clientY - rect.top - view.y) / view.zoom - fit.oy) / fit.s;
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    return { gx: (mx - x0) / size, gy: (my - y0) / size };
  }
  /** Grid cell under the pointer. */
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return { col: Math.floor(gx), row: Math.floor(gy) };
  };
  /** Nearest grid corner to the pointer. On portrait maps only across: heights follow the pointer. */
  const cornerAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return { x: Math.round(gx), y: portrait ? snapHeight(gy) : Math.round(gy) };
  };
  /** Where a token under the pointer goes: its cell, or on portrait maps its column with the pointer at its middle. */
  const tokenAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return { col: Math.floor(gx), row: portrait ? snapHeight(gy - 0.5) : Math.floor(gy) };
  };

  const spanOf = (p: NonNullable<typeof placing>): CellRect => ({
    col: Math.min(p.start.col, p.end.col),
    row: Math.min(p.start.row, p.end.row),
    cols: Math.abs(p.end.col - p.start.col) + 1,
    rows: Math.abs(p.end.row - p.start.row) + 1,
  });
  // On the light selected row a dark hover would hide the dark text, so darken the tint slightly instead.
  const hoverBg = (layer: MapLayer) => (selected === layer ? "hover:bg-black/15" : "hover:bg-base-300");

  // View transform: zoom about a point and pan. The map is drawn in "map space" (the canvas size at zoom 1).
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  // Focus: hides the campaign menu (and trims page padding) while the map is open, via a data-focus flag on <html>.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-focus", focus);
    return () => document.documentElement.removeAttribute("data-focus");
  }, [focus]);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Wheel zooms around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const zoom = Math.min(8, Math.max(0.25, v.zoom * Math.exp(-e.deltaY * 0.0015)));
        const k = zoom / v.zoom;
        return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Right-button drag pans (left clicks are kept free for layer editing tools).
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && selected === "notes") {
      // Grabbing a note's folded corner resizes it (topmost note first).
      const { gx, gy } = gridAt(e);
      const corner = [...optimisticNotes].reverse().find((n) => {
        const ctx = e.currentTarget.getContext("2d")!;
        const size = gridOrigin(state, SCENE.w, SCENE.h).size;
        const { width, height } = noteLayout(ctx, n, size);
        const right = n.x + width / size, bottom = n.y + height / size;
        return gx >= right - 0.35 && gx <= right + 0.1 && gy >= bottom - 0.35 && gy <= bottom + 0.1;
      });
      if (corner) {
        setSelectedNoteId(corner.id);
        setResizingNote({ id: corner.id, w: corner.w, h: corner.h });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const text = noteDraft.trim();
      if (!text) return;
      setNoteDraft("");
      startTransition(async () => {
        changeNotes({ add: { id: -Date.now(), x: gx, y: gy, w: 1.6, h: 1.6, text } });
        await placeNote(locationId, levelId, gx, gy, text);
      });
      return;
    }
    if (e.button === 0 && selected === "lighting") {
      const { col, row } = cellAt(e);
      const t = lightTool;
      const placed = { kind: t.kind, x: col + 0.5, y: row + 0.5, radius: t.radius, angle: t.angle, spread: t.spread, flicker: t.flicker };
      startTransition(async () => {
        changeLights({ add: { id: -Date.now(), ...placed, flicker: placed.flicker ? 1 : 0 } });
        await placeLight(locationId, levelId, placed);
      });
      return;
    }
    if (e.button === 0 && selected === "effects") {
      const { gx, gy } = gridAt(e);
      // Pressing inside a placed effect (topmost first) picks it up to move it.
      const hit = [...optimisticEffects].reverse().find(
        (f) => f.w !== null && f.h !== null && gx >= f.x! && gx <= f.x! + f.w && gy >= f.y! && gy <= f.y! + f.h
      );
      if (hit) {
        setDraggingEffect({ id: hit.id, grab: { x: gx, y: gy }, dx: 0, dy: 0 });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (effectTool.wholeMap) return;
      const corner = { x: quarter(gx), y: quarter(gy) };
      setEffectDrag({ start: corner, end: corner });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && selected === "sounds") {
      // Pressing on a sound's marker picks it up to move it; otherwise place the chosen audio.
      const { gx, gy } = gridAt(e);
      const hit = [...optimisticPositional].reverse().find((p) => Math.hypot(p.x - gx, p.y - gy) <= 0.35);
      if (hit) {
        setSelectedPositionalId(hit.id);
        setDraggingSound({ id: hit.id, x: hit.x, y: hit.y });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const a = positionalTool.asset;
      if (!a) return;
      const { col, row } = cellAt(e);
      const placed = { x: col + 0.5, y: row + 0.5, radius: positionalTool.radius };
      startTransition(async () => {
        changePositional({ add: { id: -Date.now(), asset_id: a.id, name: a.name, url: a.url, volume: 1, loop: 0, ...placed } });
        await placePositionalSound(locationId, levelId, a.id, placed.x, placed.y, placed.radius);
      });
      return;
    }
    if (e.button === 0 && selected === "tokens") {
      const { col, row } = tokenAt(e);
      // Pressing on a token picks it up (topmost first); otherwise place the chosen creature.
      const { gy } = gridAt(e);
      // A side-on figure can be taller than its cell: it can be grabbed anywhere up to the top of its head.
      const top = (t: MapToken) => (portrait && t.token_side ? t.row + 1 - Math.max(1, figureCells(figureHeight, t)) : t.row);
      const hit = [...optimisticTokens].reverse().find((t) => t.col === col && gy >= top(t) && gy < t.row + 1);
      if (hit) {
        setSelectedTokenId(hit.id);
        setDraggingToken({ id: hit.id, col: hit.col, row: hit.row });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (!tokenCreature) return;
      const c = tokenCreature;
      const character = c.kind === "character";
      startTransition(async () => {
        // A character appears once: placing it again moves it here.
        const existing = character ? optimisticTokens.find((t) => t.character_id === c.id) : undefined;
        if (existing) changeTokens({ remove: existing.id });
        changeTokens({
          add: {
            id: -Date.now(), creature_id: character ? null : c.id, character_id: character ? c.id : null, name: c.name, image: c.image,
            token_overhead: c.token_overhead, token_side: c.token_side, height: c.height, col, row: settle(col, row), hp: null,
          },
        });
        if (character) await placeCharacterTokenAt(locationId, levelId, c.id, col, row);
        else await placeCreatureToken(locationId, levelId, c.id, col, row);
      });
      return;
    }
    if (e.button === 0 && selected === "structure") {
      if (structureTool.kind === "staircase") {
        if (!structureTool.targetLevelId) return;
        const cell = cellAt(e);
        const target = otherLevels.find((l) => l.id === structureTool.targetLevelId)!;
        const piece = { kind: "staircase" as const, x1: cell.col, y1: cell.row, x2: cell.col, y2: cell.row, target_level_id: target.id };
        startTransition(async () => {
          changeStructures({ add: { id: -Date.now(), ...piece, target_name: target.name, open: 0 } });
          await placeStructure(locationId, levelId, piece);
        });
      } else {
        const corner = cornerAt(e);
        setDrawingLine({ start: corner, end: corner });
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (e.button === 0 && selected === "tiles" && selectedTile) {
      const cell = cellAt(e);
      const t = selectedTile;
      if (cell.col >= t.col && cell.col < t.col + t.cols && cell.row >= t.row && cell.row < t.row + t.rows) {
        setMoving({ grab: cell, delta: { col: 0, row: 0 } });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (e.button === 0 && selected === "tiles" && tileAsset) {
      const cell = cellAt(e);
      setPlacing({ start: cell, end: cell });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 2) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (resizingNote) {
      const n = optimisticNotes.find((x) => x.id === resizingNote.id)!;
      const { gx, gy } = gridAt(e);
      setResizingNote({ id: n.id, w: Math.max(0.6, gx - n.x), h: Math.max(0.6, gy - n.y) });
      return;
    }
    if (draggingEffect) {
      const { gx, gy } = gridAt(e);
      const dx = quarter(gx - draggingEffect.grab.x), dy = quarter(gy - draggingEffect.grab.y);
      if (dx !== draggingEffect.dx || dy !== draggingEffect.dy) setDraggingEffect({ ...draggingEffect, dx, dy });
      return;
    }
    if (effectDrag) {
      const { gx, gy } = gridAt(e);
      const end = { x: quarter(gx), y: quarter(gy) };
      if (end.x !== effectDrag.end.x || end.y !== effectDrag.end.y) setEffectDrag({ ...effectDrag, end });
      return;
    }
    if (draggingSound) {
      const { col, row } = cellAt(e);
      if (col + 0.5 !== draggingSound.x || row + 0.5 !== draggingSound.y) setDraggingSound({ ...draggingSound, x: col + 0.5, y: row + 0.5 });
      return;
    }
    if (draggingToken) {
      const { col, row } = tokenAt(e);
      if (col !== draggingToken.col || row !== draggingToken.row) setDraggingToken({ ...draggingToken, col, row });
      return;
    }
    if (drawingLine) {
      const corner = cornerAt(e);
      if (corner.x !== drawingLine.end.x || corner.y !== drawingLine.end.y) setDrawingLine({ ...drawingLine, end: corner });
      return;
    }
    if (moving) {
      const cell = cellAt(e);
      const delta = { col: cell.col - moving.grab.col, row: cell.row - moving.grab.row };
      if (delta.col !== moving.delta.col || delta.row !== moving.delta.row) setMoving({ ...moving, delta });
      return;
    }
    if (placing) {
      const cell = cellAt(e);
      if (cell.col !== placing.end.col || cell.row !== placing.end.row) setPlacing({ ...placing, end: cell });
      return;
    }
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
    if (resizingNote) {
      const r = resizingNote;
      setResizingNote(null);
      startTransition(async () => {
        changeNotes({ resize: r });
        await changeNoteSize(locationId, r.id, r.w, r.h);
      });
      return;
    }
    if (draggingEffect) {
      const { id, dx, dy } = draggingEffect;
      const before = optimisticEffects.find((f) => f.id === id);
      setDraggingEffect(null);
      if (before && (dx || dy)) {
        const to = { id, x: before.x! + dx, y: before.y! + dy };
        startTransition(async () => {
          moveEffectLocally(to);
          await moveEffectTo(locationId, id, to.x, to.y);
        });
      }
      return;
    }
    if (effectDrag) {
      const area = effectRect(effectDrag);
      setEffectDrag(null);
      if (area.w < 0.25 || area.h < 0.25) return; // a click without a drag places nothing
      const t = effectTool;
      startTransition(() => placeEffect(locationId, levelId, { kind: t.kind, ...area, intensity: t.intensity }));
      return;
    }
    if (draggingSound) {
      const { id, x, y } = draggingSound;
      const before = optimisticPositional.find((p) => p.id === id);
      setDraggingSound(null);
      if (before && (before.x !== x || before.y !== y)) {
        startTransition(async () => {
          changePositional({ move: { id, x, y } });
          await movePositionalSoundTo(locationId, id, x, y);
        });
      }
      return;
    }
    if (draggingToken) {
      const { id, col, row } = draggingToken;
      const before = optimisticTokens.find((t) => t.id === id);
      setDraggingToken(null);
      if (before && (before.col !== col || before.row !== row)) {
        startTransition(async () => {
          changeTokens({ move: { id, col, row: settle(col, row) } });
          await moveTokenTo(locationId, id, col, row);
        });
      }
      return;
    }
    if (drawingLine) {
      const { start, end } = drawingLine;
      setDrawingLine(null);
      if (start.x === end.x && start.y === end.y) return; // a click without a drag draws nothing
      // On portrait maps a nearly level wall, window or door is drawn level (a floor), so hand-drawn floors come out flat.
      const level = portrait && structureTool.kind !== "stairs" && start.x !== end.x && Math.abs(end.y - start.y) <= 0.25;
      const piece = { kind: structureTool.kind, x1: start.x, y1: start.y, x2: end.x, y2: level ? start.y : end.y, target_level_id: null };
      startTransition(async () => {
        changeStructures({ add: { id: -Date.now(), ...piece, target_name: null, open: 0 } });
        await placeStructure(locationId, levelId, piece);
      });
      return;
    }
    if (moving && selectedTile) {
      const { col, row } = { col: selectedTile.col + moving.delta.col, row: selectedTile.row + moving.delta.row };
      const id = selectedTile.id;
      setMoving(null);
      if (col !== selectedTile.col || row !== selectedTile.row) {
        startTransition(async () => {
          changeTiles({ move: { id, col, row } });
          await moveTileTo(locationId, id, col, row);
        });
      }
      return;
    }
    if (placing && tileAsset) {
      const span = spanOf(placing);
      setPlacing(null);
      startTransition(async () => {
        changeTiles({ add: { id: -Date.now(), asset_id: tileAsset.id, name: tileAsset.name, url: tileAsset.url, ...span } });
        await placeTile(locationId, levelId, { asset_id: tileAsset.id, ...span });
      });
    }
  };

  // Redraw every visible layer, bottom to top, whenever visibility, the view or the canvas size changes.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width === 0 || height === 0) return; // not laid out (e.g. while switching tabs)
      if (width !== canvasSize.w || height !== canvasSize.h) setCanvasSize({ w: width, h: height });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // Scene to screen: fit the fixed-size scene to the canvas, then apply the GM's zoom and pan.
      const fit = fitScene(width, height);
      const k = view.zoom * fit.s; // screen pixels per map unit (keeps outlines a constant width on screen)
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (view.x + view.zoom * fit.ox), dpr * (view.y + view.zoom * fit.oy));
      for (const layer of MAP_LAYERS) {
        if (!hiddenSet.has(layer)) LAYER_RENDERERS[layer]?.(state)(ctx, SCENE.w, SCENE.h);
      }
      // Highlight the tile picked in the editor.
      const highlighted = drawnTiles.find((t) => t.id === selectedTileId);
      if (highlighted && selected === "tiles") {
        const r = cellToRect(state, SCENE.w, SCENE.h, highlighted);
        ctx.save();
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 3 / k;
        ctx.setLineDash([6 / k, 4 / k]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
      // Highlight the note picked in the editor.
      const note = drawnNotes.find((n) => n.id === selectedNoteId);
      if (note && selected === "notes") {
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
      const lt = optimisticLights.find((l) => l.id === selectedLightId);
      if (lt && selected === "lighting") {
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
      const ps = drawnPositional.find((p) => p.id === selectedPositionalId);
      if (ps && selected === "sounds") {
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
      const token = drawnTokens.find((t) => t.id === selectedTokenId);
      if (token && selected === "tokens") {
        const r = cellToRect(state, SCENE.w, SCENE.h, { col: token.col, row: token.row, cols: 1, rows: 1 });
        ctx.save();
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 3 / k;
        ctx.setLineDash([6 / k, 4 / k]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
      // Structure: preview of the line being drawn, and highlight of the selected piece.
      if (drawingLine && structureTool.kind !== "staircase") {
        const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
        const style = STRUCTURE_STYLES[structureTool.kind];
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
      const piece = optimisticStructures.find((s) => s.id === selectedStructureId);
      if (piece && selected === "structure") {
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
      // Effect area being dragged out.
      if (effectDrag) {
        const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
        const a = effectRect(effectDrag);
        ctx.save();
        ctx.fillStyle = "rgba(167,139,250,0.15)";
        ctx.strokeStyle = "rgb(167,139,250)";
        ctx.lineWidth = 2 / k;
        ctx.setLineDash([6 / k, 4 / k]);
        ctx.fillRect(x0 + a.x * size, y0 + a.y * size, a.w * size, a.h * size);
        ctx.strokeRect(x0 + a.x * size, y0 + a.y * size, a.w * size, a.h * size);
        ctx.restore();
      }
      // Placement preview: outline of the cells the tile will cover.
      if (placing) {
        const r = cellToRect(state, SCENE.w, SCENE.h, spanOf(placing));
        ctx.save();
        ctx.fillStyle = "rgba(99,102,241,0.25)";
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 2 / k;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  function onToggle(layer: MapLayer, visible: boolean) {
    startTransition(async () => {
      setHidden([layer, visible]);
      await toggleLayer(locationId, levelId, layer, visible);
    });
  }

  return (
    // Wide screens: the map fills the window's height, with the layers and the selected layer's editor in a
    // column on the right. Narrower: the map keeps a 16:9 shape and the column goes underneath.
    <div className="flex flex-col 2xl:flex-row gap-4 2xl:h-[calc(100dvh-14.5rem)] 2xl:in-data-focus:h-[calc(100dvh-12.5rem)] 2xl:min-h-[30rem]">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="relative overflow-hidden rounded-box bg-base-300 aspect-video 2xl:aspect-auto 2xl:flex-1 2xl:min-h-0">
            {/* Control buttons float above every layer, along the scene's edges (they move with zoom/pan). */}
            {!hiddenSet.has("controls") && (
              <ControlButtons
                controls={controls}
                size={canvasSize}
                onRun={(c) =>
                  startTransition(async () => {
                    const r = await runControl(locationId, c.id);
                    setControlResult({ label: c.label, ok: r.ok, text: r.ok ? r.value : r.error });
                  })
                }
              />
            )}
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              className="absolute inset-0 size-full touch-none"
            />
            </div>
            <div className="flex items-center justify-end gap-1 text-xs">
              {controlResult && (
                <span data-control-result className={`mr-auto truncate ${controlResult.ok ? "" : "text-error"}`} title={controlResult.text}>
                  {controlResult.label}: {controlResult.text.replace(/\s+/g, " ")}
                  <button type="button" className="btn btn-ghost btn-xs" aria-label="Dismiss" onClick={() => setControlResult(null)}>✕</button>
                </span>
              )}
              <span className="opacity-60 mr-1">Scroll to zoom · right-drag to pan</span>
              <span className="badge badge-neutral" data-zoom>{Math.round(view.zoom * 100)}%</span>
              <button type="button" className="btn btn-xs" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>Reset view</button>
              <button type="button" className={`btn btn-xs ${focus ? "btn-primary" : ""}`} aria-pressed={focus} onClick={() => setFocus(!focus)} title="Hide the campaign menu to give the map more room">
                Focus
              </button>
            </div>
        </div>
        <div className="2xl:w-[30rem] shrink-0 flex flex-col gap-3 min-h-0">
        <ul className="grid grid-cols-4 2xl:grid-cols-2 gap-x-1 bg-base-200 rounded-box p-2 text-sm">
          <li className="col-span-full text-xs opacity-60 px-1 pb-1">Layers (top first)</li>
          {[...MAP_LAYERS].reverse().map((layer) => (
            <li key={layer}>
              <div className={`flex items-center gap-1 rounded ${selected === layer ? "bg-[color-mix(in_oklab,var(--color-primary)_60%,white)] text-base-100" : ""}`}>
                <button
                  type="button"
                  aria-pressed={!hiddenSet.has(layer)}
                  title={hiddenSet.has(layer) ? `Show ${layer}` : `Hide ${layer}`}
                  onClick={() => onToggle(layer, hiddenSet.has(layer))}
                  className={`p-1 rounded ${hoverBg(layer)} ${hiddenSet.has(layer) ? "opacity-30" : ""}`}
                >
                  <EyeIcon />
                </button>
                <button
                  type="button"
                  aria-current={selected === layer}
                  onClick={() => setSelected(layer)}
                  className={`flex-1 text-left px-1 py-0.5 rounded ${hoverBg(layer)} ${hiddenSet.has(layer) ? "opacity-30" : ""}`}
                >
                  {capitalize(layer)}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="2xl:flex-1 2xl:min-h-0 overflow-y-auto rounded-box bg-base-200 p-3" data-editor={selected}>
            <div className="font-semibold mb-2">{capitalize(selected)} layer</div>
            {selected === "background" ? (
              <BackgroundEditor key={JSON.stringify(background)} locationId={locationId} levelId={levelId} background={background} />
            ) : selected === "controls" ? (
              <ControlsEditor locationId={locationId} levelId={levelId} controls={controls} />
            ) : selected === "notes" ? (
              <NotesEditor
                draft={noteDraft}
                onDraftChange={setNoteDraft}
                notes={optimisticNotes}
                selectedId={selectedNoteId}
                onSelect={(id) => setSelectedNoteId(id === selectedNoteId ? null : id)}
                onEdit={(id, text) => editNote(locationId, id, text)}
                onRemove={(id) =>
                  startTransition(async () => {
                    changeNotes({ remove: id });
                    await removeNote(locationId, id);
                  })
                }
              />
            ) : selected === "effects" ? (
              <EffectsEditor
                tool={effectTool}
                onToolChange={setEffectTool}
                effects={optimisticEffects}
                onAddToMap={() =>
                  startTransition(() =>
                    placeEffect(locationId, levelId, { kind: effectTool.kind, x: null, y: null, w: null, h: null, intensity: effectTool.intensity })
                  )
                }
                onIntensity={(id, v) => startTransition(() => changeEffectIntensity(locationId, id, v))}
                onRemove={(id) => startTransition(() => removeEffect(locationId, id))}
              />
            ) : selected === "lighting" ? (
              <LightingEditor
                value={shownIllumination}
                onPreview={setPreviewIllumination}
                onCommit={(v) => changeIllumination(locationId, levelId, v)}
                tool={lightTool}
                onToolChange={setLightTool}
                lights={optimisticLights}
                selectedId={selectedLightId}
                onSelect={(id) => setSelectedLightId(id === selectedLightId ? null : id)}
                onRemove={(id) =>
                  startTransition(async () => {
                    changeLights({ remove: id });
                    await removeLight(locationId, id);
                  })
                }
              />
            ) : selected === "sounds" ? (
              <SoundsEditor
                locationId={locationId}
                levelId={levelId}
                sounds={sounds}
                audioAssets={audioAssets}
                positional={optimisticPositional}
                tool={positionalTool}
                onToolChange={setPositionalTool}
                selectedPositionalId={selectedPositionalId}
                onSelectPositional={(id) => setSelectedPositionalId(id === selectedPositionalId ? null : id)}
              />
            ) : selected === "tokens" ? (
              <TokensEditor
                portrait={portrait}
                figureHeight={figureHeight}
                onFigureHeightChange={(cells) => changeFigureHeight(locationId, levelId, cells)}
                creatures={creatures}
                creature={tokenCreature}
                onCreatureChange={setTokenCreature}
                tokens={optimisticTokens}
                selectedId={selectedTokenId}
                onSelect={(id) => setSelectedTokenId(id === selectedTokenId ? null : id)}
                onDelete={(id) =>
                  startTransition(async () => {
                    changeTokens({ remove: id });
                    setSelectedTokenId(null);
                    await removeToken(locationId, id);
                  })
                }
              />
            ) : selected === "structure" ? (
              <StructureEditor
                portrait={portrait}
                tool={structureTool}
                onToolChange={setStructureTool}
                levels={otherLevels}
                pieces={optimisticStructures}
                selectedId={selectedStructureId}
                onSelect={(id) => setSelectedStructureId(id === selectedStructureId ? null : id)}
                onToggleDoor={(id, open) => toggleDoor(locationId, id, open)}
                onDelete={(id) =>
                  startTransition(async () => {
                    changeStructures({ remove: id });
                    setSelectedStructureId(null);
                    await removeStructure(locationId, id);
                  })
                }
              />
            ) : selected === "tiles" ? (
              <TilesEditor
                locationId={locationId}
                assets={tileAssets}
                asset={tileAsset}
                onAssetChange={setTileAsset}
                tiles={optimisticTiles}
                selectedTileId={selectedTileId}
                onSelectTile={(id) => setSelectedTileId(id === selectedTileId ? null : id)}
                onDeleteTile={(id) =>
                  startTransition(async () => {
                    changeTiles({ remove: id });
                    setSelectedTileId(null);
                    await removeTile(locationId, id);
                  })
                }
              />
            ) : selected === "templates" ? (
              <TemplatesEditor key={JSON.stringify(templateColors)} locationId={locationId} levelId={levelId} colors={templateColors} />
            ) : selected === "grid" ? (
              <GridEditor key={JSON.stringify(grid)} locationId={locationId} levelId={levelId} grid={grid} perspective={mapImage.perspective} />
            ) : selected === "map" ? (
              <MapImageEditor key={JSON.stringify(mapImage)} locationId={locationId} levelId={levelId} mapImage={mapImage} />
            ) : (
              <p className="text-sm opacity-60">No editing tools for this layer yet.</p>
            )}
          </div>
        )}
        </div>
    </div>
  );
}

/**
 * Icon buttons fixed to the viewport (the canvas), one row per edge, 12px in from the edge and
 * centred along it. They ignore zoom and pan so they're always in reach.
 */
function ControlButtons({
  controls,
  size,
  onRun,
}: {
  controls: MapControl[];
  size: { w: number; h: number };
  onRun: (control: MapControl) => void;
}) {
  const MARGIN = 12, GAP = 6, B = 26;
  const placed = (["top", "right", "bottom", "left"] as const).flatMap((edge) => {
    const row = controls.filter((c) => c.edge === edge);
    const horizontal = edge === "top" || edge === "bottom";
    const total = row.length * B + Math.max(0, row.length - 1) * GAP;
    const start = ((horizontal ? size.w : size.h) - total) / 2;
    const inset = MARGIN;
    return row.map((c, i) => {
      const along = start + i * (B + GAP);
      const x = horizontal ? along : edge === "left" ? inset : size.w - inset - B;
      const y = horizontal ? (edge === "top" ? inset : size.h - inset - B) : along;
      return { c, x, y, edge };
    });
  });
  return (
    <>
      {placed.map(({ c, x, y, edge }) => (
        <div
          key={c.id}
          // Tooltips open towards the middle of the scene so they aren't cut off at the edge.
          className={`tooltip absolute z-10 ${{ top: "tooltip-bottom", bottom: "tooltip-top", left: "tooltip-right", right: "tooltip-left" }[edge]}`}
          data-tip={c.label}
          style={{ left: x, top: y }}
        >
          <button
            type="button"
            data-control-button={c.label}
            aria-label={c.label}
            onClick={() => onRun(c)}
            className="flex items-center justify-center rounded-md border border-white/70 bg-transparent text-white/90 hover:border-white hover:text-white"
            style={{ width: B, height: B }}
          >
            <GameIcon name={c.icon} className="size-4" />
          </button>
        </div>
      ))}
    </>
  );
}
