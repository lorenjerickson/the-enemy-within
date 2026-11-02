"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { MAP_LAYERS, STRUCTURE_STYLES, type MapBackground, type MapGrid, type MapImage, type MapLayer, type TemplateColors } from "@/lib/maps";
import TemplatesEditor from "./TemplatesEditor";
import TilesEditor from "./TilesEditor";
import type { AmbientSound, Asset, MapStructure, MapTile, MapToken, PositionalSound } from "@/lib/db";
import SoundsEditor, { type PositionalTool } from "./SoundsEditor";
import LightingEditor from "./LightingEditor";
import TokensEditor, { type TokenCreature } from "./TokensEditor";
import StructureEditor, { type StructureTool } from "./StructureEditor";
import GridEditor from "./GridEditor";
import BackgroundEditor from "./BackgroundEditor";
import MapImageEditor from "./MapImageEditor";
import { changeIllumination, placePositionalSound, moveTileTo, moveTokenTo, placeCreatureToken, placeStructure, placeTile, removeStructure, removeTile, removeToken, toggleLayer } from "../actions";

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

/** Grid cell geometry: top-left of cell (0,0) and the cell size, in map space. */
function gridOrigin(state: MapState, w: number, h: number) {
  const { size, offsetX, offsetY } = state.grid;
  const p = state.background.padding;
  const r = mapRect(state, w, h) ?? { x: p.left, y: p.top, w: w - p.left - p.right, h: h - p.top - p.bottom };
  const first = (start: number, offset: number) => start + (((offset % size) + size) % size);
  return { x0: first(r.x, offsetX), y0: first(r.y, offsetY), size };
}

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
      } else {
        const style = STRUCTURE_STYLES[s.kind];
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width;
        ctx.beginPath();
        ctx.moveTo(x0 + s.x1 * size, y0 + s.y1 * size);
        ctx.lineTo(x0 + s.x2 * size, y0 + s.y2 * size);
        ctx.stroke();
      }
    }
    ctx.restore();
  },
  // Global illumination: darken everything below by (1 - illumination), across the whole visible area.
  lighting: (state) => (ctx) => {
    const darkness = 1 - state.illumination;
    if (darkness <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${darkness})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  },
  // Positional sounds: a speaker icon with a faint circle showing the effective range.
  sounds: (state) => (ctx, w, h) => {
    const { x0, y0, size } = gridOrigin(state, w, h);
    for (const p of state.positional) {
      const cx = x0 + p.x * size, cy = y0 + p.y * size;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, p.radius * size, 0, Math.PI * 2);
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
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = t.character_id ? "#1d4ed8" : "#7f1d1d";
      ctx.fill();
      const img = t.image ? state.tokenImages.get(t.image) : undefined;
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
}) {
  const [, startTransition] = useTransition();
  const [hiddenSet, setHidden] = useOptimistic(new Set(hidden), (set: Set<MapLayer>, [layer, visible]: [MapLayer, boolean]) => {
    const next = new Set(set);
    if (visible) next.delete(layer);
    else next.add(layer);
    return next;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundImage = useImage(background.mode === "texture" ? background.image : null);
  const mapImageEl = useImage(mapImage.image);

  // Tile images, loaded once per URL; bump a counter to redraw as each arrives.
  const tileImages = useRef(new Map<string, HTMLImageElement>()).current;
  const [, setLoaded] = useState(0);
  useEffect(() => {
    for (const url of new Set([...tiles.map((t) => t.url), ...tokens.flatMap((t) => (t.image ? [t.image] : []))])) {
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
  const [optimisticPositional, addOptimisticPositional] = useOptimistic(positional, (ps: PositionalSound[], p: PositionalSound) => [...ps, p]);

  // Illumination being previewed in the lighting editor (null = use the saved level).
  const [previewIllumination, setPreviewIllumination] = useState<number | null>(null);
  const shownIllumination = previewIllumination ?? illumination;

  const state: MapState = {
    background, backgroundImage, mapImage, mapImageEl, grid,
    tiles: drawnTiles, tileImages: loadedTileImages, structures: optimisticStructures,
    tokens: drawnTokens, tokenImages: loadedTileImages, positional: optimisticPositional, illumination: shownIllumination,
  };

  /** Pointer position in grid units (fractional), accounting for zoom and pan. */
  function gridAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left - view.x) / view.zoom;
    const my = (e.clientY - rect.top - view.y) / view.zoom;
    const { x0, y0, size } = gridOrigin(state, rect.width, rect.height);
    return { gx: (mx - x0) / size, gy: (my - y0) / size };
  }
  /** Grid cell under the pointer. */
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return { col: Math.floor(gx), row: Math.floor(gy) };
  };
  /** Nearest grid corner to the pointer. */
  const cornerAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return { x: Math.round(gx), y: Math.round(gy) };
  };

  const spanOf = (p: NonNullable<typeof placing>): CellRect => ({
    col: Math.min(p.start.col, p.end.col),
    row: Math.min(p.start.row, p.end.row),
    cols: Math.abs(p.end.col - p.start.col) + 1,
    rows: Math.abs(p.end.row - p.start.row) + 1,
  });
  const [selected, setSelected] = useState<MapLayer | null>(null);
  // On the light selected row a dark hover would hide the dark text, so darken the tint slightly instead.
  const hoverBg = (layer: MapLayer) => (selected === layer ? "hover:bg-black/15" : "hover:bg-base-300");

  // View transform: zoom about a point and pan. The map is drawn in "map space" (the canvas size at zoom 1).
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
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
    if (e.button === 0 && selected === "sounds") {
      const a = positionalTool.asset;
      if (!a) return;
      const { col, row } = cellAt(e);
      const placed = { x: col + 0.5, y: row + 0.5, radius: positionalTool.radius };
      startTransition(async () => {
        addOptimisticPositional({ id: -Date.now(), asset_id: a.id, name: a.name, url: a.url, volume: 1, ...placed });
        await placePositionalSound(locationId, levelId, a.id, placed.x, placed.y, placed.radius);
      });
      return;
    }
    if (e.button === 0 && selected === "tokens") {
      const { col, row } = cellAt(e);
      // Pressing on a token picks it up (topmost first); otherwise place the chosen creature.
      const hit = [...optimisticTokens].reverse().find((t) => t.col === col && t.row === row);
      if (hit) {
        setSelectedTokenId(hit.id);
        setDraggingToken({ id: hit.id, col, row });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (!tokenCreature) return;
      const c = tokenCreature;
      startTransition(async () => {
        changeTokens({ add: { id: -Date.now(), creature_id: c.id, character_id: null, name: c.name, image: c.image, col, row } });
        await placeCreatureToken(locationId, levelId, c.id, col, row);
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
          changeStructures({ add: { id: -Date.now(), ...piece, target_name: target.name } });
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
    if (draggingToken) {
      const { col, row } = cellAt(e);
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
    if (draggingToken) {
      const { id, col, row } = draggingToken;
      const before = optimisticTokens.find((t) => t.id === id);
      setDraggingToken(null);
      if (before && (before.col !== col || before.row !== row)) {
        startTransition(async () => {
          changeTokens({ move: { id, col, row } });
          await moveTokenTo(locationId, id, col, row);
        });
      }
      return;
    }
    if (drawingLine) {
      const { start, end } = drawingLine;
      setDrawingLine(null);
      if (start.x === end.x && start.y === end.y) return; // a click without a drag draws nothing
      const piece = { kind: structureTool.kind, x1: start.x, y1: start.y, x2: end.x, y2: end.y, target_level_id: null };
      startTransition(async () => {
        changeStructures({ add: { id: -Date.now(), ...piece, target_name: null } });
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
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
      for (const layer of MAP_LAYERS) {
        if (!hiddenSet.has(layer)) LAYER_RENDERERS[layer]?.(state)(ctx, width, height);
      }
      // Highlight the tile picked in the editor.
      const highlighted = drawnTiles.find((t) => t.id === selectedTileId);
      if (highlighted && selected === "tiles") {
        const r = cellToRect(state, width, height, highlighted);
        ctx.save();
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 3 / view.zoom;
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
      // Highlight the positional sound picked in the editor.
      const ps = optimisticPositional.find((p) => p.id === selectedPositionalId);
      if (ps && selected === "sounds") {
        const { x0, y0, size } = gridOrigin(state, width, height);
        ctx.save();
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 3 / view.zoom;
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.beginPath();
        ctx.arc(x0 + ps.x * size, y0 + ps.y * size, ps.radius * size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // Highlight the token picked in the editor.
      const token = drawnTokens.find((t) => t.id === selectedTokenId);
      if (token && selected === "tokens") {
        const r = cellToRect(state, width, height, { col: token.col, row: token.row, cols: 1, rows: 1 });
        ctx.save();
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 3 / view.zoom;
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }
      // Structure: preview of the line being drawn, and highlight of the selected piece.
      if (drawingLine && structureTool.kind !== "staircase") {
        const { x0, y0, size } = gridOrigin(state, width, height);
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
        const { x0, y0, size } = gridOrigin(state, width, height);
        ctx.save();
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 3 / view.zoom;
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        const pad = 6;
        const [ax, bx] = [Math.min(piece.x1, piece.x2), Math.max(piece.x1, piece.x2)];
        const [ay, by] = [Math.min(piece.y1, piece.y2), Math.max(piece.y1, piece.y2)];
        const extra = piece.kind === "staircase" ? 1 : 0;
        ctx.strokeRect(x0 + ax * size - pad, y0 + ay * size - pad, (bx - ax + extra) * size + 2 * pad, (by - ay + extra) * size + 2 * pad);
        ctx.restore();
      }
      // Placement preview: outline of the cells the tile will cover.
      if (placing) {
        const r = cellToRect(state, width, height, spanOf(placing));
        ctx.save();
        ctx.fillStyle = "rgba(99,102,241,0.25)";
        ctx.strokeStyle = "rgb(129,140,248)";
        ctx.lineWidth = 2 / view.zoom;
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
    <div className="space-y-2">
      <div className="flex gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="relative">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              className="w-full aspect-video rounded-box bg-base-300 touch-none"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs">
              <span className="opacity-60 mr-1">Scroll to zoom · right-drag to pan</span>
              <span className="badge badge-neutral" data-zoom>{Math.round(view.zoom * 100)}%</span>
              <button type="button" className="btn btn-xs" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>Reset view</button>
            </div>
          </div>
          {selected && (
            <div className="rounded-box bg-base-200 p-3" data-editor={selected}>
              <div className="font-semibold mb-2">{capitalize(selected)} layer</div>
              {selected === "background" ? (
                <BackgroundEditor key={JSON.stringify(background)} locationId={locationId} levelId={levelId} background={background} />
              ) : selected === "lighting" ? (
                <LightingEditor
                  value={shownIllumination}
                  onPreview={setPreviewIllumination}
                  onCommit={(v) =>
                    startTransition(async () => {
                      await changeIllumination(locationId, levelId, v);
                      setPreviewIllumination(null);
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
                  tool={structureTool}
                  onToolChange={setStructureTool}
                  levels={otherLevels}
                  pieces={optimisticStructures}
                  selectedId={selectedStructureId}
                  onSelect={(id) => setSelectedStructureId(id === selectedStructureId ? null : id)}
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
        <ul className="w-44 shrink-0 bg-base-200 rounded-box p-2 text-sm">
          <li className="text-xs opacity-60 px-1 pb-1">Layers (top first)</li>
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
      </div>
    </div>
  );
}
