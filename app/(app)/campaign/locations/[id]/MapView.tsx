"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { MAP_LAYERS, type MapBackground, type MapGrid, type MapImage, type MapLayer, type TemplateColors } from "@/lib/maps";
import TemplatesEditor from "./TemplatesEditor";
import TilesEditor from "./TilesEditor";
import { blockingSegments, insidePolygon, movementBlockers, visibilityPolygon, type Point } from "@/lib/visibility";
import { DARK_BELOW, brightEnough } from "@/lib/light";
import { landingRow, snapHeight } from "@/lib/gravity";
import type { MapSecret, MapEffect, AmbientSound, Asset, LightSource, MapControl, MapNote, MapStructure, MapTile, MapToken, PositionalSound } from "@/lib/db";
import SoundsEditor, { type PositionalTool } from "./SoundsEditor";
import LightingEditor, { type LightTool } from "./LightingEditor";
import NotesEditor from "./NotesEditor";
import PlayDock, { type DockTool } from "../../../../(play)/play/PlayDock";
import { freeMove, fxSince, planStep, pingsSince, selectTarget, sendPing } from "../../../../(play)/play/actions";
import type { Fx } from "@/lib/vfx";
import { setMoveMode, useMoveMode } from "../../../../(play)/play/moveMode";
import { setGmPlanToken, useGmPlanToken } from "../../../../(play)/play/gmPlanner";
import { gmPlanStep } from "../../../../(play)/play/gmActions";
import { setScrub, useScrub } from "../../../../(play)/play/scrub";
import { caughtBy, placeArea, type LastingArea } from "@/lib/aoe";
import { setTargetMode, useTargetMode } from "../../../../(play)/play/targetMode";
import { setSheetToken } from "../../../../(play)/play/sheetToken";
import { allegianceOf, fits, maxPicks, picksSeveral, relation } from "@/lib/sides";
import { ScriptPickOverlay, choose, runWithPrompts, useScriptPick } from "../../../sessions/ScriptPick";
import { FEET_PER_SQUARE, pointToSegment, reachAreas, reachableSquares, squareKey } from "@/lib/movement";
import type { Contest, Replay } from "@/lib/resolveRound";
import SecretsEditor, { type SecretDraft } from "./SecretsEditor";
import TrapsEditor from "./TrapsEditor";
import { trapFromDrag, type TrapShape } from "./trapDraw";
import type { Trap } from "@/lib/traps";
import EffectsEditor, { type EffectTool } from "./EffectsEditor";
import type { ScriptNames } from "@/lib/scriptSchema";
import ControlsEditor from "./ControlsEditor";
import ControlButtons from "./ControlButtons";
import { contestBox, drawEditorAids, drawPings, drawSessionOverlays } from "./mapOverlays";
import TokensEditor, { type TokenCreature } from "./TokensEditor";
import StructureEditor, { type StructureTool } from "./StructureEditor";
import GridEditor from "./GridEditor";
import BackgroundEditor from "./BackgroundEditor";
import MapImageEditor from "./MapImageEditor";
import { placeTrap, removeTrap, placeSecret, removeSecret, revealSecret, lockDoor, changeLockDc, setWallsHidden, placeInStartArea, setPartyStart, removePartyStart, renameThing, switchThing, moveEffectTo, placeEffect, changeEffectIntensity, removeEffect, movePositionalSoundTo, changeFigureHeight, placeCharacterTokenAt, runControl, changeNoteSize, editNote, placeNote, removeNote, toggleDoor, changeIllumination, placeLight, removeLight, placePositionalSound, moveTileTo, moveTokenTo, placeCreatureToken, placeStructure, placeTile, removeStructure, removeTile, removeToken, toggleLayer } from "../actions";
import { GM_ONLY_LAYERS, capitalize, type Area, EyeIcon, type MapState, type CellRect, useImage, noteLayout, SCENE, JOIN_DISTANCE, fitScene, gridOrigin, figureCells, HOLD_MS, LIFT_MS, PING_MS, FX_MS, SIGHT, LAYER_RENDERERS } from "./mapLayers";


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
  scriptNames,
  partyStart,
  partyStartElsewhere,
  toPlace,
  readOnly = false,
  replay = null,
  replayName = null,
  planTargets = [],
  planRoutes = [],
  contest = null,
  selectedTarget = null,
  planExplored,
  downTokens = [],
  lasting = [],
  gmPlans,
  secrets,
  traps = [],
  trapEffects = [],
  discoveries = [],
  fog,
  hideWalls,
  dockSide,
  dockTools = [],
  dockInitial = null,
  dockOpposite,
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
  partyStart: Area | null; // the party's starting area, when it's on this level
  partyStartElsewhere: string | null; // "Location › Level" when it's marked on another level
  toPlace: { id: number; name: string; image: string | null; player: string }[]; // first session: players' characters to place in the start area
  readOnly?: boolean; // a player's view: look, zoom and pan only; no editors, no GM-only layers
  gmPlans?: Record<number, { from: { col: number; row: number }; feetLeft: number; perSecond?: number }>; // GM planning creatures' rounds: where each plan leaves it, feet left
  replay?: Replay | null; // the last resolved round, played back second by second
  planTargets?: { from: number; to: number; action: string; label?: string; at?: { col: number; row: number } | null }[]; // planned targeted actions: lines to the target, from where they'll be
  planRoutes?: { token: number; points: { col: number; row: number }[] }[]; // planned moves: trails of waypoints
  contest?: Contest | null; // a contested move waiting on the GM: zoomed to, boxed, the spot highlighted
  selectedTarget?: number | null; // a player's selected target (kept from round to round): marked; clicking another token changes it
  planExplored?: Record<number, Point[]>; // GM planning as a character: where it has stood (what it's seen stays shaded in)
  downTokens?: number[]; // tokens at 0 health (a skull is drawn over them)
  lasting?: LastingArea[]; // areas actions left on the map for a while (a fire wall)
  replayName?: string | null; // a player's character: they see only what happened involving them
  secrets: MapSecret[]; // hidden things (players get only the revealed ones)
  traps?: Trap[]; // the GM's traps (players get only the found ones)
  trapEffects?: { id: number; name: string }[]; // catalog effects lasting rounds, for what traps put on
  discoveries?: { id: number; title: string; text: string; found: number }[]; // for the secrets editor
  hideWalls: boolean; // the GM has hidden wall lines from their view
  fog?: { viewers: number[]; explored: Point[]; sight?: Record<number, number>; darkvision?: Record<number, number>; move?: { characterId: number; feet: number; free: boolean; from?: { col: number; row: number }; perSecond?: number } | null }; // from: where their round plan leaves them // a player's fog of war: their characters, where they've stood before, and how far they can still move
  dockSide?: "left" | "right"; // in a session: full-screen map, tools docked on this edge
  dockTools?: DockTool[]; // more dock tools after the map layers
  dockInitial?: string | null; // the dock tool open at first
  dockOpposite?: { tools: DockTool[]; initial?: string | null }; // a second dock on the other edge (players: their sheet on the left)
  lights: LightSource[];
  notes: MapNote[];
  effects: MapEffect[];
  controls: MapControl[];
  scriptNames: ScriptNames; // names for the script editor's suggestions (this level's lights, doors …)
}) {
  const [, startTransition] = useTransition();
  /** What the last clicked control button's script returned. */
  const [controlResult, setControlResult] = useState<{ label: string; ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<MapLayer | null>(null); // layer whose editor is open
  const [dockWidth, setDockWidth] = useState(0); // in a session: how much of the screen edge the dock covers
  const [hiddenSet, setHidden] = useOptimistic(new Set<MapLayer>(readOnly ? [...hidden, ...GM_ONLY_LAYERS] : hidden), (set: Set<MapLayer>, [layer, visible]: [MapLayer, boolean]) => {
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
  const [structureTool, setStructureTool] = useState<StructureTool>({ kind: "wall", targetLevelId: otherLevels[0]?.id ?? null, snap: true });
  const [drawingLine, setDrawingLine] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState<number | null>(null);
  type StructureChange = { add: MapStructure } | { remove: number };
  const [optimisticStructures, changeStructures] = useOptimistic(structures, (ss: MapStructure[], c: StructureChange) =>
    "add" in c ? [...ss, c.add] : ss.filter((s) => s.id !== c.remove)
  );
  /** On portrait maps a placed token drops to the floor below (the server does the same). */
  const portrait = mapImage.perspective === "portrait";
  const gridless = !!grid.gridless;
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
  // Playing back a resolved round: each second's spots shown for a real second, from the shared start time.
  const scrub = useScrub(); // stepping through the last round (the GM's or a player's own map only)
  // Something changing for real (a script revives someone, the GM moves a token) puts the GM's map back to live,
  // so a replay second being looked at never hides it.
  const liveKey = JSON.stringify([downTokens, tokens.map((t) => [t.id, t.col, t.row])]);
  const lastLive = useRef(liveKey);
  useEffect(() => {
    if (lastLive.current === liveKey) return;
    lastLive.current = liveKey;
    if (scrub !== null) setScrub(null);
  }, [liveKey, scrub]);
  const replayFrame = (() => {
    if (!replay) return null;
    // Before the round plays: whoever was already down stays down (older replays: whoever was down after its first second).
    const before = replay.startDown ?? replay.frames[0]?.down.filter((id) => downTokens.includes(id)) ?? [];
    if (scrub !== null) {
      const f = scrub === 0 ? { sec: 0, pos: replay.start, down: before, lines: [] as string[] } : replay.frames[Math.min(scrub, replay.frames.length) - 1];
      return { ...f, startsIn: 0, scrubbing: true };
    }
    const t = Date.now() - replay.starts;
    if (t >= (replay.frames.length + 1) * 1000) return null; // done (the last second is held one more)
    if (t < 0) return { sec: 0, pos: replay.start, down: before, lines: [] as string[], startsIn: Math.ceil(-t / 1000) };
    // During each second, tokens glide from where the last second left them to where this one does.
    const i = Math.min(replay.frames.length - 1, Math.floor(t / 1000));
    const from = i === 0 ? replay.start : replay.frames[i - 1].pos;
    const k = i === Math.floor(t / 1000) ? (t - i * 1000) / 1000 : 1;
    return { ...replay.frames[i], startsIn: 0, from, k };
  })();
  // When a round's playback starts, everything picked or being planned is let go, so nothing gets in the way of watching.
  useEffect(() => {
    if (!replay || Date.now() > replay.starts + (replay.frames.length + 1) * 1000) return;
    setGmPlanToken(null);
    setTargetMode(null);
    setMoveMode(false);
    setSelectedTokenId(null);
    setAimAt(null);
  }, [replay?.starts]); // eslint-disable-line react-hooks/exhaustive-deps
  const replayedTokens = replayFrame
    ? optimisticTokens.map((t) => {
        const to = replayFrame.pos[t.id];
        if (!to) return t;
        if (!("from" in replayFrame) || replayFrame.k >= 1) return { ...t, ...to };
        const from = replayFrame.from[t.id] ?? replay!.start[t.id];
        if (!from || from.col < -9000) return { ...t, ...to }; // coming into sight: no glide from where it was hidden
        const k = replayFrame.k;
        return { ...t, col: from.col + (to.col - from.col) * k, row: from.row + (to.row - from.row) * k };
      })
    : optimisticTokens;
  const drawnTokens = draggingToken
    ? replayedTokens.map((t) => (t.id === draggingToken.id ? { ...t, col: draggingToken.col, row: draggingToken.row } : t))
    : replayedTokens;

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
  const anyEffect = (effects.length > 0 || lasting.length > 0) && !hiddenSet.has("effects");
  // Placed effects, with moves shown straight away (optimistic) and the one being dragged offset by the drag.
  const [optimisticEffects, moveEffectLocally] = useOptimistic(effects, (es: MapEffect[], m: { id: number; x: number; y: number }) =>
    es.map((e) => (e.id === m.id ? { ...e, x: m.x, y: m.y } : e))
  );
  const [draggingEffect, setDraggingEffect] = useState<{ id: number; grab: { x: number; y: number }; dx: number; dy: number } | null>(null);
  const drawnEffects = draggingEffect
    ? optimisticEffects.map((e) => (e.id === draggingEffect.id ? { ...e, x: e.x! + draggingEffect.dx, y: e.y! + draggingEffect.dy } : e))
    : optimisticEffects;
  // Pings (in a session): press and hold to point at a spot; everyone's pings are fetched every second.
  const [pings, setPings] = useState<{ key: string; x: number; y: number; name: string; gm: boolean; at: number }[]>([]);
  const lastPingId = useRef(0);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // One-off effects played by scripts: each is drawn for FX_MS from its start.
  const [scriptFx, setScriptFx] = useState<{ id: number; starts: number; fx: Fx }[]>([]);
  const lastFxId = useRef(0); // only those still playing are kept, so old ones aren't replayed
  const addPings = (more: typeof pings) => setPings((ps) => [...ps.filter((p) => Date.now() - p.at < PING_MS), ...more]);
  useEffect(() => {
    if (!dockSide) return;
    const timer = setInterval(async () => {
      // Effects scripts played (scheduled a moment ahead, so every map catches them together).
      const moreFx = await fxSince(levelId, lastFxId.current).catch(() => []);
      if (moreFx.length) {
        lastFxId.current = moreFx[moreFx.length - 1].id;
        setScriptFx((fs) => [...fs.filter((f) => Date.now() < f.starts + FX_MS), ...moreFx.filter((f) => Date.now() < f.starts + FX_MS)]);
      }
      const fresh = await pingsSince(levelId, lastPingId.current).catch(() => []);
      if (!fresh.length) return;
      lastPingId.current = fresh[fresh.length - 1].id;
      addPings(fresh.filter((p) => !p.mine).map((p) => ({ key: `p${p.id}`, x: p.x, y: p.y, name: p.name, gm: !!p.gm, at: Date.now() })));
    }, 1000);
    return () => clearInterval(timer);
  }, [dockSide, levelId]);
  const anyPing = pings.some((p) => Date.now() - p.at < PING_MS);
  const anyFx = scriptFx.some((f) => Date.now() < f.starts + FX_MS);
  const replaying = !!replay && Date.now() < replay.starts + (replay.frames.length + 1) * 1000;
  const frameMs = anyEffect || anyPing || replaying || anyFx ? 33 : contest ? 60 : anyFlicker ? 120 : 0; // a replay redraws often so tokens glide
  useEffect(() => {
    if (!frameMs) return;
    const t = setInterval(() => setFlickerTick((n) => n + 1), frameMs);
    return () => clearInterval(t);
  }, [frameMs]);

  // Effects: choose a built-in effect, then add it to the whole map or click to place it.
  const [effectTool, setEffectTool] = useState<EffectTool>({ kind: "rain", intensity: 0.5, wholeMap: true });
  // Dragging out a placed effect's area, corner to corner, in grid units.
  const [effectDrag, setEffectDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  // Effect areas snap to quarter cells, or 1/20 of a unit on gridless maps.
  const quarter = (v: number) => (gridless ? snapHeight(v) : Math.round(v * 4) / 4);
  const effectRect = (d: NonNullable<typeof effectDrag>) => ({
    x: Math.min(d.start.x, d.end.x),
    y: Math.min(d.start.y, d.end.y),
    w: Math.abs(d.end.x - d.start.x),
    h: Math.abs(d.end.y - d.start.y),
  });

  // Wall lines hidden from the GM's view (shown straight away, saved in the background).
  const [optimisticHideWalls, setHideWallsLocally] = useOptimistic(hideWalls, (_: boolean, v: boolean) => v);

  // Party start: while marking, dragging on the map outlines the area the party's tokens start in.
  const [markingStart, setMarkingStart] = useState(false);
  const [startDrag, setStartDrag] = useState<NonNullable<typeof effectDrag> | null>(null);
  const [optimisticStart, setStartLocally] = useOptimistic(partyStart, (_: Area | null, a: Area | null) => a);
  // First session: characters still to be placed, one at a time, by clicking inside the start area.
  const [placedLocally, markPlaced] = useOptimistic(toPlace, (cs: typeof toPlace, id: number) => cs.filter((c) => c.id !== id));
  const [placingId, setPlacingId] = useState<number | null>(null);
  const placingChar = placedLocally.find((c) => c.id === placingId) ?? placedLocally[0] ?? null;

  // Secrets: describe it, then click the map; shown straight away (optimistic).
  const [secretDraft, setSecretDraft] = useState<SecretDraft>({ name: "", text: "", discoveryId: null });
  type SecretChange = { add: MapSecret } | { remove: number } | { reveal: { id: number; revealed: boolean } };
  const [optimisticSecrets, changeSecrets] = useOptimistic(secrets, (ss: MapSecret[], c: SecretChange) =>
    "add" in c ? [...ss, c.add] : "remove" in c ? ss.filter((s) => s.id !== c.remove) : ss.map((s) => (s.id === c.reveal.id ? { ...s, revealed: c.reveal.revealed ? (1 as const) : (0 as const) } : s))
  );

  // Traps: pick a shape, then drag it out on the map; shown straight away (optimistic).
  const [trapShape, setTrapShape] = useState<TrapShape>("rect");
  const [trapDrag, setTrapDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  type TrapChange = { add: Trap } | { remove: number };
  const [optimisticTraps, changeTraps] = useOptimistic(traps, (ts: Trap[], c: TrapChange) => ("add" in c ? [...ts, c.add] : ts.filter((t) => t.id !== c.remove)));

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

  // Fog of war (players; not side-on maps): what their characters see now, past walls and closed doors, and what they saw before.
  // Recomputed only when the walls or the spots they've stood on change (not on every redraw or page refresh, which
  // hand over new arrays): one visibility polygon per spot adds up over a campaign.
  // The GM planning someone's round sees the map as they would: through that token's eyes (fog of war, only who it can
  // see), from where its plan has it by then, so there's no planning around what it couldn't know.
  const gmSel = useGmPlanToken();
  const planningAs = !readOnly && !!dockSide && gmSel !== null ? gmSel : null;
  const fogOn = (!!fog || planningAs !== null) && mapImage.perspective !== "portrait"; // side-on maps have no fog
  const wallsKey = optimisticStructures.map((w) => `${w.kind}${w.open}${w.x1},${w.y1},${w.x2},${w.y2}`).join("|"); // changes only when walls do
  const fogWalls = useMemo(() => blockingSegments(optimisticStructures), [wallsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // What they've seen before: a player's characters' spots, or (GM planning as a character) that character's.
  const exploredKey = !fogOn ? "" : planningAs !== null ? JSON.stringify(planExplored?.[planningAs] ?? []) : fog ? JSON.stringify(fog.explored) : "";
  const explored = useMemo(
    () => (exploredKey ? (JSON.parse(exploredKey) as Point[]).map((p) => visibilityPolygon(p, SIGHT, fogWalls)) : []),
    [exploredKey, fogWalls]
  );
  // Whose eyes the fog is seen through, and from where: what they see now is worked out again only when one of
  // them moves (or the walls, their sight or the planned spot change), not on every frame of a replay or effect.
  const fogCentre = (t: { col: number; row: number }) => ({ x: t.col + 0.5, y: t.row + 0.5 });
  const fogOwn = !fogOn ? [] : planningAs !== null ? drawnTokens.filter((t) => t.id === planningAs) : drawnTokens.filter((t) => t.character_id !== null && fog!.viewers.includes(t.character_id));
  const fogPlanEnd = planningAs !== null ? gmPlans?.[planningAs]?.from : undefined;
  const fogEyes = fogOwn.map((t) => ({ at: fogCentre(fogPlanEnd ?? t), range: (t.character_id !== null && fog?.sight?.[t.character_id]) || SIGHT })); // blind: only what's around them
  const eyesKey = JSON.stringify(fogEyes);
  const fogVisible = useMemo(() => fogEyes.map((e) => visibilityPolygon(e.at, e.range, fogWalls)), [eyesKey, fogWalls]); // eslint-disable-line react-hooks/exhaustive-deps
  const fogged = useMemo(() => {
    if (!fogOn) return null;
    const centre = fogCentre, own = fogOwn, planEndAt = fogPlanEnd, visible = fogVisible;
    const blindOf = (t: MapToken) => t.character_id !== null && !!fog?.sight?.[t.character_id];
    // In the dark (overall light below DARK_BELOW), they see only what's lit or within their darkvision.
    const dark = shownIllumination < DARK_BELOW && planningAs === null;
    const viewers = own.map((t) => ({ at: centre(planEndAt ?? t), dv: (t.character_id !== null && fog?.darkvision?.[t.character_id]) || 0, blind: blindOf(t) }));
    // Only tokens they can see are shown (and their own, always).
    const tokens = drawnTokens.filter((t) => own.includes(t) || viewers.some((v, i) => insidePolygon(centre(t), visible[i]) && (!dark || v.blind || brightEnough(v.at, centre(t), v.dv, shownIllumination, optimisticLights, fogWalls))));
    return { visible, explored, tokens, dark, viewers };
  }, [fogOn, fogVisible, JSON.stringify(fog?.darkvision ?? {}), shownIllumination, optimisticLights, fogWalls, explored, JSON.stringify(drawnTokens)]); // eslint-disable-line react-hooks/exhaustive-deps -- tokens by content (a new array every frame otherwise)
  // Move (players): while it's on, show how far their character can walk with the movement they have left.
  const moveOn = useMoveMode();
  // The GM planning a creature's round: its reach from where its plan leaves it.
  const gmPlan = !readOnly && gmSel !== null && moveOn ? gmPlans?.[gmSel] : undefined; // only while Move is on
  const reachAt = useMemo(() => {
    const m = gmPlan ? { feet: gmPlan.feetLeft, from: gmPlan.from, free: false, perSecond: gmPlan.perSecond } : moveOn ? fog?.move : null;
    if (!m || m.free || mapImage.perspective === "portrait") return null; // free movement has no overlay
    const token = gmPlan ? drawnTokens.find((x) => x.id === gmSel) : drawnTokens.find((x) => x.character_id === fog?.move?.characterId);
    if (!token) return null;
    const t = { ...token, ...(m.from ?? {}) }; // in an encounter, reach is from where their plan leaves them
    return { from: { col: t.col, row: t.row }, feet: m.feet, perSecond: m.perSecond ?? 0, at: t, token };
  }, [moveOn, fog?.move, gmPlan, gmSel, mapImage.perspective, drawnTokens]);
  // The area itself, worked out only when where they start, how far they can go or the walls change (it's costly on
  // gridless maps: the way round each wall end counts too).
  const reachFromKey = reachAt ? `${reachAt.from.col},${reachAt.from.row},${reachAt.feet}` : "";
  const reachArea = useMemo(() => {
    if (!reachAt) return null;
    const walls = movementBlockers(optimisticStructures); // windows block movement too
    const squares = reachAt.feet / FEET_PER_SQUARE, { col, row } = reachAt.from;
    if (gridless) {
      const areas = reachAreas({ x: col + 0.5, y: row + 0.5 }, squares, walls);
      return { kind: "area" as const, polys: areas.map((a) => a.poly), areas };
    }
    return { kind: "squares" as const, cells: reachableSquares({ col, row }, squares, walls) };
  }, [reachFromKey, wallsKey, gridless]); // eslint-disable-line react-hooks/exhaustive-deps
  const reach = reachAt && reachArea ? { ...reachAt, ...reachArea } : null;
  // A move being walked out on screen: the token follows its route (top-left corners, in grid units).
  const [walking, setWalking] = useState<{ id: number; route: Point[]; started: number } | null>(null);
  const WALK_MS = 140; // per square (or per unit on gridless maps)
  const walkAt = (w: NonNullable<typeof walking>): Point => {
    const lengths = w.route.slice(1).map((p, i) => Math.hypot(p.x - w.route[i].x, p.y - w.route[i].y));
    let d = (performance.now() - w.started) / WALK_MS;
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i]) {
        const a = w.route[i], b = w.route[i + 1], f = lengths[i] ? d / lengths[i] : 1;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      d -= lengths[i];
    }
    return w.route[w.route.length - 1];
  };
  const walkDone = (w: NonNullable<typeof walking>) =>
    performance.now() - w.started >= WALK_MS * w.route.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - w.route[i].x, p.y - w.route[i].y), 0);
  useEffect(() => {
    if (!walking) return;
    const t = setInterval(() => (walkDone(walking) ? setWalking(null) : setFlickerTick((n) => n + 1)), 16);
    return () => clearInterval(t);
  }, [walking]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Free movement: a click anywhere they've seen walks them there; the server finds the route and may stop it early. */
  function walkFree(gx: number, gy: number) {
    const m = fog?.move, t = m && drawnTokens.find((x) => x.character_id === m.characterId);
    if (!t || !fogged) return;
    if (![...fogged.visible, ...fogged.explored].some((poly) => insidePolygon({ x: gx, y: gy }, poly))) return;
    startTransition(async () => {
      const r = await freeMove(gx, gy);
      if (r.error) return setControlResult({ label: "Move", ok: false, text: r.error });
      if (!r.route || r.route.length < 2) return;
      const end = r.route[r.route.length - 1];
      setWalking({ id: t.id, route: r.route, started: performance.now() });
      changeTokens({ move: { id: t.id, col: end.x, row: end.y } });
      if (r.trap) setControlResult({ label: "Trap", ok: false, text: r.trap });
      else if (r.stopped) setControlResult({ label: "Move", ok: false, text: "Something stops you." });
    });
  }
  /** A click inside the movement overlay walks the player's character there. */
  function walkTo(gx: number, gy: number) {
    if (fog?.move?.free) return walkFree(gx, gy);
    if (!reach) return;
    // In an encounter a click plans the move (it happens when the round resolves).
    const col = reach.kind === "squares" ? Math.floor(gx) : snapHeight(gx - 0.5), row = reach.kind === "squares" ? Math.floor(gy) : snapHeight(gy - 0.5);
    if (reach.kind === "squares" ? !reach.cells.get(squareKey(col, row))?.steps : !reach.polys.some((poly) => insidePolygon({ x: gx, y: gy }, poly))) {
      setControlResult({ label: "Move", ok: false, text: `Out of reach: ${Math.floor(reach.feet)} ft of movement left this round` });
      return;
    }
    startTransition(async () => {
      const r = gmPlan && gmSel !== null ? await gmPlanStep(gmSel, { kind: "move", col, row }) : await planStep({ kind: "move", col, row });
      if (r.error) setControlResult({ label: "Plan", ok: false, text: r.error });
    });
  }
  const press = useRef<{ x: number; y: number; t: number; gx: number; gy: number } | null>(null);
  const tokenPress = useRef<{ x: number; y: number; id: number } | null>(null); // the GM pressing a token: a click opens its sheet
  const lift = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null); // holding on a token to pick it up
  // Picking a target by clicking a token: everyone shown except the one acting (players see only who's in sight).
  const targetMode = useTargetMode();
  const actingToken = targetMode ? (targetMode.tokenId ?? drawnTokens.find((t) => t.character_id === fog?.move?.characterId)?.id) : undefined;
  // Only the kind it's for (friendlies / enemies, as the one acting sees them), and in an aimed area only those there.
  const actorSide = allegianceOf(drawnTokens.find((t) => t.id === actingToken) ?? { character_id: null });
  const fitsTarget = (t: { id: number; allegiance: string | null; character_id: number | null }) =>
    (t.id !== actingToken || !!targetMode?.canSelf) && (t.id === actingToken || fits(targetMode?.targeting?.who ?? "", relation(actorSide, allegianceOf(t)))) && (!targetMode?.pickFrom || targetMode.pickFrom.includes(t.id)) && (t.id === actingToken || !targetMode?.visible || targetMode.visible.includes(t.id));
  const targetCandidates = targetMode && (!targetMode.area || targetMode.aimed) ? (fogged ? fogged.tokens : drawnTokens).filter(fitsTarget) : [];
  // Aiming an area attack: where the pointer is, and where the actor will be (where their plan leaves them).
  const [aimAt, setAimAt] = useState<Point | null>(null);
  const aimFrom = (() => {
    if (!targetMode || (!targetMode.area && !targetMode.range) || actingToken === undefined) return null;
    const t = drawnTokens.find((x) => x.id === actingToken);
    const from = targetMode.tokenId !== null ? gmPlans?.[targetMode.tokenId]?.from : fog?.move?.from;
    const p = from ?? t;
    return p ? { x: p.col + 0.5, y: p.row + 0.5 } : null;
  })();
  // A script's select() prompt: its options on this map are highlighted, and clicking one picks it.
  const scriptPick = useScriptPick();
  const pickPrompt = scriptPick?.prompt.kind === "select" && !scriptPick.busy ? scriptPick.prompt : null;
  const pickEntity = pickPrompt?.entity ?? null;
  const pickIds = new Set(pickPrompt ? pickPrompt.options.map((o) => o.id) : []);
  const fogCanvas = useRef<{ fog: HTMLCanvasElement; mask: HTMLCanvasElement } | null>(null);

  const state: MapState = {
    background, backgroundImage, mapImage, mapImageEl, grid,
    tiles: drawnTiles, tileImages: loadedTileImages, structures: optimisticStructures,
    showWalls: !readOnly && !optimisticHideWalls,
    // Down tokens get a skull; during playback, as of the second shown.
    down: new Set(replayFrame ? [...replayFrame.down, ...downTokens.filter((id) => !(replay && id in replay.start))] : downTokens),
    lifted: draggingToken?.id ?? null,
    // The GM sees the whole map fully lit; darkness and fog are for players.
    tokens: (fogged ? fogged.tokens : drawnTokens).map((t) => {
      if (walking?.id !== t.id) return t;
      const at = walkAt(walking);
      return { ...t, col: at.x, row: at.y };
    }), tokenImages: loadedTileImages, positional: drawnPositional, illumination: readOnly ? shownIllumination : 1, figureHeight,
    lights: optimisticLights, showLightAreas: selected === "lighting", notes: drawnNotes, secrets: optimisticSecrets, traps: optimisticTraps,
    effects: drawnEffects, lasting, time: performance.now() / 1000, showEffectAreas: selected === "effects",
  };

  /** The select() option at a point (grid units): a token, a door (near its line), a light, or a placed effect. */
  const pickAt = (gx: number, gy: number): number | undefined => {
    if (pickEntity === "token") return state.tokens.find((t) => pickIds.has(t.id) && gx >= t.col && gx <= t.col + 1 && gy >= t.row && gy <= t.row + 1)?.id;
    if (pickEntity === "door") {
      const near = state.structures
        .filter((d) => d.kind === "door" && pickIds.has(d.id))
        .map((d) => ({ id: d.id, d: pointToSegment({ x: gx, y: gy }, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }) }))
        .sort((a, b) => a.d - b.d)[0];
      return near && near.d < 0.4 ? near.id : undefined;
    }
    if (pickEntity === "light") return state.lights.find((l) => pickIds.has(l.id) && Math.hypot(l.x - gx, l.y - gy) < 0.6)?.id;
    if (pickEntity === "effect") {
      return state.effects.find((f) => pickIds.has(f.id) && f.x !== null && f.y !== null && gx >= f.x && gx <= f.x + (f.w ?? 0) && gy >= f.y && gy <= f.y + (f.h ?? 0))?.id;
    }
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
  /**
   * Where a structure line starts or ends. Snapping on: the nearest grid corner (on portrait maps only across;
   * heights follow the pointer). Snapping off (or Alt held): where the pointer is, to 1/20 of a cell, joining
   * the end of a nearby piece so walls drawn on irregular maps meet without gaps.
   */
  const cornerAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    if (!gridless && structureTool.snap !== e.altKey) return { x: Math.round(gx), y: portrait ? snapHeight(gy) : Math.round(gy) };
    const ends = optimisticStructures.filter((s) => s.kind !== "staircase").flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
    const near = ends
      .map((p) => ({ p, d: Math.hypot(p.x - gx, p.y - gy) }))
      .filter(({ d }) => d < JOIN_DISTANCE)
      .sort((a, b) => a.d - b.d)[0];
    return near ? near.p : { x: snapHeight(gx), y: snapHeight(gy) };
  };
  /** Where a token under the pointer goes: its cell, or on portrait maps its column with the pointer at its middle. */
  const tokenAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    if (gridless) return { col: snapHeight(gx - 0.5), row: snapHeight(gy - 0.5) }; // centred under the pointer
    return { col: Math.floor(gx), row: portrait ? snapHeight(gy - 0.5) : Math.floor(gy) };
  };
  /** Where a light or sound goes: the middle of the cell under the pointer, or right there on gridless maps. */
  const spotAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return gridless ? { x: snapHeight(gx), y: snapHeight(gy) } : { x: Math.floor(gx) + 0.5, y: Math.floor(gy) + 0.5 };
  };

  /** A tile's area: the cells from start to end, or on gridless maps the rectangle between the two points. */
  const spanOf = (p: NonNullable<typeof placing>): CellRect => ({
    col: Math.min(p.start.col, p.end.col),
    row: Math.min(p.start.row, p.end.row),
    cols: Math.abs(p.end.col - p.start.col) + (gridless ? 0 : 1),
    rows: Math.abs(p.end.row - p.start.row) + (gridless ? 0 : 1),
  });
  /** Tiles: the cell under the pointer, or on gridless maps the point itself (to 1/20 of a unit). */
  const tilePointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { gx, gy } = gridAt(e);
    return gridless ? { col: snapHeight(gx), row: snapHeight(gy) } : { col: Math.floor(gx), row: Math.floor(gy) };
  };
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
  // Picking a creature to plan for: if it's off screen (or under the dock), pan so it's in the middle of what's visible.
  useEffect(() => {
    if (readOnly || gmSel === null || !canvasSize.w) return;
    const t = state.tokens.find((x) => x.id === gmSel);
    if (!t) return;
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const fit = fitScene(canvasSize.w, canvasSize.h);
    const mx = fit.ox + (x0 + (t.col + 0.5) * size) * fit.s, my = fit.oy + (y0 + (t.row + 0.5) * size) * fit.s; // at zoom 1
    const left = dockSide === "left" ? dockWidth : 0, right = canvasSize.w - (dockSide === "right" ? dockWidth : 0);
    setView((v) => {
      const sx = v.x + v.zoom * mx, sy = v.y + v.zoom * my, pad = 40;
      if (sx > left + pad && sx < right - pad && sy > pad && sy < canvasSize.h - pad) return v;
      return { ...v, x: (left + right) / 2 - v.zoom * mx, y: canvasSize.h / 2 - v.zoom * my };
    });
  }, [gmSel]); // eslint-disable-line react-hooks/exhaustive-deps
  // A contested move waiting on the GM: zoom and centre on everything involved (the two creatures where they stand
  // and where they were when it happened, and the spot), in what's visible above the decision card.
  useEffect(() => {
    if (!contest || !canvasSize.w) return;
    const { x0, y0, size } = gridOrigin(state, SCENE.w, SCENE.h);
    const fit = fitScene(canvasSize.w, canvasSize.h);
    const box = contestBox(contest, state.tokens);
    const px = (c: number) => fit.ox + (x0 + c * size) * fit.s, py = (r: number) => fit.oy + (y0 + r * size) * fit.s; // at zoom 1
    const w = px(box.c1) - px(box.c0), h = py(box.r1) - py(box.r0);
    const left = dockSide === "left" ? dockWidth : 0, right = canvasSize.w - (dockSide === "right" ? dockWidth : 0);
    const bottom = canvasSize.h - 190; // the decision card sits along the bottom
    const zoom = Math.min(3, Math.max(0.5, Math.min((right - left - 120) / w, (bottom - 100) / h)));
    const mx = (px(box.c0) + px(box.c1)) / 2, my = (py(box.r0) + py(box.r1)) / 2;
    setView({ zoom, x: (left + right) / 2 - zoom * mx, y: bottom / 2 + 20 - zoom * my });
  }, [contest?.key, canvasSize.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Answering a script's select(): click picks one, shift+click adds or removes it. Other left clicks do nothing meanwhile.
    if (pickEntity && e.button === 0) {
      const { gx, gy } = gridAt(e);
      const id = pickAt(gx, gy);
      if (id !== undefined) choose(id, e.shiftKey);
      return;
    }
    // Picking a target for a planned action: a click on a token chooses it (only tokens shown on this map).
    if (targetMode?.area && !targetMode.aimed && e.button === 0) {
      // Aiming an area: the click is where it goes (a circle's centre, or the way a cone or line points).
      const { gx, gy } = gridAt(e);
      const m = targetMode;
      // More of the kind it's for in the area than it may affect (up to N enemies…): they pick which (in the panel or on the map).
      if (m.area && m.targeting && m.targeting.count !== "all" && aimFrom) {
        const placed = placeArea(m.area.shape, m.area.ft, aimFrom, { x: gx, y: gy }), walls = blockingSegments(optimisticStructures);
        const inside = (fogged ? fogged.tokens : drawnTokens).filter((t) => fitsTarget(t) && caughtBy(placed, { x: t.col + 0.5, y: t.row + 0.5 }, walls)).map((t) => t.id);
        if (inside.length > maxPicks(m.targeting)) {
          setTargetMode({ ...m, aimed: { col: Math.round(gx * 20) / 20, row: Math.round(gy * 20) / 20 }, pickFrom: inside, picks: [] });
          setAimAt(null);
          return;
        }
      }
      setTargetMode(null);
      setAimAt(null);
      startTransition(async () => {
        const step = { kind: "action" as const, action: m.action, use: m.use, aim: { col: Math.round(gx * 20) / 20, row: Math.round(gy * 20) / 20 } };
        const r = m.tokenId !== null ? await gmPlanStep(m.tokenId, step) : await planStep(step);
        if (r.error) setControlResult({ label: "Plan", ok: false, text: r.error });
      });
      return;
    }
    if (targetMode && e.button === 0) {
      const { gx, gy } = gridAt(e);
      const hit = targetCandidates.find((t) => gx >= t.col && gx <= t.col + 1 && gy >= t.row && gy <= t.row + 1);
      if (!hit) return;
      const m = targetMode;
      // Picking several (or which of those in an aimed area): a click adds or removes one; Done in the panel plans it.
      if ((picksSeveral(m.targeting) && !m.area) || m.aimed) {
        const picks = m.picks ?? [];
        setTargetMode({ ...m, picks: picks.includes(hit.id) ? picks.filter((x) => x !== hit.id) : [...picks, hit.id] });
        return;
      }
      setTargetMode(null);
      startTransition(async () => {
        const step = { kind: "action" as const, action: m.action, target: hit.id, ...(m.use !== undefined ? { use: m.use } : {}), ...(m.seconds ? { seconds: m.seconds } : {}) };
        const r = m.tokenId !== null ? await gmPlanStep(m.tokenId, step) : await planStep(step);
        if (r.error) setControlResult({ label: "Plan", ok: false, text: r.error });
      });
      return;
    }
    // The GM planning a creature's move (Move on): a left click (no drag, not a hold) plans it, whatever layer editor
    // was last open (it would otherwise take the click and nothing would happen). Right-drag still pans.
    if (gmPlan && reach && e.button === 0) {
      press.current = { x: e.clientX, y: e.clientY, t: performance.now(), ...gridAt(e) };
      return;
    }
    // The GM pressing a token (no layer editor open, or the tokens one): a click (no drag) opens its character sheet.
    tokenPress.current = null;
    if (!readOnly && dockSide && e.button === 0 && (selected === null || selected === "tokens") && !placingChar) {
      const { gx, gy } = gridAt(e);
      const hit = [...(replayedTokens ?? drawnTokens)].reverse().find((t) => gx >= t.col && gx <= t.col + 1 && gy >= t.row && gy <= t.row + 1);
      if (hit) tokenPress.current = { x: e.clientX, y: e.clientY, id: hit.id };
    }
    // A player in an encounter clicking someone else they can see (not moving or picking a target): their selected target.
    if (readOnly && fog?.move && !fog.move.free && !moveOn && !targetMode && e.button === 0) {
      const { gx, gy } = gridAt(e);
      const hit = [...(fogged ? fogged.tokens : drawnTokens)].reverse().find((t) => t.character_id !== fog.move!.characterId && gx >= t.col && gx <= t.col + 1 && gy >= t.row && gy <= t.row + 1);
      if (hit) tokenPress.current = { x: e.clientX, y: e.clientY, id: hit.id };
    }
    // Press and hold (without moving) to ping: players anywhere, the GM when no layer editor is open.
    if (dockSide && e.button === 0 && (readOnly || (selected === null && !placingChar))) {
      const { gx, gy } = gridAt(e);
      if (hold.current) clearTimeout(hold.current.timer);
      hold.current = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          hold.current = null;
          addPings([{ key: `me${Date.now()}`, x: gx, y: gy, name: "You", gm: !readOnly, at: Date.now() }]);
          sendPing(levelId, gx, gy);
        }, HOLD_MS),
      };
    }
    if (readOnly) {
      // Players pan (any button); a click (left, no drag, not a hold) inside the movement overlay moves them.
      if (e.button === 0) press.current = { x: e.clientX, y: e.clientY, t: performance.now(), ...gridAt(e) };
      drag.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && placingChar && optimisticStart) {
      const { gx, gy } = gridAt(e);
      const a = optimisticStart;
      if (gx < a.x || gx > a.x + a.w || gy < a.y || gy > a.y + a.h) return; // only inside the start area
      const { col, row } = tokenAt(e);
      const c = placingChar;
      setPlacingId(null);
      startTransition(async () => {
        markPlaced(c.id);
        await placeInStartArea(locationId, c.id, col, row);
      });
      return;
    }
    if (e.button === 0 && selected === "traps") {
      const { gx, gy } = gridAt(e);
      const at = { x: quarter(gx), y: quarter(gy) };
      setTrapDrag({ start: at, end: at });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0 && selected === "secrets") {
      const d = secretDraft;
      if (!d.name.trim()) return;
      const { gx, gy } = gridAt(e);
      const placed = { x: gx, y: gy, name: d.name.trim(), text: d.text.trim(), discovery_id: d.discoveryId };
      setSecretDraft({ name: "", text: "", discoveryId: null });
      startTransition(async () => {
        changeSecrets({ add: { id: -Date.now(), ...placed, revealed: 0 } });
        await placeSecret(locationId, levelId, placed);
      });
      return;
    }
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
      const t = lightTool;
      const placed = { kind: t.kind, ...spotAt(e), radius: t.radius, angle: t.angle, spread: t.spread, flicker: t.flicker };
      startTransition(async () => {
        changeLights({ add: { id: -Date.now(), ...placed, flicker: placed.flicker ? 1 : 0, name: "New light", enabled: 1 } });
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
      const placed = { ...spotAt(e), radius: positionalTool.radius };
      startTransition(async () => {
        changePositional({ add: { id: -Date.now(), asset_id: a.id, name: a.name, url: a.url, volume: 1, loop: 0, ...placed } });
        await placePositionalSound(locationId, levelId, a.id, placed.x, placed.y, placed.radius);
      });
      return;
    }
    if (e.button === 0 && selected === "tokens" && markingStart) {
      const { gx, gy } = gridAt(e);
      const corner = { x: quarter(gx), y: quarter(gy) };
      setStartDrag({ start: corner, end: corner });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // In a session the GM can drag any token straight away (no layer selected): to reposition after a round, say.
    const gmDrag = !!dockSide && !readOnly && selected === null && !gmPlan && !placingChar;
    if (e.button === 0 && (selected === "tokens" || gmDrag)) {
      const { col, row } = tokenAt(e);
      // Pressing on a token picks it up (topmost first); otherwise place the chosen creature.
      const { gx, gy } = gridAt(e);
      // A side-on figure can be taller than its cell: it can be grabbed anywhere up to the top of its head.
      const top = (t: MapToken) => (portrait && t.token_side ? t.row + 1 - Math.max(1, figureCells(figureHeight, t)) : t.row);
      const hit = [...optimisticTokens].reverse().find((t) => gx >= t.col && gx < t.col + 1 && gy >= top(t) && gy < t.row + 1);
      if (hit) {
        // Never in a player's view. The GM presses and holds to pick a token up (a quick click stays a click).
        if (readOnly) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (hold.current) {
          clearTimeout(hold.current.timer); // holding on a token lifts it rather than pinging
          hold.current = null;
        }
        if (lift.current) clearTimeout(lift.current.timer);
        lift.current = {
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => {
            lift.current = null;
            tokenPress.current = null; // it's a move now, not a click
            setSelectedTokenId(hit.id);
            setDraggingToken({ id: hit.id, col: hit.col, row: hit.row });
          }, LIFT_MS),
        };
        return;
      }
      if (selected !== "tokens") return; // (dragging only) — placing new tokens is the Tokens layer's job
      if (!tokenCreature) return;
      const c = tokenCreature;
      const character = c.kind === "character";
      startTransition(async () => {
        // A character has one token per level: placing it again on this level moves it here.
        const existing = character ? optimisticTokens.find((t) => t.character_id === c.id) : undefined;
        if (existing) changeTokens({ remove: existing.id });
        changeTokens({
          add: {
            id: -Date.now(), creature_id: character ? null : c.id, character_id: character ? c.id : null, name: c.name, image: c.image,
            token_overhead: c.token_overhead, token_side: c.token_side, height: c.height, col, row: settle(col, row), hp: null, allegiance: null,
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
        // A level link fills a cell, or on gridless maps a unit square centred on the pointer.
        const cell = gridless ? tokenAt(e) : cellAt(e);
        const target = otherLevels.find((l) => l.id === structureTool.targetLevelId)!;
        const piece = { kind: "staircase" as const, x1: cell.col, y1: cell.row, x2: cell.col, y2: cell.row, target_level_id: target.id };
        startTransition(async () => {
          changeStructures({ add: { id: -Date.now(), ...piece, target_name: target.name, open: 0, name: null, locked: 0, lock_dc: 15 } });
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
      const { gx, gy } = gridAt(e);
      const t = selectedTile;
      if (gx >= t.col && gx < t.col + t.cols && gy >= t.row && gy < t.row + t.rows) {
        setMoving({ grab: tilePointAt(e), delta: { col: 0, row: 0 } });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (e.button === 0 && selected === "tiles" && tileAsset) {
      const cell = tilePointAt(e);
      setPlacing({ start: cell, end: cell });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 2) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (targetMode?.area) {
      const { gx, gy } = gridAt(e);
      setAimAt({ x: gx, y: gy });
    }
    if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 6) {
      clearTimeout(hold.current.timer); // moved: it's a drag, not a ping
      hold.current = null;
    }
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
    if (startDrag) {
      const { gx, gy } = gridAt(e);
      const end = { x: quarter(gx), y: quarter(gy) };
      if (end.x !== startDrag.end.x || end.y !== startDrag.end.y) setStartDrag({ ...startDrag, end });
      return;
    }
    if (trapDrag) {
      const { gx, gy } = gridAt(e);
      const end = { x: quarter(gx), y: quarter(gy) };
      if (end.x !== trapDrag.end.x || end.y !== trapDrag.end.y) setTrapDrag({ ...trapDrag, end });
      return;
    }
    if (effectDrag) {
      const { gx, gy } = gridAt(e);
      const end = { x: quarter(gx), y: quarter(gy) };
      if (end.x !== effectDrag.end.x || end.y !== effectDrag.end.y) setEffectDrag({ ...effectDrag, end });
      return;
    }
    if (draggingSound) {
      const { x, y } = spotAt(e);
      if (x !== draggingSound.x || y !== draggingSound.y) setDraggingSound({ ...draggingSound, x, y });
      return;
    }
    // Moving before the hold is up: not a pick-up after all.
    if (lift.current && Math.hypot(e.clientX - lift.current.x, e.clientY - lift.current.y) > 6) {
      clearTimeout(lift.current.timer);
      lift.current = null;
    }
    if (draggingToken) {
      const { col, row } = tokenAt(e);
      if (col !== draggingToken.col || row !== draggingToken.row) setDraggingToken({ ...draggingToken, col, row });
      return;
    }
    if (drawingLine) {
      let corner = cornerAt(e);
      // Shift: a straight line across or up and down, whichever way it's mostly going.
      if (e.shiftKey) {
        const { start } = drawingLine;
        corner = Math.abs(corner.x - start.x) >= Math.abs(corner.y - start.y) ? { x: corner.x, y: start.y } : { x: start.x, y: corner.y };
      }
      if (corner.x !== drawingLine.end.x || corner.y !== drawingLine.end.y) setDrawingLine({ ...drawingLine, end: corner });
      return;
    }
    if (moving) {
      const cell = tilePointAt(e);
      const delta = { col: snapHeight(cell.col - moving.grab.col), row: snapHeight(cell.row - moving.grab.row) };
      if (delta.col !== moving.delta.col || delta.row !== moving.delta.row) setMoving({ ...moving, delta });
      return;
    }
    if (placing) {
      const cell = tilePointAt(e);
      if (cell.col !== placing.end.col || cell.row !== placing.end.row) setPlacing({ ...placing, end: cell });
      return;
    }
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    if (lift.current) {
      clearTimeout(lift.current.timer); // let go before it lifted: just a click
      lift.current = null;
    }
    const p = press.current;
    press.current = null;
    const tp = tokenPress.current;
    tokenPress.current = null;
    if (tp && e && Math.hypot(e.clientX - tp.x, e.clientY - tp.y) <= 6) {
      // In an encounter, a click on someone who plans this round opens planning for them (or switches to them); the
      // planning panel shows their details, so no sheet card. Anyone else (or out of an encounter): their sheet.
      if (!readOnly && gmPlans?.[tp.id]) {
        if (tp.id !== planningAs) {
          setMoveMode(false);
          setTargetMode(null);
          setSheetToken(null);
          setGmPlanToken(tp.id);
        }
      } else if (readOnly) {
        if (tp.id !== selectedTarget) startTransition(async () => {
          const r = await selectTarget(tp.id);
          if (r.error) setControlResult({ label: "Target", ok: false, text: r.error });
        });
      } else if (planningAs === null) setSheetToken(tp.id);
    }
    if (p && e && (readOnly || gmPlan) && (reach || (moveOn && fog?.move?.free)) && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 6 && performance.now() - p.t < HOLD_MS) walkTo(p.gx, p.gy);
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current = null;
    }
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
    if (startDrag) {
      const area = effectRect(startDrag);
      setStartDrag(null);
      if (area.w < 0.25 || area.h < 0.25) return; // a click without a drag marks nothing
      setMarkingStart(false);
      startTransition(async () => {
        setStartLocally(area);
        await setPartyStart(locationId, levelId, area);
      });
      return;
    }
    if (trapDrag) {
      const area = trapFromDrag(trapShape, trapDrag);
      setTrapDrag(null);
      if (!area) return; // a click without a drag places nothing
      startTransition(async () => {
        changeTraps({ add: { id: -Date.now(), name: "Trap", area, springs: ["enter"], who: "", often: "once", damage: null, damage_type: "", save_attr: "agility", save_dc: 12, save_half: 1, effects: [], stops: 1, find_dc: 14, found: 0, sprung: [] } });
        await placeTrap(locationId, levelId, area);
      });
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
        changeStructures({ add: { id: -Date.now(), ...piece, target_name: null, open: 0, name: null, locked: 0, lock_dc: 15 } });
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
      if (gridless && (span.cols < 0.25 || span.rows < 0.25)) return; // gridless: a click without a drag places nothing
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
      drawSessionOverlays(ctx, state, k, { canvas, fogged, fogCanvas, fogWalls, replayFrame, scriptFx, readOnly, gmSel, pickEntity, pickIds, scriptPick, targetMode, aimAt, aimFrom, actingToken, targetCandidates, gridless, contest, planRoutes, planTargets, selectedTarget, drawnTokens, reach });
      drawPings(ctx, state, pings, k); // on top of everything (even fog)
      drawEditorAids(ctx, state, k, {
        tile: selected === "tiles" ? drawnTiles.find((t) => t.id === selectedTileId) : undefined,
        note: selected === "notes" ? drawnNotes.find((n) => n.id === selectedNoteId) : undefined,
        light: selected === "lighting" ? optimisticLights.find((l) => l.id === selectedLightId) : undefined,
        sound: selected === "sounds" ? drawnPositional.find((p) => p.id === selectedPositionalId) : undefined,
        token: selected === "tokens" ? drawnTokens.find((t) => t.id === selectedTokenId) : undefined,
        line: drawingLine && structureTool.kind !== "staircase" ? { ...drawingLine, kind: structureTool.kind } : null,
        piece: selected === "structure" ? optimisticStructures.find((x) => x.id === selectedStructureId) : undefined,
        trap: trapDrag ? trapFromDrag(trapShape, trapDrag) : null,
        effectArea: effectDrag ? effectRect(effectDrag) : null,
        startArea: startDrag ? effectRect(startDrag) : selected === "tokens" || placingChar ? optimisticStart : null,
        placing: placing ? spanOf(placing) : null,
      });
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

  const surface = (
    <>
            <ScriptPickOverlay owner="control" />
            {targetMode && (
              <div
                data-target-banner
                className="absolute top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-box bg-warning px-3 py-2 text-sm text-warning-content shadow"
                style={{ left: `calc(50% + ${(dockSide === "left" ? dockWidth : dockSide === "right" ? -dockWidth : 0) / 2}px)` }}
              >
                {targetMode.area ? `${targetMode.label}: click where to aim it` : targetMode.label ? `${targetMode.label}: click the target` : `Click who to ${targetMode.action}`}
                <button type="button" className="btn btn-xs" onClick={() => setTargetMode(null)}>Cancel</button>
              </div>
            )}
            {replayFrame && replay && (
              <div
                data-replay
                className="pointer-events-none absolute top-2 z-10 w-[min(32rem,calc(100%-8rem))] -translate-x-1/2 rounded-box bg-base-100/90 p-2 text-sm shadow"
                // Centred on the part of the map the dock leaves visible.
                style={{ left: `calc(50% + ${(dockSide === "left" ? dockWidth : dockSide === "right" ? -dockWidth : 0) / 2}px)` }}
              >
                <div className="font-semibold">
                  Round {replay.round}{replayFrame.startsIn ? ` plays in ${replayFrame.startsIn}…` : replayFrame.sec === 0 ? " · before it" : ` · ${replayFrame.sec} s`}
                  {"scrubbing" in replayFrame && <span className="ml-2 badge badge-warning badge-sm">replay (only you see this)</span>}
                </div>
                {replayFrame.lines
                  .filter((l) => !replayName || l.includes(replayName)) // players see what involves them; the GM sees it all
                  .map((l, i) => <p key={i} className="text-xs">{l}</p>)}
              </div>
            )}
            {placingChar && (
              <div data-place-party className="absolute left-1/2 top-2 z-10 w-[min(36rem,calc(100%-1rem))] -translate-x-1/2 rounded-box bg-base-100/90 p-2 text-sm shadow space-y-1">
                <div>
                  <span className="font-semibold">Place the party.</span> Click inside the green start area to place{" "}
                  <span className="font-semibold">{placingChar.name}</span> <span className="opacity-60">({placingChar.player})</span>.
                </div>
                <div className="flex flex-wrap gap-1">
                  {placedLocally.map((c) => (
                    <button key={c.id} type="button" aria-pressed={c.id === placingChar.id} className={`btn btn-xs ${c.id === placingChar.id ? "btn-primary" : ""}`} onClick={() => setPlacingId(c.id)}>
                      {c.image && <img src={c.image} alt="" className="size-4 rounded-full object-cover" />}
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Control buttons float above every layer, along the scene's edges (they move with zoom/pan). */}
            {!hiddenSet.has("controls") && (
              <ControlButtons
                controls={controls}
                size={canvasSize}
                inset={{ left: dockSide === "left" ? dockWidth : 0, right: dockSide === "right" ? dockWidth : 0 }}
                onRun={(c) =>
                  startTransition(async () => {
                    const r = await runWithPrompts("control", (answers) => runControl(locationId, c.id, answers));
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
    </>
  );
  const footer = (
            <div className="flex items-center justify-end gap-1 text-xs">
              {controlResult && (
                <span data-control-result className={`mr-auto truncate ${controlResult.ok ? "" : "text-error"}`} title={controlResult.text}>
                  {controlResult.label}: {controlResult.text.replace(/\s+/g, " ")}
                  <button type="button" className="btn btn-ghost btn-xs" aria-label="Dismiss" onClick={() => setControlResult(null)}>✕</button>
                </span>
              )}
              <span className="opacity-60 mr-1">Scroll to zoom · {readOnly ? "drag" : "right-drag"} to pan</span>
              <span className="badge badge-neutral" data-zoom>{Math.round(view.zoom * 100)}%</span>
              <button type="button" className="btn btn-xs" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>Reset view</button>
              {!readOnly && !dockSide && <button type="button" className={`btn btn-xs ${focus ? "btn-primary" : ""}`} aria-pressed={focus} onClick={() => setFocus(!focus)} title="Hide the campaign menu to give the map more room">
                Focus
              </button>}
            </div>
  );
  const layersPanel = (
    <>
        <ul className={`grid ${dockSide ? "grid-cols-2" : "grid-cols-4 2xl:grid-cols-2"} gap-x-1 bg-base-200 rounded-box p-2 text-sm`}>
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
                  onClick={() => setSelected(selected === layer ? null : layer)} // again: put the editor away
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
              <ControlsEditor locationId={locationId} levelId={levelId} controls={controls} names={scriptNames} />
            ) : selected === "traps" ? (
              <TrapsEditor
                locationId={locationId}
                effects={trapEffects}
                shape={trapShape}
                onShape={setTrapShape}
                traps={optimisticTraps}
                onRemove={(id) =>
                  startTransition(async () => {
                    changeTraps({ remove: id });
                    await removeTrap(locationId, id);
                  })
                }
              />
            ) : selected === "secrets" ? (
              <SecretsEditor
                draft={secretDraft}
                onDraftChange={setSecretDraft}
                discoveries={discoveries}
                secrets={optimisticSecrets}
                onReveal={(s, revealed) =>
                  startTransition(async () => {
                    changeSecrets({ reveal: { id: s.id, revealed } });
                    await revealSecret(locationId, s.id, revealed, s.discovery_id);
                  })
                }
                onRemove={(id) =>
                  startTransition(async () => {
                    changeSecrets({ remove: id });
                    await removeSecret(locationId, id);
                  })
                }
              />
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
                onRename={(id, name) => startTransition(() => renameThing(locationId, "map_effects", id, name))}
                onSwitch={(id, on) => startTransition(() => switchThing(locationId, "map_effects", id, on))}
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
                onRename={(id, name) => startTransition(() => renameThing(locationId, "light_sources", id, name))}
                onSwitch={(id, on) => startTransition(() => switchThing(locationId, "light_sources", id, on))}
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
                partyStart={optimisticStart}
                partyStartElsewhere={partyStartElsewhere}
                markingStart={markingStart}
                onMarkingStartChange={setMarkingStart}
                onClearStart={() =>
                  startTransition(async () => {
                    setStartLocally(null);
                    await removePartyStart(locationId);
                  })
                }
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
                gridless={gridless}
                tool={structureTool}
                onToolChange={setStructureTool}
                levels={otherLevels}
                pieces={optimisticStructures}
                wallsShown={!optimisticHideWalls}
                onWallsShownChange={(shown) =>
                  startTransition(async () => {
                    setHideWallsLocally(!shown);
                    await setWallsHidden(locationId, levelId, !shown);
                  })
                }
                selectedId={selectedStructureId}
                onSelect={(id) => setSelectedStructureId(id === selectedStructureId ? null : id)}
                onToggleDoor={(id, open) => toggleDoor(locationId, id, open)}
                onRenameDoor={(id, name) => startTransition(() => renameThing(locationId, "map_structures", id, name))}
                onLockDoor={(id, locked) => startTransition(() => lockDoor(locationId, id, locked))}
                onLockDc={(id, dc) => startTransition(() => changeLockDc(locationId, id, dc))}
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
                gridless={gridless}
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
    </>
  );

  // In a session: the map fills the browser, with the UI as overlays and the tools in a dock on one edge.
  if (dockSide) {
    const tools: DockTool[] = [...(readOnly ? [] : [{ id: "map", label: "Map layers", icon: "layers" as const, content: layersPanel }]), ...dockTools];
    return (
      <div className="fixed inset-0 overflow-hidden bg-base-300">
        {surface}
        <div className={`absolute bottom-2 z-10 rounded-box bg-base-200/80 p-1 backdrop-blur ${dockOpposite ? "left-1/2 -translate-x-1/2" : dockSide === "left" ? "right-2" : "left-2"}`}>{footer}</div>
        {/* Leaving the map layers panel puts the layer editor away too, so map clicks go back to play (sheets, moves). */}
        {/* The GM planning a creature's round sees what a player sees (its sheet on the left, planning on the right), so their own dock steps aside. */}
        {!(dockSide === "left" && !readOnly && gmSel !== null) && <PlayDock side={dockSide} tools={tools} initial={dockInitial} onWidth={setDockWidth} onOpen={(id) => id !== "map" && setSelected(null)} />}
        {dockOpposite && <PlayDock side={dockSide === "left" ? "right" : "left"} tools={dockOpposite.tools} initial={dockOpposite.initial ?? null} />}
      </div>
    );
  }

  return (
    // Wide screens: the map fills the window's height, with the layers and the selected layer's editor in a
    // column on the right. Narrower: the map keeps a 16:9 shape and the column goes underneath.
    <div className="flex flex-col 2xl:flex-row gap-4 2xl:h-[calc(100dvh-14.5rem)] 2xl:in-data-focus:h-[calc(100dvh-12.5rem)] 2xl:min-h-[30rem]">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="relative overflow-hidden rounded-box bg-base-300 aspect-video 2xl:aspect-auto 2xl:flex-1 2xl:min-h-0">
            {surface}
            </div>
            {footer}
        </div>
        {!readOnly && (
        <div className="2xl:w-[30rem] shrink-0 flex flex-col gap-3 min-h-0">
          {layersPanel}
        </div>
        )}
    </div>
  );
}

