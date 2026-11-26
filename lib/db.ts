import { asSpeed, ftPerSec } from "@/lib/speed";
import type { Affliction, Condition, Duration, Effect, Lifecycle, Modifier } from "@/lib/conditions";
import { BUILTIN_CONDITIONS, BUILTIN_EFFECTS, BUILTIN_PIECES } from "@/lib/builtinConditions";
import { DEFAULT_LIFECYCLE, asCondition, reapplied } from "@/lib/conditions";
import { SEEDED_EFFECTS, compileSeed } from "@/lib/seedEffects";
import type { RollSpec, RolledPart } from "@/lib/rolls";
import type { PlanStep } from "@/lib/roundPlan";
import type { Replay } from "@/lib/resolveRound";
import type { Fx } from "@/lib/vfx";
import type { Status } from "@/lib/status";
import type { TargetCount, TargetWho } from "@/lib/sides";
import crypto from "node:crypto";
import { CREATURE_TYPES, MOVEMENT_TYPES, type CreatureType, type Movement } from "@/lib/creatureTypes";
import type { Attribute, Attributes } from "@/lib/attributes";
import { NO_SAVE_DC, areaFires, caughtFire, ignite, isFire, type AreaShape, type LastingArea } from "@/lib/aoe";
import type { Exposure, Exposures } from "@/lib/exposure";
import type { Trap, TrapArea } from "@/lib/traps";
import type { MapTrigger } from "@/lib/triggers";
import {
  DEFAULT_BACKGROUND, DEFAULT_GRID, DEFAULT_MAP_IMAGE, DEFAULT_TEMPLATE_COLORS,
  type ClipMode, type ControlEdge, type LightKind, type MapBackground, type MapGrid, type MapImage, type MapLayer, type StructureKind, type TemplateColors,
} from "@/lib/maps";
import type { ModifierTarget } from "@/lib/modifiers";
import type { Boost, DamageType, DurationUnit, RollGrant, RollMode } from "@/lib/actions";
import type { EffectKind } from "@/lib/effects";
import { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity } from "@/lib/itemTypes";

import { DATA_DIR, addColumn, db, nameUnnamed } from "@/lib/db/connection";
export { DATA_DIR, addColumn, db };

export default db;

export { CREATURE_TYPES, type CreatureType };
export { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity };
export * from "@/lib/db/calendar";
import { getGameTime } from "@/lib/db/calendar";
export * from "@/lib/db/users";
import { type Role } from "@/lib/db/users";
export * from "@/lib/db/sessions";
import { getOpenGameSession } from "@/lib/db/sessions";
export * from "@/lib/db/catalog";
import { type Item, getItem, getCharacter, listCharacterProfessionIds, setCharacterRank, rankChain, saveProfessionGroup, listProfessions } from "@/lib/db/catalog";

// Professions are progressions of ranks: each rank (a `professions` row) belongs to a profession (`profession_groups`),
// and a character has one rank (`characters.rank_id`), holding every rank before it too.
db.exec("CREATE TABLE IF NOT EXISTS profession_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '')");
addColumn("professions", "group_id", "INTEGER"); // its profession (profession_groups)
addColumn("characters", "rank_id", "INTEGER"); // their rank (professions)
// One-time migration: each first rank (no rank advances to it) becomes a profession, with every rank it leads to;
// a character's ticked professions become their furthest rank.
if (db.prepare("SELECT 1 FROM professions WHERE group_id IS NULL").get()) {
  db.transaction(() => {
    db.prepare("UPDATE professions SET name = 'Infantryman' WHERE name = 'Infrantryman'").run();
    const NAMES: Record<string, string> = { Infantryman: "Military", "Beat Cop": "Law Enforcement", "Fortune Teller": "Mysticism", Nurse: "Medicine", "Lab Technician": "Science", Tinkerer: "Engineering", "School Teacher": "Education", "Street Rat": "Underworld" };
    const links = db.prepare<[], { from_id: number; to_id: number }>("SELECT from_id, to_id FROM profession_advancements").all();
    const firsts = listProfessions().filter((p) => p.group_id === null && !links.some((l) => l.to_id === p.id));
    for (const first of firsts) {
      const group = saveProfessionGroup(null, { name: NAMES[first.name] ?? first.name, description: "" });
      const todo = [first.id], seen = new Set<number>();
      while (todo.length) {
        const id = todo.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        db.prepare("UPDATE professions SET group_id = ? WHERE id = ? AND group_id IS NULL").run(group, id);
        todo.push(...links.filter((l) => l.from_id === id).map((l) => l.to_id));
      }
    }
    // Anything left (a loop with no first rank): a profession of its own.
    for (const p of listProfessions().filter((x) => x.group_id === null)) db.prepare("UPDATE professions SET group_id = ? WHERE id = ?").run(saveProfessionGroup(null, { name: p.name, description: "" }), p.id);
    const held = db.prepare<[], { character_id: number; profession_id: number }>("SELECT character_id, profession_id FROM character_professions").all();
    for (const c of new Set(held.map((h) => h.character_id))) {
      const furthest = held.filter((h) => h.character_id === c).map((h) => h.profession_id).sort((a, b) => rankChain(b).length - rankChain(a).length)[0];
      setCharacterRank(c, furthest);
    }
  })();
}

export interface Location {
  id: number;
  parent_id: number | null;
  name: string;
  description: string;
}

/** All locations, each with its ancestry path, e.g. "North America › United States › The West". */
export function listLocations(): (Location & { path: string })[] {
  const all = db.prepare<[], Location>("SELECT id, parent_id, name, description FROM locations").all();
  const byId = new Map(all.map((l) => [l.id, l]));
  const path = (l: Location, seen = new Set<number>()): string[] => {
    const parent = l.parent_id !== null ? byId.get(l.parent_id) : undefined;
    if (!parent || seen.has(parent.id)) return [];
    seen.add(parent.id);
    return [...path(parent, seen), parent.name];
  };
  return all
    .map((l) => ({ ...l, path: path(l).join(" › ") }))
    .sort((a, b) => `${a.path} › ${a.name}`.localeCompare(`${b.path} › ${b.name}`));
}

export function getLocation(id: number): Location | undefined {
  return db.prepare<[number], Location>("SELECT id, parent_id, name, description FROM locations WHERE id = ?").get(id);
}

/** Inserts when id is null, otherwise updates. */
export function saveLocation(id: number | null, l: Omit<Location, "id">): void {
  if (id === null) {
    db.prepare<Omit<Location, "id">>("INSERT INTO locations (parent_id, name, description) VALUES (@parent_id, @name, @description)").run(l);
  } else {
    db.prepare<Location>("UPDATE locations SET parent_id = @parent_id, name = @name, description = @description WHERE id = @id").run({ ...l, id });
  }
}

export interface MapLevel {
  id: number;
  location_id: number;
  name: string;
  position: number; // higher = further up
  background: MapBackground;
  mapImage: MapImage;
  grid: MapGrid;
  templateColors: TemplateColors;
  illumination: number; // global light level, 0 (dark) .. 1 (full)
  figure_height: number; // portrait maps: how many grid cells tall a 1.8 m figure stands
  hide_walls: 0 | 1; // the GM has hidden wall lines from their own view (players never see them)
  hidden: MapLayer[];
}

/** A location's levels, top level first; a location always has at least one. */
export function listLevels(locationId: number): MapLevel[] {
  const select = () =>
    db.prepare<
      [number],
      { id: number; location_id: number; name: string; position: number; background: string | null; map_image: string | null; grid: string | null; template_colors: string | null; illumination: number; figure_height: number; hide_walls: 0 | 1 }
    >("SELECT id, location_id, name, position, background, map_image, grid, template_colors, illumination, figure_height, hide_walls FROM map_levels WHERE location_id = ? ORDER BY position DESC"
    ).all(locationId);
  let rows = select();
  if (rows.length === 0) {
    addLevel(locationId, "Ground");
    rows = select();
  }
  return rows.map(({ map_image, grid, template_colors, ...r }) => ({
    ...r,
    templateColors: { ...DEFAULT_TEMPLATE_COLORS, ...(template_colors ? JSON.parse(template_colors) : {}) },
    grid: grid ? { ...DEFAULT_GRID, ...JSON.parse(grid) } : DEFAULT_GRID,
    background: r.background ? { ...DEFAULT_BACKGROUND, ...JSON.parse(r.background) } : DEFAULT_BACKGROUND,
    mapImage: map_image ? { ...DEFAULT_MAP_IMAGE, ...JSON.parse(map_image) } : DEFAULT_MAP_IMAGE,
    hidden: db
      .prepare<[number], { layer: MapLayer }>("SELECT layer FROM level_hidden_layers WHERE level_id = ?")
      .all(r.id)
      .map((h) => h.layer),
  }));
}

/** Adds a level directly above or below `relativeTo` (or at the top when there is none yet). */
export function addLevel(locationId: number, name: string, relativeTo?: { levelId: number; where: "above" | "below" }): number {
  const positions = db
    .prepare<[number], { id: number; position: number }>("SELECT id, position FROM map_levels WHERE location_id = ? ORDER BY position")
    .all(locationId);
  let position = (positions.at(-1)?.position ?? 0) + 1;
  const i = relativeTo ? positions.findIndex((p) => p.id === relativeTo.levelId) : -1;
  if (i >= 0) {
    const here = positions[i].position;
    const neighbour = relativeTo!.where === "above" ? positions[i + 1]?.position ?? here + 2 : positions[i - 1]?.position ?? here - 2;
    position = (here + neighbour) / 2;
  }
  return Number(
    db.prepare<[number, string, number]>("INSERT INTO map_levels (location_id, name, position) VALUES (?, ?, ?)").run(locationId, name, position)
      .lastInsertRowid
  );
}

export function removeLevel(levelId: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM map_tiles WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_structures WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_tokens WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM ambient_clips WHERE sound_id IN (SELECT id FROM ambient_sounds WHERE level_id = ?)").run(levelId);
    db.prepare<[number]>("DELETE FROM ambient_sounds WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM positional_sounds WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM light_sources WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_notes WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_effects WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM party_start WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_secrets WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_controls WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM encounters WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("UPDATE map_structures SET target_level_id = NULL WHERE target_level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM level_hidden_layers WHERE level_id = ?").run(levelId);
    db.prepare<[number]>("DELETE FROM map_levels WHERE id = ?").run(levelId);
  })();
}

export function setLayerVisible(levelId: number, layer: MapLayer, visible: boolean): void {
  if (visible) {
    db.prepare<[number, string]>("DELETE FROM level_hidden_layers WHERE level_id = ? AND layer = ?").run(levelId, layer);
  } else {
    db.prepare<[number, string]>("INSERT OR IGNORE INTO level_hidden_layers (level_id, layer) VALUES (?, ?)").run(levelId, layer);
  }
}

export function saveBackground(levelId: number, background: MapBackground): void {
  db.prepare<[string, number]>("UPDATE map_levels SET background = ? WHERE id = ?").run(JSON.stringify(background), levelId);
}

export function saveMapImage(levelId: number, mapImage: MapImage): void {
  db.prepare<[string, number]>("UPDATE map_levels SET map_image = ? WHERE id = ?").run(JSON.stringify(mapImage), levelId);
}

export function saveGrid(levelId: number, grid: MapGrid): void {
  db.prepare<[string, number]>("UPDATE map_levels SET grid = ? WHERE id = ?").run(JSON.stringify(grid), levelId);
}

export function saveTemplateColors(levelId: number, colors: TemplateColors): void {
  db.prepare<[string, number]>("UPDATE map_levels SET template_colors = ? WHERE id = ?").run(JSON.stringify(colors), levelId);
}

export const ASSET_USAGES = ["item", "creature", "token", "background", "map", "tile", "ambient"] as const;
export type AssetType = "image" | "audio";
export type AssetUsage = (typeof ASSET_USAGES)[number];

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  usage: AssetUsage;
  url: string;
}

/** An asset's URL (an area's sound…), if it's still there. */
export const getAssetUrl = (id: number): string | undefined => db.prepare<[number], { url: string }>("SELECT url FROM assets WHERE id = ?").get(id)?.url;

export function listAssets(filter: { type: AssetType; usage: AssetUsage }): Asset[] {
  return db
    .prepare<[string, string], Asset>("SELECT id, name, type, usage, url FROM assets WHERE type = ? AND usage = ? ORDER BY name")
    .all(filter.type, filter.usage);
}

export function addAsset(a: Omit<Asset, "id">): void {
  db.prepare<Omit<Asset, "id">>("INSERT INTO assets (name, type, usage, url) VALUES (@name, @type, @usage, @url)").run(a);
}

export function getAssetIdByUrl(url: string): number | undefined {
  return db.prepare<[string], { id: number }>("SELECT id FROM assets WHERE url = ?").get(url)?.id;
}

/** A placed tile, in grid cells (col/row of the top-left cell, plus size in cells). */
export interface MapTile {
  id: number;
  asset_id: number;
  name: string; // asset name
  url: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export function listTiles(levelId: number): MapTile[] {
  return db
    .prepare<[number], MapTile>(
      `SELECT t.id, t.asset_id, a.name, a.url, t.col, t.row, t.cols, t.rows FROM map_tiles t
       JOIN assets a ON a.id = t.asset_id WHERE t.level_id = ? ORDER BY t.id`
    )
    .all(levelId);
}

export function addTile(levelId: number, t: Omit<MapTile, "id" | "url" | "name">): void {
  db.prepare<Omit<MapTile, "id" | "url" | "name"> & { level_id: number }>(
    "INSERT INTO map_tiles (level_id, asset_id, col, row, cols, rows) VALUES (@level_id, @asset_id, @col, @row, @cols, @rows)"
  ).run({ ...t, level_id: levelId });
}

export function getTileLevel(id: number): number | undefined {
  return db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tiles WHERE id = ?").get(id)?.level_id;
}

export function moveTile(id: number, col: number, row: number): void {
  db.prepare<[number, number, number]>("UPDATE map_tiles SET col = ?, row = ? WHERE id = ?").run(col, row, id);
}

export function deleteTile(id: number): void {
  db.prepare<[number]>("DELETE FROM map_tiles WHERE id = ?").run(id);
}

export interface MapStructure {
  id: number;
  kind: StructureKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  target_level_id: number | null;
  target_name: string | null;
  open: 0 | 1; // doors only
  name: string | null; // doors only, for scripts
  locked: 0 | 1; // doors only: a locked door stays shut until the GM or a successful pick lock unlocks it
  lock_dc: number; // doors only: the roll a pick lock needs
}

export function listStructures(levelId: number): MapStructure[] {
  return db
    .prepare<[number], MapStructure>(
      `SELECT s.id, s.kind, s.x1, s.y1, s.x2, s.y2, s.target_level_id, l.name AS target_name, s.open, s.name, s.locked, s.lock_dc
       FROM map_structures s LEFT JOIN map_levels l ON l.id = s.target_level_id WHERE s.level_id = ? ORDER BY s.id`
    )
    .all(levelId);
}

export function addStructure(levelId: number, s: Omit<MapStructure, "id" | "target_name" | "open" | "name" | "locked" | "lock_dc">): void {
  db.prepare<Omit<MapStructure, "id" | "target_name" | "open" | "name" | "locked" | "lock_dc"> & { level_id: number }>(
    `INSERT INTO map_structures (level_id, kind, x1, y1, x2, y2, target_level_id)
     VALUES (@level_id, @kind, @x1, @y1, @x2, @y2, @target_level_id)`
  ).run({ ...s, level_id: levelId });
  nameUnnamed();
}

export function deleteStructure(id: number): void {
  db.prepare<[number]>("DELETE FROM map_structures WHERE id = ?").run(id);
}

/** Moves a line's two ends (a wall made longer or shorter); level links don't move. */
export function setStructureEnds(id: number, e: { x1: number; y1: number; x2: number; y2: number }): void {
  db.prepare("UPDATE map_structures SET x1 = @x1, y1 = @y1, x2 = @x2, y2 = @y2 WHERE id = @id AND kind != 'staircase'").run({ ...e, id });
}

/**
 * Breaks a line in two at a point on it: the line now ends there, and a second piece of the same kind (a door: open
 * and locked the same) runs on to the old end. Returns the new piece's id; a level link or a point at an end: none.
 */
export function splitStructure(id: number, at: { x: number; y: number }): number | null {
  const s = db.prepare<[number], { level_id: number; kind: string; x1: number; y1: number; x2: number; y2: number; open: number; locked: number; lock_dc: number }>(
    "SELECT level_id, kind, x1, y1, x2, y2, open, locked, lock_dc FROM map_structures WHERE id = ?"
  ).get(id);
  if (!s || s.kind === "staircase" || (at.x === s.x1 && at.y === s.y1) || (at.x === s.x2 && at.y === s.y2)) return null;
  return db.transaction(() => {
    db.prepare("UPDATE map_structures SET x2 = ?, y2 = ? WHERE id = ?").run(at.x, at.y, id);
    const made = Number(db.prepare("INSERT INTO map_structures (level_id, kind, x1, y1, x2, y2, open, locked, lock_dc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(s.level_id, s.kind, at.x, at.y, s.x2, s.y2, s.open, s.locked, s.lock_dc).lastInsertRowid);
    nameUnnamed();
    return made;
  })();
}

/** Removes every structure on a level (walls, doors, windows, stairs, level links); returns how many. */
export function deleteLevelStructures(levelId: number): number {
  return db.prepare<[number]>("DELETE FROM map_structures WHERE level_id = ?").run(levelId).changes;
}

/** A token on a level: who it is (creature or character), how it looks, and its cell. */
export interface MapToken {
  id: number;
  creature_id: number | null;
  character_id: number | null;
  name: string;
  image: string | null;
  col: number;
  row: number;
  hp: number | null; // creature tokens only; characters use their own
  token_overhead: string | null; // the creature's / character's token art
  token_side: string | null;
  height: number; // metres
  allegiance: string | null; // party / hostile / neutral as the GM set it (null: by kind; see lib/sides.ts)
  player_name?: string | null; // a character's player (shown on hover)
}

export function listTokens(levelId: number): MapToken[] {
  return db
    .prepare<[number], MapToken>(
      `SELECT t.id, t.creature_id, t.character_id, COALESCE(ch.name, cr.name) AS name, COALESCE(ch.image, cr.image) AS image, t.col, t.row, t.hp,
         CASE WHEN t.character_id IS NULL THEN cr.token_overhead ELSE ch.token_overhead END AS token_overhead,
         CASE WHEN t.character_id IS NULL THEN cr.token_side ELSE ch.token_side END AS token_side,
         CASE WHEN t.character_id IS NULL THEN cr.height ELSE ch.height END AS height, t.allegiance,
         (SELECT u.name FROM users u WHERE u.id = ch.player_id) AS player_name
       FROM map_tokens t
       LEFT JOIN creatures cr ON cr.id = t.creature_id
       LEFT JOIN characters ch ON ch.id = t.character_id
       WHERE t.level_id = ? ORDER BY t.id`
    )
    .all(levelId);
}

/** Places a creature token; its health is rolled the first time it's needed (or saved with saveTokenHealth). */
export function addCreatureToken(levelId: number, creatureId: number, col: number, row: number): number {
  return Number(
    db.prepare<[number, number, number, number]>("INSERT INTO map_tokens (level_id, creature_id, col, row) VALUES (?, ?, ?, ?)").run(levelId, creatureId, col, row).lastInsertRowid
  );
}

/** Whether a map level is drawn side-on (portrait), where gravity applies. */
export function isPortraitLevel(levelId: number): boolean {
  const row = db.prepare<[number], { map_image: string | null }>("SELECT map_image FROM map_levels WHERE id = ?").get(levelId);
  return !!row?.map_image && JSON.parse(row.map_image).perspective === "portrait";
}

/** A gridless level: positions anywhere, distances in straight lines (MapGrid.gridless). */
export function isGridlessLevel(levelId: number): boolean {
  const row = db.prepare<[number], { grid: string | null }>("SELECT grid FROM map_levels WHERE id = ?").get(levelId);
  return !!row?.grid && !!JSON.parse(row.grid).gridless;
}

export function getTokenLevel(id: number): number | undefined {
  return db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(id)?.level_id;
}

/**
 * Places a character on a level. A character can have tokens in several locations at once, but one per level:
 * placing it again on the same level moves that token.
 */
export function placeCharacterToken(levelId: number, characterId: number, col: number, row: number): number {
  return db.transaction(() => {
    db.prepare<[number, number]>("DELETE FROM map_tokens WHERE character_id = ? AND level_id = ?").run(characterId, levelId);
    const id = Number(
      db.prepare<[number, number, number, number]>("INSERT INTO map_tokens (level_id, character_id, col, row) VALUES (?, ?, ?, ?)").run(
        levelId, characterId, col, row
      ).lastInsertRowid
    );
    recordSighting(id);
    return id;
  })();
}

/** The location a map level belongs to, with the level's name. */
export function getLevelPlace(levelId: number): { location_id: number; location: string; level: string } | undefined {
  return db
    .prepare<[number], { location_id: number; location: string; level: string }>(
      "SELECT l.id AS location_id, l.name AS location, m.name AS level FROM map_levels m JOIN locations l ON l.id = m.location_id WHERE m.id = ?"
    )
    .get(levelId);
}

export interface PartyStart {
  level_id: number;
  location_id: number;
  location: string;
  level: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The party's starting area, if the GM has marked one (and its level still exists). */
export function getPartyStart(): PartyStart | undefined {
  return db
    .prepare<[], PartyStart>(
      `SELECT p.level_id, l.id AS location_id, l.name AS location, m.name AS level, p.x, p.y, p.w, p.h
       FROM party_start p JOIN map_levels m ON m.id = p.level_id JOIN locations l ON l.id = m.location_id`
    )
    .get();
}

export function savePartyStart(levelId: number, a: { x: number; y: number; w: number; h: number }): void {
  db.prepare("INSERT OR REPLACE INTO party_start (id, level_id, x, y, w, h) VALUES (1, ?, ?, ?, ?, ?)").run(levelId, a.x, a.y, a.w, a.h);
}

export function clearPartyStart(): void {
  db.prepare("DELETE FROM party_start").run();
}

export function deleteToken(id: number): void {
  db.prepare<[number]>("DELETE FROM map_tokens WHERE id = ?").run(id);
}

/** The token a token has selected as its target (its last one planned, or one its player clicked), if any. */
export function getTokenTarget(id: number): number | null {
  return db.prepare<[number], { target: number | null }>("SELECT target FROM map_tokens WHERE id = ?").get(id)?.target ?? null;
}

export function setTokenTarget(id: number, target: number | null): void {
  db.prepare<[number | null, number]>("UPDATE map_tokens SET target = ? WHERE id = ?").run(target, id);
}

/** Everyone's selected target on a level let go (after each round: targets don't carry over). */
export function clearTokenTargets(levelId: number): void {
  db.prepare<[number]>("UPDATE map_tokens SET target = NULL WHERE level_id = ?").run(levelId);
}

export function moveToken(id: number, col: number, row: number): void {
  db.prepare<[number, number, number]>("UPDATE map_tokens SET col = ?, row = ? WHERE id = ?").run(col, row, id);
  recordSighting(id);
}

// Standing orders out of encounters: a player's character follows, pursues or evades another token, moving whenever
// that one moves. Cleared when an encounter starts on the level, they move on their own, or they stop it.
export type StandingMode = "follow" | "pursue" | "evade";
db.exec(`CREATE TABLE IF NOT EXISTS token_follows (
  token_id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL,
  mode TEXT NOT NULL
)`);

export function setStandingOrder(tokenId: number, targetId: number, mode: StandingMode): void {
  db.prepare("INSERT OR REPLACE INTO token_follows (token_id, target_id, mode) VALUES (?, ?, ?)").run(tokenId, targetId, mode);
}

export function clearStandingOrder(tokenId: number): void {
  db.prepare("DELETE FROM token_follows WHERE token_id = ?").run(tokenId);
}

/** Clears every standing order on a level (an encounter starts there). */
export function clearStandingOrdersOn(levelId: number): void {
  db.prepare("DELETE FROM token_follows WHERE token_id IN (SELECT id FROM map_tokens WHERE level_id = ?)").run(levelId);
}

/** A token's standing order, if the one it's about is still on the same level. */
export function getStandingOrder(tokenId: number): { targetId: number; mode: StandingMode } | undefined {
  const r = db
    .prepare<[number], { target_id: number; mode: StandingMode }>(
      "SELECT f.target_id, f.mode FROM token_follows f JOIN map_tokens a ON a.id = f.token_id JOIN map_tokens b ON b.id = f.target_id AND b.level_id = a.level_id WHERE f.token_id = ?"
    )
    .get(tokenId);
  return r && { targetId: r.target_id, mode: r.mode };
}

/** Who has a standing order about this token (on its level). */
export function listStandingOrdersOn(targetId: number): { tokenId: number; mode: StandingMode }[] {
  return db
    .prepare<[number], { token_id: number; mode: StandingMode }>(
      "SELECT f.token_id, f.mode FROM token_follows f JOIN map_tokens a ON a.id = f.token_id JOIN map_tokens b ON b.id = f.target_id AND b.level_id = a.level_id WHERE f.target_id = ?"
    )
    .all(targetId)
    .map((r) => ({ tokenId: r.token_id, mode: r.mode }));
}

// Walks out of encounters (free moves, followers), so every map on the level plays them, not just the walker's.
// Kept a few seconds: a map polls each second and only plays what's fresh.
db.exec(`CREATE TABLE IF NOT EXISTS token_walks (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  route TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL
)`);

addColumn("token_walks", "fps", "REAL NOT NULL DEFAULT 5"); // how fast it went (feet per second): played back in real time
addColumn("token_walks", "times", "TEXT"); // or seconds from the start at each point (walking alongside someone: their pace varies)

/** Records a walk (route: token corners, start first) at `fps` feet per second, by `userId` (0: nobody's own screen played it). */
export function addTokenWalk(levelId: number, tokenId: number, route: { x: number; y: number }[], userId: number, fps = 5, times?: number[]): void {
  db.prepare("DELETE FROM token_walks WHERE at < ?").run(Date.now() - 60_000);
  db.prepare("INSERT INTO token_walks (level_id, token_id, route, user_id, at, fps, times) VALUES (?, ?, ?, ?, ?, ?, ?)").run(levelId, tokenId, JSON.stringify(route), userId, Date.now(), fps, times ? JSON.stringify(times) : null);
}

export function listTokenWalks(levelId: number, afterId: number): { id: number; token_id: number; route: { x: number; y: number }[]; user_id: number; fps: number; times: number[] | null }[] {
  return db
    .prepare<[number, number, number], { id: number; token_id: number; route: string; user_id: number; fps: number; times: string | null }>("SELECT id, token_id, route, user_id, fps, times FROM token_walks WHERE level_id = ? AND id > ? AND at > ? ORDER BY id")
    .all(levelId, afterId, Date.now() - 5_000)
    .map((r) => ({ ...r, route: JSON.parse(r.route), times: r.times ? JSON.parse(r.times) : null }));
}

// A level link a token came onto in a round: its player is asked (before planning again) whether to take it;
// `back` is where they stepped from (where "Stay" puts them).
db.exec(`CREATE TABLE IF NOT EXISTS link_prompts (
  token_id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL,
  back_col REAL NOT NULL,
  back_row REAL NOT NULL
)`);

addColumn("link_prompts", "show_at", "INTEGER NOT NULL DEFAULT 0"); // ms since epoch: in a round, when the replay shows them reaching it

export function setLinkPrompt(tokenId: number, linkId: number, back: { col: number; row: number }, showAt = 0): void {
  db.prepare("INSERT OR REPLACE INTO link_prompts (token_id, link_id, back_col, back_row, show_at) VALUES (?, ?, ?, ?, ?)").run(tokenId, linkId, back.col, back.row, showAt);
}

/** The level link prompt waiting for a token, with the name of the level it leads to. */
export function getLinkPrompt(tokenId: number): { id: number; to: string; back: { x: number; y: number }; showAt: number } | undefined {
  const r = db
    .prepare<[number], { link_id: number; back_col: number; back_row: number; show_at: number; to: string | null }>(
      "SELECT p.link_id, p.back_col, p.back_row, p.show_at, l.name AS \"to\" FROM link_prompts p JOIN map_structures s ON s.id = p.link_id LEFT JOIN map_levels l ON l.id = s.target_level_id WHERE p.token_id = ?"
    )
    .get(tokenId);
  return r && { id: r.link_id, to: r.to ?? "another level", back: { x: r.back_col, y: r.back_row }, showAt: r.show_at };
}

export function clearLinkPrompt(tokenId: number): void {
  db.prepare("DELETE FROM link_prompts WHERE token_id = ?").run(tokenId);
}

/**
 * Moves a token to another level (taking a level link). It leaves the encounter on the level it was on (turn order,
 * round plan, waiting list); on the new level it arrives outside any encounter there (the GM adds it).
 */
export function moveTokenToLevel(id: number, levelId: number, col: number, row: number): void {
  db.transaction(() => {
    const from = db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(id)?.level_id;
    db.prepare<[number, number, number, number]>("UPDATE map_tokens SET level_id = ?, col = ?, row = ? WHERE id = ?").run(levelId, col, row, id);
    recordSighting(id);
    if (from === undefined) return;
    db.prepare("DELETE FROM round_plans WHERE level_id = ? AND token_id = ?").run(from, id);
    const enc = getEncounter(from);
    if (!enc) return;
    const at = enc.order.findIndex((o) => o.token_id === id);
    if (at >= 0) {
      const order = enc.order.filter((o) => o.token_id !== id);
      saveEncounter(from, { ...enc, order, turn: Math.max(0, Math.min(enc.turn - (at < enc.turn ? 1 : 0), order.length - 1)) });
    }
    setEncounterWaiting(from, getEncounterWaiting(from).filter((t) => t !== id));
  })();
}

// Fog of war: every spot a character's token has stood on a level (its centre, grid units); what was seen from them stays explored.
db.exec(`CREATE TABLE IF NOT EXISTS sightings (
  character_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  PRIMARY KEY (character_id, level_id, x, y)
)`);

function recordSighting(tokenId: number): void {
  db.prepare<[number]>(
    "INSERT OR IGNORE INTO sightings SELECT character_id, level_id, col + 0.5, row + 0.5 FROM map_tokens WHERE id = ? AND character_id IS NOT NULL"
  ).run(tokenId);
}

/** A spot a character's token passed through (each second of a round's movement): it saw from there too. */
export function recordSightingAt(tokenId: number, col: number, row: number): void {
  db.prepare<[number, number, number]>(
    "INSERT OR IGNORE INTO sightings SELECT character_id, level_id, ? + 0.5, ? + 0.5 FROM map_tokens WHERE id = ? AND character_id IS NOT NULL"
  ).run(col, row, tokenId);
}

/** Where one character has stood on this level (its fog of war viewpoints, for the GM planning as it). */
export function listCharacterSightings(characterId: number, levelId: number): { x: number; y: number }[] {
  return db.prepare<[number, number], { x: number; y: number }>("SELECT x, y FROM sightings WHERE character_id = ? AND level_id = ?").all(characterId, levelId);
}

/** Where a player's characters have stood on this level (fog of war viewpoints). */
export function listSightings(playerId: number, levelId: number): { x: number; y: number }[] {
  return db
    .prepare<[number, number], { x: number; y: number }>(
      "SELECT DISTINCT s.x, s.y FROM sightings s JOIN characters c ON c.id = s.character_id WHERE c.player_id = ? AND s.level_id = ?"
    )
    .all(playerId, levelId);
}

export interface AmbientClip {
  id: number;
  asset_id: number;
  name: string;
  url: string;
  mode: ClipMode;
}

export interface AmbientSound {
  id: number;
  name: string;
  volume: number; // 0..1
  clips: AmbientClip[]; // playlist order
}

export function listAmbientSounds(levelId: number): AmbientSound[] {
  const sounds = db
    .prepare<[number], { id: number; name: string; volume: number }>("SELECT id, name, volume FROM ambient_sounds WHERE level_id = ? ORDER BY id")
    .all(levelId);
  const clips = db.prepare<[number], AmbientClip>(
    `SELECT c.id, c.asset_id, a.name, a.url, c.mode FROM ambient_clips c JOIN assets a ON a.id = c.asset_id
     WHERE c.sound_id = ? ORDER BY c.id`
  );
  return sounds.map((s) => ({ ...s, clips: clips.all(s.id) }));
}

// What the GM is playing on a level (ambient), shared with every player's browser on it. rev changes with each new
// play (or stop), so browsers start it again; volume can change without a new rev.
db.exec(`CREATE TABLE IF NOT EXISTS level_ambient (
  level_id INTEGER PRIMARY KEY,
  sound_id INTEGER,          -- null: nothing playing
  clip_id INTEGER,           -- a single clip played once (else the sound's loop and layer clips)
  volume REAL NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 0
)`);

export type SharedAmbient = { rev: number; volume: number; loop: { id: number; url: string }[]; layer: { id: number; url: string }[]; once: { id: number; url: string } | null } | null;

/** The GM played (or stopped: null) an ambient sound on a level; volume alone: same play, louder or softer. */
export function setLevelAmbient(levelId: number, play: { soundId: number; clipId?: number | null; volume: number } | null, volumeOnly = false): void {
  const was = db.prepare<[number], { rev: number }>("SELECT rev FROM level_ambient WHERE level_id = ?").get(levelId);
  if (volumeOnly && play) { db.prepare("UPDATE level_ambient SET volume = ? WHERE level_id = ?").run(play.volume, levelId); return; }
  db.prepare("INSERT OR REPLACE INTO level_ambient (level_id, sound_id, clip_id, volume, rev) VALUES (?, ?, ?, ?, ?)")
    .run(levelId, play?.soundId ?? null, play?.clipId ?? null, play?.volume ?? 1, (was?.rev ?? 0) + 1);
}

/** What's playing on a level, as players' browsers play it (clips with their files). */
export function getLevelAmbient(levelId: number): SharedAmbient {
  const row = db.prepare<[number], { sound_id: number | null; clip_id: number | null; volume: number; rev: number }>("SELECT sound_id, clip_id, volume, rev FROM level_ambient WHERE level_id = ?").get(levelId);
  if (!row) return null;
  const sound = row.sound_id === null ? undefined : listAmbientSounds(levelId).find((s) => s.id === row.sound_id);
  if (!sound) return { rev: row.rev, volume: row.volume, loop: [], layer: [], once: null };
  const clip = (c: AmbientClip) => ({ id: c.id, url: c.url });
  const once = row.clip_id === null ? null : sound.clips.find((c) => c.id === row.clip_id);
  return { rev: row.rev, volume: row.volume, once: once ? clip(once) : null, loop: once ? [] : sound.clips.filter((c) => c.mode === "loop").map(clip), layer: once ? [] : sound.clips.filter((c) => c.mode === "layer").map(clip) };
}

export function addAmbientSound(levelId: number, name: string): void {
  db.prepare<[number, string]>("INSERT INTO ambient_sounds (level_id, name) VALUES (?, ?)").run(levelId, name);
}

export function deleteAmbientSound(id: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM ambient_clips WHERE sound_id = ?").run(id);
    db.prepare<[number]>("DELETE FROM ambient_sounds WHERE id = ?").run(id);
  })();
}

export function addAmbientClip(soundId: number, assetId: number, mode: ClipMode): void {
  db.prepare<[number, number, string]>("INSERT INTO ambient_clips (sound_id, asset_id, mode) VALUES (?, ?, ?)").run(soundId, assetId, mode);
}

export function setClipMode(id: number, mode: ClipMode): void {
  db.prepare<[string, number]>("UPDATE ambient_clips SET mode = ? WHERE id = ?").run(mode, id);
}

export function deleteAmbientClip(id: number): void {
  db.prepare<[number]>("DELETE FROM ambient_clips WHERE id = ?").run(id);
}

/** A sound placed on the map: position in grid units (cell centre = col + 0.5) and effective range in cells. */
export interface PositionalSound {
  id: number;
  asset_id: number;
  name: string;
  url: string;
  x: number;
  y: number;
  radius: number;
  volume: number; // 0..1
  loop: 0 | 1;
}

export function listPositionalSounds(levelId: number): PositionalSound[] {
  return db
    .prepare<[number], PositionalSound>(
      `SELECT p.id, p.asset_id, a.name, a.url, p.x, p.y, p.radius, p.volume, p.loop FROM positional_sounds p
       JOIN assets a ON a.id = p.asset_id WHERE p.level_id = ? ORDER BY p.id`
    )
    .all(levelId);
}

export function addPositionalSound(levelId: number, s: Omit<PositionalSound, "id" | "name" | "url" | "volume" | "loop">): void {
  db.prepare<Omit<PositionalSound, "id" | "name" | "url" | "volume" | "loop"> & { level_id: number }>(
    "INSERT INTO positional_sounds (level_id, asset_id, x, y, radius) VALUES (@level_id, @asset_id, @x, @y, @radius)"
  ).run({ ...s, level_id: levelId });
}

export function setPositionalLoop(id: number, loop: boolean): void {
  db.prepare<[number, number]>("UPDATE positional_sounds SET loop = ? WHERE id = ?").run(loop ? 1 : 0, id);
}

export function movePositionalSound(id: number, x: number, y: number): void {
  db.prepare<[number, number, number]>("UPDATE positional_sounds SET x = ?, y = ? WHERE id = ?").run(x, y, id);
}

export function setPositionalRadius(id: number, radius: number): void {
  db.prepare<[number, number]>("UPDATE positional_sounds SET radius = ? WHERE id = ?").run(radius, id);
}

export function deletePositionalSound(id: number): void {
  db.prepare<[number]>("DELETE FROM positional_sounds WHERE id = ?").run(id);
}

export function setSoundVolume(table: "ambient_sounds" | "positional_sounds", id: number, volume: number): void {
  db.prepare<[number, number]>(`UPDATE ${table} SET volume = ? WHERE id = ?`).run(Math.min(1, Math.max(0, volume)), id);
}

export function saveFigureHeight(levelId: number, cells: number): void {
  db.prepare<[number, number]>("UPDATE map_levels SET figure_height = ? WHERE id = ?").run(Math.min(20, Math.max(0.1, cells)), levelId);
}

export function saveHideWalls(levelId: number, hide: boolean): void {
  db.prepare<[number, number]>("UPDATE map_levels SET hide_walls = ? WHERE id = ?").run(hide ? 1 : 0, levelId);
}

export function saveIllumination(levelId: number, illumination: number): void {
  db.prepare<[number, number]>("UPDATE map_levels SET illumination = ? WHERE id = ?").run(Math.min(1, Math.max(0, illumination)), levelId);
}

export interface LightSource {
  id: number;
  kind: LightKind;
  x: number; // grid units; cell centre = col + 0.5
  y: number;
  radius: number; // cells
  angle: number; // degrees, directional only
  spread: number; // degrees, directional only
  flicker: 0 | 1;
  name: string;
  enabled: 0 | 1; // switched on
}

export function listLights(levelId: number): LightSource[] {
  return db
    .prepare<[number], LightSource>("SELECT id, kind, x, y, radius, angle, spread, flicker, name, enabled FROM light_sources WHERE level_id = ? ORDER BY id")
    .all(levelId);
}

export function addLight(levelId: number, l: Omit<LightSource, "id" | "name" | "enabled">): void {
  db.prepare<Omit<LightSource, "id" | "name" | "enabled"> & { level_id: number }>(
    `INSERT INTO light_sources (level_id, kind, x, y, radius, angle, spread, flicker)
     VALUES (@level_id, @kind, @x, @y, @radius, @angle, @spread, @flicker)`
  ).run({ ...l, level_id: levelId });
  nameUnnamed();
}

/** What scripts can change on a light. */
export function updateLight(id: number, l: { radius: number; flicker: boolean; on: boolean }): void {
  db.prepare<[number, number, number, number]>("UPDATE light_sources SET radius = ?, flicker = ?, enabled = ? WHERE id = ?").run(
    Math.max(0.5, l.radius), l.flicker ? 1 : 0, l.on ? 1 : 0, id
  );
}

/** Renames a light, effect or door (the name scripts use). */
export function renameMapThing(table: "light_sources" | "map_effects" | "map_structures", id: number, name: string): void {
  db.prepare<[string, number]>(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name.trim(), id);
  nameUnnamed();
}

export function setMapThingOn(table: "light_sources" | "map_effects", id: number, on: boolean): void {
  db.prepare<[number, number]>(`UPDATE ${table} SET enabled = ? WHERE id = ?`).run(on ? 1 : 0, id);
}

export function getIllumination(levelId: number): number {
  return db.prepare<[number], { illumination: number }>("SELECT illumination FROM map_levels WHERE id = ?").get(levelId)?.illumination ?? 1;
}

export function deleteLight(id: number): void {
  db.prepare<[number]>("DELETE FROM light_sources WHERE id = ?").run(id);
}

/** Opens or closes a door. A locked door can't be opened (unlock it first). */
export function setDoorOpen(id: number, open: boolean): void {
  db.prepare<[number, number, number]>("UPDATE map_structures SET open = ? WHERE id = ? AND kind = 'door' AND (locked = 0 OR ? = 0)").run(open ? 1 : 0, id, open ? 1 : 0);
}

/** Locks (and shuts) or unlocks a door. */
export function setDoorLocked(id: number, locked: boolean): void {
  db.prepare<[number, number, number]>(
    "UPDATE map_structures SET locked = ?, open = CASE WHEN ? = 1 THEN 0 ELSE open END WHERE id = ? AND kind = 'door'"
  ).run(locked ? 1 : 0, locked ? 1 : 0, id);
}

export function setLockDc(id: number, dc: number): void {
  db.prepare<[number, number]>("UPDATE map_structures SET lock_dc = ? WHERE id = ? AND kind = 'door'").run(Math.max(1, Math.round(dc)), id);
}

/** A door as the structure list stores it, with its level (for pick lock). */
export function getDoor(id: number): (MapStructure & { level_id: number }) | undefined {
  return db
    .prepare<[number], MapStructure & { level_id: number }>(
      "SELECT id, kind, x1, y1, x2, y2, target_level_id, NULL AS target_name, open, name, locked, lock_dc, level_id FROM map_structures WHERE id = ? AND kind = 'door'"
    )
    .get(id);
}

/** A player's character token on the map they're seeing (see getPlayerTokenLevelId). */
export function getPlayerToken(playerId: number): { token_id: number; character_id: number; name: string; attributes: string; movement: string; moved: number; level_id: number; col: number; row: number } | undefined {
  return db
    .prepare<[number, number], { token_id: number; character_id: number; name: string; attributes: string; movement: string; moved: number; level_id: number; col: number; row: number }>(
      "SELECT t.id AS token_id, c.id AS character_id, c.name, c.attributes, c.movement, t.moved, t.level_id, t.col, t.row FROM map_tokens t JOIN characters c ON c.id = t.character_id WHERE c.player_id = ? AND t.level_id = ? ORDER BY t.id DESC LIMIT 1"
    )
    .get(playerId, getPlayerTokenLevelId(playerId) ?? -1); // the token on the map they're seeing
}

/** Anyone on the map as an actor (a character or a creature), in the shape a player's token comes in (character_id null: a creature). */
export type ActorToken = { token_id: number; character_id: number | null; name: string; attributes: string; movement: string; moved: number; level_id: number; col: number; row: number };
export function getTokenActor(tokenId: number): ActorToken | undefined {
  return db
    .prepare<[number], ActorToken>(
      `SELECT t.id AS token_id, t.character_id, COALESCE(c.name, cr.name, 'someone') AS name, COALESCE(c.attributes, cr.attributes, '{}') AS attributes,
              COALESCE(c.movement, cr.movement, '{}') AS movement, t.moved, t.level_id, t.col, t.row
       FROM map_tokens t LEFT JOIN characters c ON c.id = t.character_id LEFT JOIN creatures cr ON cr.id = t.creature_id WHERE t.id = ?`
    )
    .get(tokenId);
}

/** A GM-only sticky note on the map. */
export interface MapNote {
  id: number;
  x: number;
  y: number;
  w: number; // width in grid cells
  h: number; // minimum height in grid cells (taller if the text needs it)
  text: string;
}

export function listNotes(levelId: number): MapNote[] {
  return db.prepare<[number], MapNote>("SELECT id, x, y, w, h, text FROM map_notes WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addNote(levelId: number, n: Omit<MapNote, "id" | "w" | "h">): void {
  db.prepare<Omit<MapNote, "id" | "w" | "h"> & { level_id: number }>("INSERT INTO map_notes (level_id, x, y, text) VALUES (@level_id, @x, @y, @text)").run({
    ...n,
    level_id: levelId,
  });
}

export function updateNoteText(id: number, text: string): void {
  db.prepare<[string, number]>("UPDATE map_notes SET text = ? WHERE id = ?").run(text, id);
}

export function deleteNote(id: number): void {
  db.prepare<[number]>("DELETE FROM map_notes WHERE id = ?").run(id);
}

export function resizeNote(id: number, w: number, h: number): void {
  db.prepare<[number, number, number]>("UPDATE map_notes SET w = ?, h = ? WHERE id = ?").run(w, h, id);
}

/** A GM button floating along an edge of the scene. */
export interface MapControl {
  id: number;
  edge: ControlEdge;
  icon: string; // react-icons Game Icons component name, e.g. "GiDoorway"
  label: string; // shown as a tooltip
  script: string; // game script run on click (docs/scripting.md)
}

export function listControls(levelId: number): MapControl[] {
  return db.prepare<[number], MapControl>("SELECT id, edge, icon, label, script FROM map_controls WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addControl(levelId: number, edge: ControlEdge, icon: string, label: string): void {
  db.prepare<[number, string, string, string]>("INSERT INTO map_controls (level_id, edge, icon, label) VALUES (?, ?, ?, ?)").run(
    levelId, edge, icon, label
  );
}

export function getControlScript(id: number): { script: string; level_id: number } | undefined {
  return db.prepare<[number], { script: string; level_id: number }>("SELECT script, level_id FROM map_controls WHERE id = ?").get(id);
}

export function saveControlScript(id: number, script: string): void {
  db.prepare<[string, number]>("UPDATE map_controls SET script = ? WHERE id = ?").run(script, id);
}

export function deleteControl(id: number): void {
  db.prepare<[number]>("DELETE FROM map_controls WHERE id = ?").run(id);
}

// ---------- Game state changed by scripts ----------

export interface CharacterState {
  id: number;
  name: string;
  type: CreatureType;
  attributes: Attributes;
  health: string; // formula
  hp: number | null;
  conditions: string[];
  in_party: 0 | 1;
}

export function listCharacterStates(): CharacterState[] {
  return db
    .prepare<[], Omit<CharacterState, "attributes" | "conditions"> & { attributes: string; conditions: string }>(
      "SELECT id, name, type, attributes, health, hp, conditions, in_party FROM characters ORDER BY name"
    )
    .all()
    .map((r) => ({ ...r, attributes: JSON.parse(r.attributes), conditions: JSON.parse(r.conditions) }));
}

/** Saves what a script may change on a character (health is saved separately, with saveCharacterHealth). */
export function saveCharacterState(s: Pick<CharacterState, "id" | "attributes" | "conditions">): void {
  db.prepare<[string, string, number]>("UPDATE characters SET attributes = ?, conditions = ? WHERE id = ?").run(JSON.stringify(s.attributes), JSON.stringify(s.conditions), s.id);
}

export type VarValue = number | string | boolean | null;

export function getVars(): Record<string, VarValue> {
  const rows = db.prepare<[], { key: string; value: string }>("SELECT key, value FROM game_vars").all();
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

export function saveVars(vars: Record<string, VarValue>): void {
  db.exec("DELETE FROM game_vars");
  const insert = db.prepare<[string, string]>("INSERT INTO game_vars (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(vars)) if (v !== null) insert.run(k, JSON.stringify(v));
}

/** Runs fn in a single transaction. */
export const transaction = <T>(fn: () => T): T => db.transaction(fn)();

export interface EncounterRow {
  round: number;
  turn: number;
  order: { token_id: number; initiative: number }[];
}

export function getEncounter(levelId: number): EncounterRow | undefined {
  const row = db
    .prepare<[number], { round: number; turn: number; turn_order: string }>("SELECT round, turn, turn_order FROM encounters WHERE level_id = ?")
    .get(levelId);
  return row && { round: row.round, turn: row.turn, order: JSON.parse(row.turn_order) };
}

/** Saves the level's encounter, or ends it (null). */
export function saveEncounter(levelId: number, e: EncounterRow | null): void {
  if (!e) {
    db.prepare<[number]>("DELETE FROM encounters WHERE level_id = ?").run(levelId);
    return;
  }
  db.prepare<[number, number, number, string]>(
    "INSERT INTO encounters (level_id, round, turn, turn_order) VALUES (?, ?, ?, ?) ON CONFLICT(level_id) DO UPDATE SET round = excluded.round, turn = excluded.turn, turn_order = excluded.turn_order"
  ).run(levelId, e.round, e.turn, JSON.stringify(e.order));
}

// ---------- Effects ----------

/** An animated effect on a level. With no area it covers the whole map; otherwise the w × h cells from (x, y). */
export interface MapEffect {
  id: number;
  kind: EffectKind;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  intensity: number; // 0..1
  name: string;
  enabled: 0 | 1; // switched on
}

export function listEffects(levelId: number): MapEffect[] {
  return db.prepare<[number], MapEffect>("SELECT id, kind, x, y, w, h, intensity, name, enabled FROM map_effects WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addEffect(levelId: number, e: Omit<MapEffect, "id" | "name" | "enabled">): void {
  db.prepare<Omit<MapEffect, "id" | "name" | "enabled"> & { level_id: number }>(
    "INSERT INTO map_effects (level_id, kind, x, y, w, h, intensity) VALUES (@level_id, @kind, @x, @y, @w, @h, @intensity)"
  ).run({ ...e, level_id: levelId });
  nameUnnamed();
}

/** What scripts can change on an effect. */
export function updateEffect(id: number, e: { intensity: number; on: boolean }): void {
  db.prepare<[number, number, number]>("UPDATE map_effects SET intensity = ?, enabled = ? WHERE id = ?").run(Math.min(1, Math.max(0, e.intensity)), e.on ? 1 : 0, id);
}

export function moveEffect(id: number, x: number, y: number): void {
  db.prepare<[number, number, number]>("UPDATE map_effects SET x = ?, y = ? WHERE id = ? AND w IS NOT NULL").run(x, y, id);
}

export function setEffectIntensity(id: number, intensity: number): void {
  db.prepare<[number, number]>("UPDATE map_effects SET intensity = ? WHERE id = ?").run(Math.min(1, Math.max(0, intensity)), id);
}

export function deleteEffect(id: number): void {
  db.prepare<[number]>("DELETE FROM map_effects WHERE id = ?").run(id);
}

export function isInParty(characterId: number): boolean {
  return !!db.prepare<[number], { in_party: number }>("SELECT in_party FROM characters WHERE id = ?").get(characterId)?.in_party;
}

export function setInParty(characterId: number, inParty: boolean): void {
  db.prepare<[number, number]>("UPDATE characters SET in_party = ? WHERE id = ?").run(inParty ? 1 : 0, characterId);
}

/** The player who plays a character, if any. */
export function getCharacterPlayer(characterId: number): number | null {
  return db.prepare<[number], { player_id: number | null }>("SELECT player_id FROM characters WHERE id = ?").get(characterId)?.player_id ?? null;
}

export function setCharacterPlayer(characterId: number, playerId: number | null): void {
  db.prepare<[number | null, number]>("UPDATE characters SET player_id = ? WHERE id = ?").run(playerId, characterId);
}

/** The party's characters (ticked "In the party"), by name. */
export function listPartyMembers(): { id: number; name: string; player_id: number | null }[] {
  return db.prepare<[], { id: number; name: string; player_id: number | null }>("SELECT id, name, player_id FROM characters WHERE in_party = 1 ORDER BY name").all();
}

/** The characters a player plays. */
export function listPlayerCharacters(playerId: number): { id: number; name: string }[] {
  return db.prepare<[number], { id: number; name: string }>("SELECT id, name FROM characters WHERE player_id = ? ORDER BY name").all(playerId);
}

// ---------- Sessions (game nights) ----------

// Not "sessions": that table holds login tokens.
db.exec(`CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,   -- real date and time (ISO)
  game_time REAL NOT NULL     -- game time when it started, in minutes
)`);
addColumn("game_sessions", "ended_at", "TEXT"); // real time it ended; null while it's running
addColumn("game_sessions", "start_state", "TEXT"); // JSON snapshot of game state when it started (lib/sessionLog.ts)
addColumn("game_sessions", "summary", "TEXT"); // JSON summary written when it ended
addColumn("game_sessions", "began_at", "TEXT"); // when the GM began play; until then the session is in its lobby
db.exec("UPDATE game_sessions SET began_at = started_at WHERE began_at IS NULL AND ended_at IS NOT NULL"); // sessions from before lobbies
// Who's in a session's lobby (or game): a player is present while their page keeps checking in.
db.exec(`CREATE TABLE IF NOT EXISTS session_presence (
  session_id INTEGER NOT NULL REFERENCES game_sessions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_seen INTEGER NOT NULL, -- epoch ms
  PRIMARY KEY (session_id, user_id)
)`);
// Things that happened during a session that its start and end states can't show (e.g. triggers going off).
db.exec(`CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES game_sessions(id),
  game_time REAL NOT NULL,
  text TEXT NOT NULL
)`);

// Who the GM put in or took out of a session (its lobby): "gm" = an absent player the GM plays; "removed" = kept out.
// Anyone else is in the session by being present.
db.exec(`CREATE TABLE IF NOT EXISTS session_members (
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'gm' | 'removed'
  PRIMARY KEY (session_id, user_id)
)`);

// ---------- Triggers ----------

export interface Trigger {
  id: number;
  prelude: string[]; // WITH lines naming what the trigger refers to
  condition: string;
  action: string;
  /** Watched WITH names and their values at the last check (H.previous). */
  watches: Record<string, VarValue>;
  level_id: number | null; // the map level it was made on (game.locations.current)
  created: number; // game time
  last: boolean; // the condition held at the last check (it goes off when this turns true)
  fired: number | null; // game time it last went off
  error: string | null;
}
type TriggerRow = Omit<Trigger, "prelude" | "watches" | "last"> & { prelude: string; watches: string; last: number };
const toTrigger = (r: TriggerRow): Trigger => ({ ...r, prelude: JSON.parse(r.prelude), watches: JSON.parse(r.watches), last: !!r.last });

export function addTrigger(t: Pick<Trigger, "prelude" | "condition" | "action" | "level_id" | "created"> & { watches: Record<string, unknown> }): void {
  db.prepare<[string, string, string, string, number | null, number]>(
    "INSERT INTO triggers (prelude, condition, action, watches, level_id, created) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(JSON.stringify(t.prelude), t.condition, t.action, JSON.stringify(t.watches), t.level_id, t.created);
}

/** Triggers still watching (not failed), oldest first. */
export function listActiveTriggers(): Trigger[] {
  return db.prepare<[], TriggerRow>("SELECT * FROM triggers WHERE error IS NULL ORDER BY id").all().map(toTrigger);
}

export function listTriggers(): Trigger[] {
  return db.prepare<[], TriggerRow>("SELECT * FROM triggers ORDER BY id").all().map(toTrigger);
}

/** Records a check: whether the condition held, the watched values seen, and the time if it went off. */
export function setTriggerState(id: number, last: boolean, watches: Record<string, VarValue>, firedAt: number | null): void {
  db.prepare<[number, string, number | null, number]>("UPDATE triggers SET last = ?, watches = ?, fired = COALESCE(?, fired) WHERE id = ?")
    .run(last ? 1 : 0, JSON.stringify(watches), firedAt, id);
}

export function setTriggerError(id: number, error: string): void {
  db.prepare<[string, number]>("UPDATE triggers SET error = ? WHERE id = ?").run(error, id);
}

export function deleteTrigger(id: number): void {
  db.prepare<[number]>("DELETE FROM triggers WHERE id = ?").run(id);
}

// ---------- Party placement ----------

export interface UnplacedCharacter {
  id: number;
  name: string;
  image: string | null;
  player: string;
}

/**
 * Once the first session has begun: the party's start area, and the players' characters with no token on any map yet.
 * Undefined when there's nothing to place (no first session running, no start area, or everyone is placed).
 */
export function getPartyPlacement(): { start: PartyStart; unplaced: UnplacedCharacter[] } | undefined {
  const session = getOpenGameSession();
  if (!session || session.number !== 1 || !session.began_at) return undefined;
  const start = getPartyStart();
  if (!start) return undefined;
  const unplaced = db
    .prepare<[], UnplacedCharacter>(
      `SELECT c.id, c.name, c.image, u.name AS player FROM characters c JOIN users u ON u.id = c.player_id
       WHERE NOT EXISTS (SELECT 1 FROM map_tokens t WHERE t.character_id = c.id) ORDER BY u.name, c.name`
    )
    .all();
  return unplaced.length ? { start, unplaced } : undefined;
}

/** Where the party is now: the level holding the most player characters' tokens, else the party start level. */
export function getCurrentLevelId(): number | undefined {
  const row = db
    .prepare<[], { level_id: number }>(
      `SELECT t.level_id FROM map_tokens t JOIN characters c ON c.id = t.character_id
       WHERE c.player_id IS NOT NULL GROUP BY t.level_id ORDER BY COUNT(*) DESC, MAX(t.id) DESC LIMIT 1`
    )
    .get();
  return row?.level_id ?? getPartyStart()?.level_id;
}

/** The map level a player's character token is on, if the GM has placed it. */
/**
 * The map a player sees: the GM's active location if their character has a token there, otherwise the level of
 * their most recently placed token. (A character can have tokens in several locations at once.)
 */
export function getPlayerTokenLevelId(playerId: number): number | undefined {
  const levels = db
    .prepare<[number], { level_id: number }>(
      "SELECT t.level_id FROM map_tokens t JOIN characters c ON c.id = t.character_id WHERE c.player_id = ? GROUP BY t.level_id ORDER BY MAX(t.id) DESC"
    )
    .all(playerId)
    .map((r) => r.level_id);
  const active = getGmLevelId();
  return active !== undefined && levels.includes(active) ? active : levels[0];
}

// ---------- Lasting areas ----------

// An area an action left on the map for a while (a fire wall); it's gone once game time passes `ends`.
db.exec(`CREATE TABLE IF NOT EXISTS lasting_areas (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  ends REAL NOT NULL,
  spec TEXT NOT NULL
)`);

export function addLastingArea(levelId: number, a: Omit<LastingArea, "id">): number {
  const { name, ends, ...spec } = a;
  db.prepare("DELETE FROM lasting_areas WHERE ends <= ?").run(getGameTime());
  return Number(db.prepare("INSERT INTO lasting_areas (level_id, name, ends, spec) VALUES (?, ?, ?, ?)").run(levelId, name, ends, JSON.stringify(spec)).lastInsertRowid);
}

// Exposure to lingering areas' harm, per level: who is still burning, poisoned… (lib/exposure.ts), as JSON.
db.exec("CREATE TABLE IF NOT EXISTS level_exposure (level_id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
export function getExposures(levelId: number): Exposures {
  const r = db.prepare<[number], { data: string }>("SELECT data FROM level_exposure WHERE level_id = ?").get(levelId);
  return new Map(r ? (JSON.parse(r.data) as [number, Exposure[]][]) : []);
}
export function saveExposures(levelId: number, all: Exposures): void {
  const data = [...all].filter(([, l]) => l.length);
  db.prepare("INSERT INTO level_exposure (level_id, data) VALUES (?, ?) ON CONFLICT (level_id) DO UPDATE SET data = excluded.data").run(levelId, JSON.stringify(data));
}

/** How far anyone sees in fog (feet): fog map effects are Obscured (the areas design, Q7). */
export const FOG_SIGHT_FT = 15;

/** Whether a spot (grid units, a token's centre) is in fog: a placed fog effect's oval, or fog over the whole map; switched on. */
export function inFog(levelId: number, p: { x: number; y: number }): boolean {
  return listEffects(levelId).some((e) => {
    if (!e.enabled || e.kind !== "fog") return false;
    if (e.x === null || e.y === null || e.w === null || e.h === null) return true; // the whole map
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    return ((p.x - cx) / (e.w / 2)) ** 2 + ((p.y - cy) / (e.h / 2)) ** 2 <= 1;
  });
}

/**
 * Every area that does something on a level: its lasting areas, and placed fire map effects (switched on), which burn
 * whoever is in them like a lingering fire area (1d6 fire each interval, no save, +1 while inside, −2 after; the
 * areas design, Q7). A fire effect's area is the circle inside its rectangle; its id is the effect's, negated.
 */
export function listHazards(levelId: number): LastingArea[] {
  const fires = listEffects(levelId).filter((e) => e.enabled && e.kind === "fire" && e.x !== null && e.y !== null && e.w !== null && e.h !== null).map((e): LastingArea => ({
    id: -e.id, name: e.name || "Fire", look: "fire", damage: "1d6", damageType: "fire", dc: NO_SAVE_DC, save: "agility", half: false, ends: 1e9,
    area: { shape: "circle", origin: { x: e.x! + e.w! / 2, y: e.y! + e.h! / 2 }, dir: 0, size: Math.min(e.w!, e.h!) / 2 },
    fires: ["inside"], lingers: true, buildUp: 1, decay: 2, drawn: true,
  }));
  return [...listLastingAreas(levelId).filter((l) => !l.off), ...fires];
}

/** One lasting area (or none, gone or run out). */
export function getLastingArea(id: number): (LastingArea & { level_id: number }) | undefined {
  const r = db.prepare<[number], { id: number; level_id: number; name: string; ends: number; spec: string }>("SELECT id, level_id, name, ends, spec FROM lasting_areas WHERE id = ?").get(id);
  return r ? { id: r.id, level_id: r.level_id, name: r.name, ends: r.ends, ...JSON.parse(r.spec) } : undefined;
}

/** Fire reaches these flammable areas: each burns for a few rounds (`ignite`), then it's spent. */
export function igniteAreas(ids: number[]): void {
  for (const id of ids) {
    const a = getLastingArea(id);
    if (!a?.flammable) continue;
    const { id: _id, level_id: _l, ...rest } = a;
    updateLastingArea(id, ignite({ id, ...rest }, getGameTime()));
  }
}

/** Out of a round: any fire on the level (a fire area, a fire map effect) touching a flammable area sets it burning (and so on, as it spreads). */
export function spreadFire(levelId: number): void {
  for (let pass = 0; pass < 10; pass++) {
    const all = listHazards(levelId), lit = all.filter((l) => isFire(l) && !l.flammable).flatMap((f) => caughtFire(all, f.area)).filter((id) => id > 0);
    if (!lit.length) return;
    igniteAreas([...new Set(lit)]);
  }
}

/** A lasting area switched on or off (a trigger, the GM). */
export function setLastingAreaOff(id: number, off: boolean): void {
  const a = getLastingArea(id);
  if (!a) return;
  const { id: _id, level_id: _l, ...rest } = a;
  updateLastingArea(id, { ...rest, off: off || undefined });
}

/** A hidden lasting area is found (players see it from now on). */
export function setLastingAreaFound(id: number): void {
  const a = getLastingArea(id);
  if (!a || a.found || (a.visibility ?? "shown") !== "hidden") return;
  const { id: _id, level_id: _l, ...rest } = a;
  updateLastingArea(id, { ...rest, found: true });
}

/** The GM changes a lasting area (everything but where it is). */
export function updateLastingArea(id: number, a: Omit<LastingArea, "id">): void {
  const { name, ends, ...spec } = a;
  db.prepare<[string, number, string, number]>("UPDATE lasting_areas SET name = ?, ends = ?, spec = ? WHERE id = ?").run(name, ends, JSON.stringify(spec), id);
}

/** A level's lasting areas still in effect. */
export function listLastingAreas(levelId: number): LastingArea[] {
  return db
    .prepare<[number, number], { id: number; name: string; ends: number; spec: string }>("SELECT id, name, ends, spec FROM lasting_areas WHERE level_id = ? AND ends > ? ORDER BY id")
    .all(levelId, getGameTime())
    .map((r) => ({ id: r.id, name: r.name, ends: r.ends, ...JSON.parse(r.spec) }));
}

export function removeLastingArea(id: number): void {
  db.prepare("DELETE FROM lasting_areas WHERE id = ?").run(id);
}

// ---------- Statuses ----------

// What an action left on a token for a while (disadvantage on its attacks, +2 defense); gone once game time passes `ends`.
db.exec(`CREATE TABLE IF NOT EXISTS token_statuses (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  ends REAL NOT NULL,
  status TEXT NOT NULL
)`);

export function addTokenStatus(levelId: number, tokenId: number, status: Status, ends: number): void {
  db.prepare("DELETE FROM token_statuses WHERE ends <= ?").run(getGameTime());
  db.prepare("INSERT INTO token_statuses (level_id, token_id, ends, status) VALUES (?, ?, ?, ?)").run(levelId, tokenId, ends, JSON.stringify(status));
}

/** Statuses in effect on a level's tokens, by token id. */
export function listTokenStatuses(levelId: number): Map<number, (Status & { id: number; ends: number })[]> {
  const rows = db
    .prepare<[number, number], { id: number; token_id: number; ends: number; status: string }>("SELECT id, token_id, ends, status FROM token_statuses WHERE level_id = ? AND ends > ? ORDER BY id")
    .all(levelId, getGameTime());
  const out = new Map<number, (Status & { id: number; ends: number })[]>();
  for (const r of rows) out.set(r.token_id, [...(out.get(r.token_id) ?? []), { id: r.id, ends: r.ends, ...JSON.parse(r.status) }]);
  return out;
}

export function removeTokenStatus(id: number): void {
  db.prepare("DELETE FROM token_statuses WHERE id = ?").run(id);
}

// ---------- Conditions, effects and modifiers (Poisoned…) ----------

/** The catalog effects an item gives whoever has it equipped, or a creature always has (its "standing" effects). */
export function getStandingEffects(owner: { item_id: number } | { creature_id: number }): number[] {
  const [table, id] = "item_id" in owner ? ["items", owner.item_id] : ["creatures", owner.creature_id];
  return JSON.parse(db.prepare<[number], { effects: string }>(`SELECT effects FROM ${table} WHERE id = ?`).get(id)?.effects ?? "[]");
}

export function setStandingEffects(owner: { item_id: number } | { creature_id: number }, effects: number[]): void {
  const [table, id] = "item_id" in owner ? ["items", owner.item_id] : ["creatures", owner.creature_id];
  db.prepare<[string, number]>(`UPDATE ${table} SET effects = ? WHERE id = ?`).run(JSON.stringify(effects), id);
}

// The catalog: effects. An effect is a name, its rules (modifiers) and how long it lasts: so many rounds (with its
// saves and what ends it), while equipped, or always. Actions, the GM, items, creatures and professions grant them.
// See lib/conditions.ts.
db.exec(`CREATE TABLE IF NOT EXISTS effects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  modifiers TEXT NOT NULL DEFAULT '[]'
)`);
addColumn("effects", "builtin", "TEXT NOT NULL DEFAULT ''"); // a built-in effect's key (lib/builtinConditions.ts): its rules follow the code
const LIFECYCLE_COLUMNS: [keyof Lifecycle | "duration", string][] = [
  ["duration", "TEXT NOT NULL DEFAULT 'rounds'"], // rounds | equipped | always
  ["rounds", "INTEGER NOT NULL DEFAULT 1"],
  ["save_attr", "TEXT NOT NULL DEFAULT ''"], // the save that ends it ('' = none)
  ["save_dc", "INTEGER NOT NULL DEFAULT 12"],
  ["apply_save_attr", "TEXT NOT NULL DEFAULT ''"], // a save as it lands ('' = none)
  ["apply_save_dc", "INTEGER NOT NULL DEFAULT 12"],
  ["apply_save_outcome", "TEXT NOT NULL DEFAULT 'negates'"], // on a success: negates | halves (its rounds)
  ["save_when", "TEXT NOT NULL DEFAULT 'end'"], // when the save to end it is rolled: end | start | damaged
  ["save_action", "INTEGER NOT NULL DEFAULT 0"], // 1: Shake off (an action) rolls it too
  ["saves_needed", "INTEGER NOT NULL DEFAULT 1"], // successful saves to end it
  ["ends_on_damage", "INTEGER NOT NULL DEFAULT 0"], // 1: ends when hurt
  ["ends_on_attack", "INTEGER NOT NULL DEFAULT 0"], // 1: ends when they attack
  ["ends_on_trigger", "INTEGER NOT NULL DEFAULT 0"], // 1: ends once its trigger fires
  ["concentration", "INTEGER NOT NULL DEFAULT 0"], // 1: needs whoever put it on to keep concentrating
  ["reapply", "TEXT NOT NULL DEFAULT 'refresh'"], // put on again: refresh | stack | ignore
  ["stack_limit", "INTEGER NOT NULL DEFAULT 0"], // stacking: at most this many (0 = no limit)
];
for (const [column, definition] of LIFECYCLE_COLUMNS) addColumn("effects", column, definition);

// Retired 2026-11-13: conditions (an effect's lifecycle lived here, applying effects by id). Kept, empty, so an older
// campaign export can still be imported: its rows become effects (migrateConditions, below).
db.exec(`CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  effects TEXT NOT NULL DEFAULT '[]',
  rounds INTEGER NOT NULL DEFAULT 1,
  save_attr TEXT NOT NULL DEFAULT '',
  save_dc INTEGER NOT NULL DEFAULT 12
)`);
for (const [column, definition] of LIFECYCLE_COLUMNS) if (column !== "duration") addColumn("conditions", column, definition);
addColumn("conditions", "builtin", "TEXT NOT NULL DEFAULT ''");

type EffectRow = Omit<Effect, "modifiers"> & { modifiers: string };
const parseEffect = (r: EffectRow): Effect => ({ ...r, modifiers: JSON.parse(r.modifiers) as Modifier[] });

/** Every catalog effect; an aura's (or trigger's) effect filled in as `given` (one level, so they can't loop). */
export function listEffectDefs(): Effect[] {
  const raw = db.prepare<[], EffectRow>("SELECT * FROM effects ORDER BY name").all().map(parseEffect);
  const gives = (m: Modifier) => m.kind === "aura" || (m.kind === "trigger" && !!m.condition);
  if (!raw.some((e) => e.modifiers.some(gives))) return raw;
  const given = (id: number) => { const e = raw.find((x) => x.id === id); return e ? asCondition(e) : undefined; };
  return raw.map((e) => ({ ...e, modifiers: e.modifiers.map((m) => (gives(m) ? { ...m, given: given((m as { condition: number }).condition) } : m)) }));
}

export function getEffectDef(id: number): Effect | undefined {
  return listEffectDefs().find((e) => e.id === id);
}

/** A catalog effect as it's put on a creature (what the round engine and afflictions keep). */
export function getCondition(effectId: number): Condition | undefined {
  const e = getEffectDef(effectId);
  return e ? asCondition(e) : undefined;
}

/**
 * Inserts when id is null, otherwise updates; returns the id. Lifecycle fields left out keep what the effect had (a
 * new one: the defaults, lasting 1 round).
 */
export function saveEffectDef(id: number | null, e: Pick<Effect, "name" | "description" | "modifiers"> & Partial<Lifecycle & { duration: Duration; builtin: string }>): number {
  const was = id === null ? undefined : db.prepare<[number], EffectRow>("SELECT * FROM effects WHERE id = ?").get(id);
  const life = Object.fromEntries(LIFECYCLE_COLUMNS.map(([k]) => [k, (e as Record<string, unknown>)[k] ?? (was as Record<string, unknown> | undefined)?.[k] ?? (k === "duration" ? "rounds" : DEFAULT_LIFECYCLE[k])]));
  const params = { ...life, name: e.name, description: e.description, builtin: e.builtin ?? was?.builtin ?? "", modifiers: JSON.stringify(e.modifiers.map((m) => (m.kind === "aura" || m.kind === "trigger" ? { ...m, given: undefined } : m))) };
  const cols = ["name", "description", "modifiers", "builtin", ...LIFECYCLE_COLUMNS.map(([k]) => k)];
  if (id === null) return Number(db.prepare(`INSERT INTO effects (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`).run(params).lastInsertRowid);
  db.prepare(`UPDATE effects SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...params, id });
  return id;
}

/** Removes an effect, and takes it off the actions that grant it and the items and creatures that have it. */
export function removeEffectDef(id: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM effects WHERE id = ?").run(id);
    for (const a of db.prepare<[], { id: number; conditions: string }>("SELECT id, conditions FROM actions WHERE conditions != '[]'").all()) {
      const list = (JSON.parse(a.conditions) as { id: number; on: string }[]).filter((c) => c.id !== id);
      db.prepare("UPDATE actions SET conditions = ? WHERE id = ?").run(JSON.stringify(list), a.id);
    }
    for (const table of ["items", "creatures"]) for (const r of db.prepare<[], { id: number; effects: string }>(`SELECT id, effects FROM ${table} WHERE effects != '[]'`).all()) {
      db.prepare(`UPDATE ${table} SET effects = ? WHERE id = ?`).run(JSON.stringify((JSON.parse(r.effects) as number[]).filter((x) => x !== id)), r.id);
    }
  })();
}

/** An effect as the first version kept it (effect_defs: one row per condition, modifiers inline). */
type OldEffectDef = { id: number; name: string; description: string; per_round: string; per_round_kind: string; damage_type: DamageType | ""; rounds: number; save_attr: Attribute | ""; save_dc: number; boosts: Boost[]; roll_grants: RollGrant[] };
const oldModifiers = (o: OldEffectDef): Modifier[] => [
  ...(o.per_round ? [{ kind: "periodic" as const, value: o.per_round, heal: o.per_round_kind === "healing", damage_type: o.damage_type }] : []),
  ...o.boosts.map((b) => ({ kind: "boost" as const, target: b.target, value: b.value })),
  ...o.roll_grants.map((g) => ({ kind: "roll" as const, roll: g.roll, mode: g.mode })),
];
/** An old effect as the condition it really was, with one effect of the same name holding its modifiers. */
const oldToCondition = (o: OldEffectDef): Condition => ({ id: o.id, name: o.name, description: o.description, rounds: o.rounds, save_attr: o.save_attr, save_dc: o.save_dc, effects: [{ id: o.id, name: o.name, description: "", modifiers: oldModifiers(o) }] });

// Once: the first version's effects (effect_defs) become conditions, each applying an effect of the same name (same
// ids, so actions and effects already on creatures still point at them); actions' "effects" become "conditions".
// (Then migrateConditions turns those into effects.)
{
  const hasOld = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'effect_defs'").get()!.n > 0;
  if (hasOld) {
    db.transaction(() => {
      const old = db.prepare<[], Omit<OldEffectDef, "boosts" | "roll_grants"> & { boosts: string; roll_grants: string }>("SELECT * FROM effect_defs").all()
        .map((r) => ({ ...r, boosts: JSON.parse(r.boosts), roll_grants: JSON.parse(r.roll_grants) }) as OldEffectDef);
      for (const o of old) {
        db.prepare("INSERT INTO effects (id, name, description, modifiers) VALUES (?, ?, '', ?)").run(o.id, o.name, JSON.stringify(oldModifiers(o)));
        db.prepare("INSERT INTO conditions (id, name, description, effects, rounds, save_attr, save_dc) VALUES (?, ?, ?, ?, ?, ?, ?)").run(o.id, o.name, o.description, JSON.stringify([o.id]), o.rounds, o.save_attr, o.save_dc);
      }
      db.prepare("UPDATE actions SET conditions = effects WHERE effects != '[]' AND conditions = '[]'").run();
      db.exec("ALTER TABLE effect_defs RENAME TO effect_defs_migrated"); // kept, but never migrated again
    })();
  }
}

// Once per action: its own boosts and roll effects become a condition (named after it) applying an effect of the
// same name, on whoever it was for; health boosts become an instant heal. Its lists are then emptied, so this runs
// only for actions saved before conditions existed. (Then migrateConditions turns those into effects.)
{
  type Row = { id: number; name: string; boosts: string; roll_grants: string; duration_amount: number; duration_unit: string; conditions: string };
  const per: Record<string, number> = { round: 1, turn: 1, minute: 10, hour: 600, day: 14400, "short rest": 600, "long rest": 4800 };
  const rows = db.prepare<[], Row>("SELECT id, name, boosts, roll_grants, duration_amount, duration_unit, conditions FROM actions WHERE boosts != '[]' OR roll_grants != '[]'").all();
  if (rows.length) db.transaction(() => {
    for (const r of rows) {
      const boosts: Boost[] = JSON.parse(r.boosts), grants: RollGrant[] = JSON.parse(r.roll_grants), granted: { id: number; on: "self" | "target" }[] = JSON.parse(r.conditions);
      const sides = (["target", "self"] as const).filter((on) => boosts.some((b) => (b.on ?? "self") === on) || grants.some((g) => (g.on ?? "self") === on));
      for (const on of sides) {
        const modifiers: Modifier[] = [
          ...boosts.filter((b) => (b.on ?? "self") === on).map((b): Modifier => (b.target === "health" ? { kind: "instant", value: b.value.replace(/^\+/, ""), heal: true, damage_type: "" } : { kind: "boost", target: b.target, value: b.value })),
          ...grants.filter((g) => (g.on ?? "self") === on).map((g): Modifier => ({ kind: "roll", roll: g.roll, mode: g.mode })),
        ];
        const name = sides.length > 1 && on === "self" ? `${r.name} (self)` : r.name;
        const rounds = Math.max(1, (per[r.duration_unit] ?? 1) * Math.max(1, r.duration_amount));
        const effect = saveEffectDef(null, { name, description: `From ${r.name}.`, modifiers });
        granted.push({ id: Number(db.prepare("INSERT INTO conditions (name, description, effects, rounds, save_attr, save_dc) VALUES (?, ?, ?, ?, '', 12)").run(name, `From ${r.name}.`, JSON.stringify([effect]), rounds).lastInsertRowid), on });
      }
      db.prepare("UPDATE actions SET boosts = '[]', roll_grants = '[]', conditions = ? WHERE id = ?").run(JSON.stringify(granted), r.id);
    }
  })();
}

/**
 * Turns the retired conditions into effects (once at start-up, and after importing an older campaign export). Each
 * condition becomes an effect with its lifecycle: a custom condition with one effect of its own merges into that
 * effect (which keeps its name: Mesmerize → Mesmerized); any other (several effects, shared ones, none) becomes a new
 * effect named after it, with all their rules. Everything that pointed at a condition then points at its effect:
 * actions, triggers and auras in effects' rules, effects on tokens now, aura passes. The building blocks the old
 * built-ins were made of go, unless something has one or no built-in effect has its rules. Returns how many conditions it turned into effects.
 */
export function migrateConditions(): number {
  type CondRow = Lifecycle & { id: number; name: string; description: string; effects: string; builtin: string };
  const conds = db.prepare<[], CondRow>("SELECT * FROM conditions ORDER BY id").all();
  if (!conds.length) return 0;
  db.transaction(() => {
    const pieceKeys = new Set(BUILTIN_PIECES.map((p) => p.key));
    const effects = db.prepare<[], EffectRow>("SELECT * FROM effects").all().map(parseEffect);
    const pieces = new Set(effects.filter((e) => e.builtin && pieceKeys.has(e.builtin)).map((e) => e.id));
    db.prepare(`UPDATE effects SET builtin = '' WHERE builtin IN (${[...pieceKeys].map(() => "?").join(", ")})`).run(...pieceKeys); // their keys now name the merged built-ins
    const lists = new Map(conds.map((c) => [c.id, (JSON.parse(c.effects) as number[]).filter((id) => effects.some((e) => e.id === id))]));
    const usedBy = (effectId: number) => conds.filter((c) => lists.get(c.id)!.includes(effectId)).length;
    const lifecycle = (c: CondRow) => Object.fromEntries(LIFECYCLE_COLUMNS.flatMap(([k]) => (k === "duration" ? [] : [[k, c[k] ?? DEFAULT_LIFECYCLE[k]]]))) as unknown as Lifecycle;
    const map = new Map<number, number>(), merged = new Set<number>();
    for (const c of conds) {
      const list = lists.get(c.id)!, only = list.length === 1 ? effects.find((e) => e.id === list[0]) : undefined;
      if (only && !pieces.has(only.id) && usedBy(only.id) === 1 && !merged.has(only.id)) {
        saveEffectDef(only.id, { name: only.name, description: only.description || c.description, modifiers: only.modifiers, ...lifecycle(c), duration: "rounds", builtin: c.builtin });
        merged.add(only.id);
        map.set(c.id, only.id);
      } else {
        const modifiers = list.flatMap((id) => effects.find((e) => e.id === id)!.modifiers);
        map.set(c.id, saveEffectDef(null, { name: c.name, description: c.description, modifiers, ...lifecycle(c), duration: "rounds", builtin: c.builtin }));
      }
    }
    const to = (id: number) => map.get(id);
    // Actions grant the effects.
    for (const a of db.prepare<[], { id: number; conditions: string }>("SELECT id, conditions FROM actions WHERE conditions != '[]'").all()) {
      const list = (JSON.parse(a.conditions) as { id: number; on: string }[]).flatMap((x) => (to(x.id) ? [{ ...x, id: to(x.id)! }] : []));
      db.prepare("UPDATE actions SET conditions = ? WHERE id = ?").run(JSON.stringify(list), a.id);
    }
    // Rules that give an effect (a trigger's, an aura's) name the effect.
    for (const e of db.prepare<[], { id: number; modifiers: string }>("SELECT id, modifiers FROM effects").all()) {
      const mods = JSON.parse(e.modifiers) as Modifier[];
      if (!mods.some((m) => (m.kind === "trigger" && m.condition) || m.kind === "aura")) continue;
      const next = mods.map((m) => (m.kind === "trigger" && m.condition ? { ...m, condition: to(m.condition) ?? 0 } : m.kind === "aura" ? { ...m, condition: to(m.condition) ?? m.condition } : m));
      db.prepare("UPDATE effects SET modifiers = ? WHERE id = ?").run(JSON.stringify(next), e.id);
    }
    // Effects on tokens now (their kept copies stay as they were; only what they're known by changes), and aura passes.
    for (const t of db.prepare<[], { id: number; effect_id: number; effect: string }>("SELECT id, effect_id, effect FROM token_afflictions").all()) {
      const id = to(t.effect_id);
      if (id) db.prepare("UPDATE token_afflictions SET effect_id = ?, effect = ? WHERE id = ?").run(id, JSON.stringify({ ...JSON.parse(t.effect), id }), t.id);
    }
    for (const p of db.prepare<[], { level_id: number; token_id: number; condition_id: number }>("SELECT * FROM aura_passes").all()) {
      db.prepare("DELETE FROM aura_passes WHERE level_id = ? AND token_id = ? AND condition_id = ?").run(p.level_id, p.token_id, p.condition_id);
      const id = to(p.condition_id);
      if (id) db.prepare("INSERT OR IGNORE INTO aura_passes (level_id, token_id, condition_id) VALUES (?, ?, ?)").run(p.level_id, p.token_id, id);
    }
    // What's left that only conditions used: effects merged into nothing are given a duration from what has them now.
    const standing = (table: string) => new Set(db.prepare<[], { effects: string }>(`SELECT effects FROM ${table}`).all().flatMap((r) => JSON.parse(r.effects) as number[]));
    const onItems = standing("items"), onCreatures = standing("creatures");
    const givenByRules = new Set(db.prepare<[], { modifiers: string }>("SELECT modifiers FROM effects").all().flatMap((r) => (JSON.parse(r.modifiers) as Modifier[]).flatMap((m) => (m.kind === "trigger" || m.kind === "aura" ? [m.condition] : []))));
    for (const e of effects) {
      if (merged.has(e.id)) continue;
      const covered = BUILTIN_CONDITIONS.some((c) => c.effects.includes(e.builtin ?? "")); // a built-in effect has its rules now (See invisible isn't in any)
      if (pieces.has(e.id) && covered && !onItems.has(e.id) && !onCreatures.has(e.id) && !givenByRules.has(e.id)) { db.prepare("DELETE FROM effects WHERE id = ?").run(e.id); continue; }
      const duration: Duration = onItems.has(e.id) ? "equipped" : onCreatures.has(e.id) ? "always" : "rounds";
      db.prepare("UPDATE effects SET duration = ? WHERE id = ?").run(duration, e.id);
    }
    db.prepare("DELETE FROM conditions").run();
  })();
  return conds.length;
}

/** The built-in effects, each seeded once (by key); one sharing its name with an effect the GM made is left out. Their rules follow the code. */
function seedBuiltinEffects(): void {
  const have = new Set(db.prepare<[], { builtin: string }>("SELECT builtin FROM effects WHERE builtin != ''").all().map((r) => r.builtin));
  const names = new Set(db.prepare<[], { name: string }>("SELECT name FROM effects WHERE builtin = ''").all().map((r) => r.name.toLowerCase()));
  db.transaction(() => {
    for (const e of BUILTIN_EFFECTS) {
      if (have.has(e.key)) db.prepare("UPDATE effects SET modifiers = ? WHERE builtin = ?").run(JSON.stringify(e.modifiers), e.key); // names, rounds and saves stay the GM's
      else if (!names.has(e.name.toLowerCase())) saveEffectDef(null, { name: e.name, description: e.description, modifiers: e.modifiers, builtin: e.key });
    }
  })();
}

// Catalog effects added once each (lib/seedEffects.ts), by name: after that they're the GM's to edit, rename or delete.
db.exec("CREATE TABLE IF NOT EXISTS seeded_effects (name TEXT PRIMARY KEY)");
/** Adds each seeded effect not added before (one the GM already has by that name counts as added). */
export function seedCatalogEffects(): void {
  const done = new Set(db.prepare<[], { name: string }>("SELECT name FROM seeded_effects").all().map((r) => r.name));
  const todo = SEEDED_EFFECTS.filter((e) => !done.has(e.name));
  if (!todo.length) return;
  db.transaction(() => {
    const idOf = (name: string) => db.prepare<[string], { id: number }>("SELECT id FROM effects WHERE name = ? COLLATE NOCASE").get(name)?.id ?? -1;
    // An effect a rule names: by name, else a built-in piece of that name (Sickly, Hampered), added if it isn't there.
    const named = (name: string) => {
      const piece = BUILTIN_PIECES.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (idOf(name) !== -1 || !piece) return idOf(name);
      return db.prepare<[string], { id: number }>("SELECT id FROM effects WHERE builtin = ?").get(piece.key)?.id ?? saveEffectDef(null, { name: piece.name, description: piece.description, modifiers: piece.modifiers, builtin: piece.key });
    };
    for (const e of todo) {
      if (idOf(e.name) === -1) {
        const { modifiers, lifecycle } = compileSeed(e, named, (m) => (idOf(m.name) !== -1 ? idOf(m.name) : saveEffectDef(null, { name: m.name, description: "Made by an effect's rule.", modifiers: m.effect, rounds: m.rounds, reapply: m.reapply, stack_limit: m.stack_limit })));
        saveEffectDef(null, { name: e.name, description: e.description, modifiers, ...lifecycle });
      }
      db.prepare("INSERT INTO seeded_effects (name) VALUES (?)").run(e.name);
    }
  })();
}

/** Conditions to effects, then the built-ins, then the seeded catalog effects: at start-up, and after a campaign import. */
export function settleEffects(): void {
  migrateConditions();
  seedBuiltinEffects();
  seedCatalogEffects();
  settleSpeeds();
}

/** Old speeds (plain numbers, feet per round) become distance over time: feet per second (30 → 5 ft/s). Idempotent. */
export function settleSpeeds(): void {
  for (const table of ["creatures", "characters"] as const) {
    for (const r of db.prepare<[], { id: number; movement: string }>(`SELECT id, movement FROM ${table}`).all()) {
      const raw = JSON.parse(r.movement || "{}") as Record<string, unknown>;
      if (!Object.values(raw).some((v) => typeof v === "number")) continue;
      const next = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "number" ? ftPerSec(Math.round((v / 6) * 100) / 100) : v]));
      db.prepare(`UPDATE ${table} SET movement = ? WHERE id = ?`).run(JSON.stringify(next), r.id);
    }
  }
}

// Strain: points on a creature's attributes (each −1 to it, never below half), left by conditions; they outlast them
// and drain with rest. A character's follow them from map to map ("c:<character id>"); a creature's stay with its
// token ("t:<token id>").
db.exec(`CREATE TABLE IF NOT EXISTS strain (
  owner TEXT NOT NULL,
  attribute TEXT NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (owner, attribute)
)`);
const strainOwner = (tokenId: number) => {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  return t?.character_id ? `c:${t.character_id}` : `t:${tokenId}`;
};
/** A token's strain points, by attribute. */
export function getStrain(tokenId: number): Partial<Record<Attribute, number>> {
  return Object.fromEntries(db.prepare<[string], { attribute: Attribute; points: number }>("SELECT attribute, points FROM strain WHERE owner = ?").all(strainOwner(tokenId)).map((r) => [r.attribute, r.points]));
}
/** Adds strain points to one of a token's attributes (negative: takes them off, not below none); returns the points now. */
export function addStrain(tokenId: number, attribute: Attribute, points: number): number {
  const owner = strainOwner(tokenId), now = Math.max(0, (getStrain(tokenId)[attribute] ?? 0) + points);
  if (now) db.prepare("INSERT INTO strain (owner, attribute, points) VALUES (?, ?, ?) ON CONFLICT (owner, attribute) DO UPDATE SET points = excluded.points").run(owner, attribute, now);
  else db.prepare("DELETE FROM strain WHERE owner = ? AND attribute = ?").run(owner, attribute);
  return now;
}
/** Rest drains everyone's strain: a short rest 1 point per attribute, a long rest all but 1. */
export function restStrain(kind: "short" | "long"): void {
  db.transaction(() => {
    db.prepare(kind === "short" ? "UPDATE strain SET points = points - 1" : "UPDATE strain SET points = MIN(points, 1)").run();
    db.prepare("DELETE FROM strain WHERE points <= 0").run();
  })();
}

// Conditions on creatures right now: a copy of the condition (and its effects) as it was put on, the rounds it has
// left, and who put it there.
db.exec(`CREATE TABLE IF NOT EXISTS token_afflictions (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  effect_id INTEGER NOT NULL, -- the condition's id
  effect TEXT NOT NULL, -- JSON Condition
  rounds_left INTEGER NOT NULL,
  by_token INTEGER
)`);

addColumn("token_afflictions", "saved", "INTEGER NOT NULL DEFAULT 0"); // successful saves so far
addColumn("token_afflictions", "aura", "INTEGER"); // given by this token's aura (while within it)
addColumn("token_afflictions", "area", "INTEGER"); // given by this lasting area (while in it)

// Creatures that passed the save against an aura's condition as they came within it: safe until they leave.
db.exec(`CREATE TABLE IF NOT EXISTS aura_passes (
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  condition_id INTEGER NOT NULL,
  PRIMARY KEY (level_id, token_id, condition_id)
)`);

/** A level's aura passes, as "token:condition". */
export function listAuraPasses(levelId: number): Set<string> {
  return new Set(db.prepare<[number], { token_id: number; condition_id: number }>("SELECT token_id, condition_id FROM aura_passes WHERE level_id = ?").all(levelId).map((r) => `${r.token_id}:${r.condition_id}`));
}
export function saveAuraPasses(levelId: number, passes: Set<string>): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM aura_passes WHERE level_id = ?").run(levelId);
    const insert = db.prepare("INSERT OR IGNORE INTO aura_passes (level_id, token_id, condition_id) VALUES (?, ?, ?)");
    for (const k of passes) { const [t, c] = k.split(":").map(Number); insert.run(levelId, t, c); }
  })();
}

/** A kept copy as a Condition (one kept by the first version is an old effect). */
const keptCondition = (json: string): Condition => {
  const c = JSON.parse(json);
  return "per_round" in c ? oldToCondition(c) : c;
};

/** The conditions on a level's tokens, by token id. */
export function listAfflictions(levelId: number): Map<number, Affliction[]> {
  const out = new Map<number, Affliction[]>();
  for (const r of db.prepare<[number], { id: number; token_id: number; effect: string; rounds_left: number; by_token: number | null; saved: number; aura: number | null; area: number | null }>("SELECT id, token_id, effect, rounds_left, by_token, saved, aura, area FROM token_afflictions WHERE level_id = ? ORDER BY id").all(levelId)) {
    out.set(r.token_id, [...(out.get(r.token_id) ?? []), { id: r.id, condition: keptCondition(r.effect), left: r.rounds_left, by: r.by_token, saved: r.saved, ...(r.aura != null ? { aura: r.aura } : {}), ...(r.area != null ? { area: r.area } : {}) }]);
  }
  return out;
}

/** Replaces a level's conditions with these (after a round, or time passing). */
export function saveAfflictions(levelId: number, all: Map<number, Affliction[]>): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM token_afflictions WHERE level_id = ?").run(levelId);
    const insert = db.prepare("INSERT INTO token_afflictions (level_id, token_id, effect_id, effect, rounds_left, by_token, saved, aura, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const [tokenId, list] of all) for (const a of list) if (a.left > 0) insert.run(levelId, tokenId, a.condition.id, JSON.stringify(a.condition), a.left, a.by, a.saved ?? 0, a.aura ?? null, a.area ?? null);
  })();
}

/** Takes off what an area put on a token while it was in it (it has left); returns the names taken off. */
export function leaveAreaAfflictions(levelId: number, tokenId: number, area: number): string[] {
  const all = listAfflictions(levelId), list = all.get(tokenId) ?? [];
  const gone = list.filter((a) => a.area === area);
  if (!gone.length) return [];
  all.set(tokenId, list.filter((a) => a.area !== area));
  saveAfflictions(levelId, all);
  return gone.map((a) => a.condition.name);
}

/** Puts a condition on a token (again: by its re-application rule); returns whether anything changed. */
export function addAffliction(levelId: number, tokenId: number, condition: Condition, by: number | null, area?: number): boolean {
  const all = listAfflictions(levelId);
  if (area != null) { // while in this area: once (no rounds); it comes off as they leave
    const list = all.get(tokenId) ?? [];
    if (list.some((a) => a.area === area && a.condition.id === condition.id)) return false;
    all.set(tokenId, [...list, { condition, left: 1, by, area }]);
    saveAfflictions(levelId, all);
    return true;
  }
  const r = reapplied(all.get(tokenId) ?? [], condition, condition.rounds, by);
  if (!r.applied) return false;
  all.set(tokenId, r.list);
  saveAfflictions(levelId, all);
  return true;
}

/** Takes a condition off; returns its level. */
export function removeAffliction(id: number): number | undefined {
  const levelId = db.prepare<[number], { level_id: number }>("SELECT level_id FROM token_afflictions WHERE id = ?").get(id)?.level_id;
  db.prepare<[number]>("DELETE FROM token_afflictions WHERE id = ?").run(id);
  return levelId;
}

/** Levels with conditions on anyone (for time passing out of an encounter). */
export function afflictedLevels(): number[] {
  return db.prepare<[], { level_id: number }>("SELECT DISTINCT level_id FROM token_afflictions").all().map((r) => r.level_id);
}

// ---------- Effects played by scripts ----------

// A one-off visual effect a script played (fx('arrow', A, B)): every map in the session draws it from `starts` (ms).
db.exec(`CREATE TABLE IF NOT EXISTS map_fx (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  starts INTEGER NOT NULL,
  fx TEXT NOT NULL
)`);

export function addMapFx(levelId: number, starts: number, fx: Fx): void {
  db.prepare("DELETE FROM map_fx WHERE starts < ?").run(Date.now() - 60_000);
  db.prepare("INSERT INTO map_fx (level_id, starts, fx) VALUES (?, ?, ?)").run(levelId, starts, JSON.stringify(fx));
}

/** Effects on a level after the given id (the last one a map has seen), from the last minute. */
export function listMapFx(levelId: number, afterId: number): { id: number; starts: number; fx: Fx }[] {
  return db
    .prepare<[number, number, number], { id: number; starts: number; fx: string }>("SELECT id, starts, fx FROM map_fx WHERE level_id = ? AND id > ? AND starts > ? ORDER BY id")
    .all(levelId, afterId, Date.now() - 60_000)
    .map((r) => ({ ...r, fx: JSON.parse(r.fx) }));
}

// ---------- Pings ----------

// Someone pressed and held on the map to point at a spot; everyone in the session sees it for a few seconds.
db.exec(`CREATE TABLE IF NOT EXISTS pings (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  gm INTEGER NOT NULL,
  created INTEGER NOT NULL
)`);

export interface Ping { id: number; x: number; y: number; user_id: number; name: string; gm: 0 | 1 }

export function addPing(levelId: number, x: number, y: number, user: { id: number; name: string; role: Role }): void {
  const now = Date.now();
  db.prepare("DELETE FROM pings WHERE created < ?").run(now - 60_000);
  db.prepare("INSERT INTO pings (level_id, x, y, user_id, name, gm, created) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    levelId, x, y, user.id, user.name, user.role === "gm" ? 1 : 0, now
  );
}

/** Pings on a level newer than `afterId`, from the last few seconds. */
export function listPings(levelId: number, afterId: number): Ping[] {
  return db
    .prepare<[number, number, number], Ping>("SELECT id, x, y, user_id, name, gm FROM pings WHERE level_id = ? AND id > ? AND created > ? ORDER BY id")
    .all(levelId, afterId, Date.now() - 4000);
}

// ---------- Roll requests ----------

// A roll a player has to make (e.g. picking a lock): shown to them as a prompt until they roll it and close it.
// `action` says what the result is for, so the server settles it once rolled.
db.exec(`CREATE TABLE IF NOT EXISTS roll_requests (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES users(id),
  character_id INTEGER NOT NULL,
  spec TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT,
  done INTEGER NOT NULL DEFAULT 0
)`);

export interface RollRequest {
  id: number;
  player_id: number;
  character_id: number;
  spec: RollSpec;
  action: RollAction;
  result: { total: number; parts: RolledPart[]; outcome: string; success: boolean } | null;
}

/** What a roll is for. */
export type RollAction =
  | { kind: "pickLock"; doorId: number; dc: number }
  | { kind: "search"; dc: number; at?: { col: number; row: number } } // at: where they searched from (a Search in a round: where they stood when it finished)
  | { kind: "initiative"; levelId: number; tokenId: number }
  | { kind: "hide"; levelId: number; tokenId: number; inRound?: boolean } // inRound: they already hid in a round; the roll only sets the total // Hide: their Stealth total is how hard they are to find (if no enemy sees them as they roll)
  | { kind: "rolloff"; levelId: number; tokenId: number } // a roll-off for a contested spot
  | { kind: "conditionSave"; levelId: number; tokenId: number; key: string } // a save against a condition as it lands, mid-round
  | { kind: "improvise"; id: number } // the roll an improvisation needs (its outcome shown when it plays out)
  | { kind: "areaSave"; levelId: number; areaId: number; tokenId: number; leaving?: boolean; staying?: boolean }; // out of combat: a save against a lasting area they walked into (left, stayed in)

type RollRequestRow = { id: number; player_id: number; character_id: number; spec: string; action: string; result: string | null };
const parseRequest = (r: RollRequestRow): RollRequest => ({ ...r, spec: JSON.parse(r.spec), action: JSON.parse(r.action), result: r.result ? JSON.parse(r.result) : null });

/** Asks a player to roll; replaces any roll they haven't made yet (and puts away one they rolled but left open). */
// Hide: a token hidden from everyone not on its side, with its Stealth total (what a Search has to beat). Kept until revealed.
db.exec(`CREATE TABLE IF NOT EXISTS token_hidden (
  token_id INTEGER PRIMARY KEY,
  stealth INTEGER NOT NULL
)`);

export function setHidden(tokenId: number, stealth: number): void {
  db.prepare("INSERT OR REPLACE INTO token_hidden (token_id, stealth) VALUES (?, ?)").run(tokenId, Math.round(stealth));
}

export function clearHidden(tokenId: number): void {
  db.prepare("DELETE FROM token_hidden WHERE token_id = ?").run(tokenId);
}

/** Hidden tokens on a level, with their Stealth totals. */
export function listHidden(levelId: number): Map<number, number> {
  return new Map(
    db.prepare<[number], { token_id: number; stealth: number }>("SELECT h.token_id, h.stealth FROM token_hidden h JOIN map_tokens t ON t.id = h.token_id WHERE t.level_id = ?").all(levelId).map((r) => [r.token_id, r.stealth])
  );
}

// Assist: whoever was helped has advantage on their next roll (one help at a time; a new one replaces it). Kept until used.
db.exec(`CREATE TABLE IF NOT EXISTS assists (
  token_id INTEGER PRIMARY KEY,
  by_token INTEGER NOT NULL,
  by_name TEXT NOT NULL
)`);

export function setAssist(tokenId: number, byToken: number, byName: string): void {
  db.prepare("INSERT OR REPLACE INTO assists (token_id, by_token, by_name) VALUES (?, ?, ?)").run(tokenId, byToken, byName);
}

export function listAssists(levelId: number): { tokenId: number; byToken: number; byName: string }[] {
  return db
    .prepare<[number], { token_id: number; by_token: number; by_name: string }>("SELECT a.token_id, a.by_token, a.by_name FROM assists a JOIN map_tokens t ON t.id = a.token_id WHERE t.level_id = ?")
    .all(levelId)
    .map((r) => ({ tokenId: r.token_id, byToken: r.by_token, byName: r.by_name }));
}

export function clearAssist(tokenId: number): void {
  db.prepare("DELETE FROM assists WHERE token_id = ?").run(tokenId);
}

/** A roll request for a character who was helped (Assist): advantage on it ("helped by …"), and the help is used up. Not initiative. */
function withAssist(characterId: number, spec: RollSpec, action: RollAction): RollSpec {
  if (action.kind === "initiative" || action.kind === "conditionSave") return spec; // a save mid-round: the round counts help itself
  const help = db.prepare<[number], { token_id: number; by_name: string }>("SELECT a.token_id, a.by_name FROM assists a JOIN map_tokens t ON t.id = a.token_id WHERE t.character_id = ?").get(characterId);
  if (!help) return spec;
  clearAssist(help.token_id);
  return { ...spec, mode: spec.mode === "disadvantage" ? "normal" : "advantage", label: `${spec.label} (helped by ${help.by_name})` };
}

/**
 * Help (Assist) given while the helped character has a roll waiting that isn't rolled yet (not initiative): it applies
 * to that one (advantage, "helped by …") and is used up. Returns whether it did.
 */
export function assistOpenRequest(tokenId: number): boolean {
  const r = db
    .prepare<[number], { id: number; spec: string; action: string; character_id: number }>(
      "SELECT r.id, r.spec, r.action, r.character_id FROM roll_requests r JOIN map_tokens t ON t.character_id = r.character_id WHERE t.id = ? AND r.done = 0 AND r.result IS NULL ORDER BY r.id DESC LIMIT 1"
    )
    .get(tokenId);
  if (!r) return false;
  const spec = withAssist(r.character_id, JSON.parse(r.spec) as RollSpec, JSON.parse(r.action) as RollAction);
  if (spec.label === (JSON.parse(r.spec) as RollSpec).label) return false; // not helped (initiative)
  db.prepare("UPDATE roll_requests SET spec = ? WHERE id = ?").run(JSON.stringify(spec), r.id);
  return true;
}

export function requestRoll(playerId: number, characterId: number, spec: RollSpec, action: RollAction): void {
  spec = withAssist(characterId, spec, action);
  db.transaction(() => {
    db.prepare<[number]>("UPDATE roll_requests SET done = 1 WHERE player_id = ?").run(playerId);
    db.prepare("INSERT INTO roll_requests (player_id, character_id, spec, action) VALUES (?, ?, ?, ?)").run(playerId, characterId, JSON.stringify(spec), JSON.stringify(action));
  })();
}

/** The roll a player is being asked for (or has just rolled and not yet closed). */
export function getOpenRollRequest(playerId: number): RollRequest | undefined {
  const r = db.prepare<[number], RollRequestRow>("SELECT id, player_id, character_id, spec, action, result FROM roll_requests WHERE player_id = ? AND done = 0 ORDER BY id DESC LIMIT 1").get(playerId);
  return r && parseRequest(r);
}

/** The open initiative roll asked of whoever plays this token, if they haven't rolled it. */
export function openInitiativeRequest(tokenId: number): RollRequest | undefined {
  return db.prepare<[], RollRequestRow>("SELECT id, player_id, character_id, spec, action, result FROM roll_requests WHERE done = 0 AND result IS NULL ORDER BY id DESC").all()
    .map(parseRequest).find((r) => r.action.kind === "initiative" && r.action.tokenId === tokenId);
}

/** The open roll-off asked of whoever plays this token, if they haven't rolled it. */
export function openRollOffRequest(tokenId: number): RollRequest | undefined {
  return db.prepare<[], RollRequestRow>("SELECT id, player_id, character_id, spec, action, result FROM roll_requests WHERE done = 0 AND result IS NULL ORDER BY id DESC").all()
    .map(parseRequest).find((r) => r.action.kind === "rolloff" && r.action.tokenId === tokenId);
}

/** The open condition save asked of whoever plays this token, if they haven't rolled it. */
export function openConditionSaveRequest(tokenId: number): RollRequest | undefined {
  return db.prepare<[], RollRequestRow>("SELECT id, player_id, character_id, spec, action, result FROM roll_requests WHERE done = 0 AND result IS NULL ORDER BY id DESC").all()
    .map(parseRequest).find((r) => r.action.kind === "conditionSave" && r.action.tokenId === tokenId);
}

/** Puts away any roll-offs still asked for (the contest was settled another way). */
export function closeRollOffRequests(): void {
  db.prepare("UPDATE roll_requests SET done = 1 WHERE done = 0 AND result IS NULL AND json_extract(action, '$.kind') = 'rolloff'").run();
}

/** An initiative roll lands: into the turn order, highest first (a re-roll replaces an earlier one); no longer waited on. */
export function settleInitiative(levelId: number, tokenId: number, total: number): void {
  const enc = getEncounter(levelId);
  if (!enc) return;
  const order = [...enc.order.filter((o) => o.token_id !== tokenId), { token_id: tokenId, initiative: total }].sort((x, y) => y.initiative - x.initiative);
  saveEncounter(levelId, { ...enc, order });
  setEncounterWaiting(levelId, getEncounterWaiting(levelId).filter((id) => id !== tokenId));
}

export function saveRollResult(id: number, result: NonNullable<RollRequest["result"]>): void {
  db.prepare("UPDATE roll_requests SET result = ? WHERE id = ?").run(JSON.stringify(result), id);
}

export function closeRollRequest(id: number, playerId: number): void {
  db.prepare("UPDATE roll_requests SET done = 1 WHERE id = ? AND player_id = ?").run(id, playerId);
}

/** A character's profession modifiers to one target, e.g. "skill:sleight of hand". */
export function characterModifiers(characterId: number, target: string): { profession: string; value: string }[] {
  const q = db.prepare<[number, string], { profession: string; value: string }>(
    "SELECT p.name AS profession, m.value FROM professions p JOIN profession_modifiers m ON m.profession_id = p.id WHERE p.id = ? AND m.target = ?",
  );
  return listCharacterProfessionIds(characterId).flatMap((pid) => q.all(pid, target)); // every rank held (cumulative)
}

// ---------- Secrets ----------

// Hidden things on a map (a trapdoor, a note under the rug), optionally a story discovery. The GM sees them all;
// players see one once it's revealed (by a successful Search nearby, or by the GM).
db.exec(`CREATE TABLE IF NOT EXISTS map_secrets (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  discovery_id INTEGER,
  revealed INTEGER NOT NULL DEFAULT 0
)`);

export interface MapSecret {
  id: number;
  x: number;
  y: number;
  name: string;
  text: string;
  discovery_id: number | null;
  revealed: 0 | 1;
}

export function listSecrets(levelId: number): MapSecret[] {
  return db.prepare<[number], MapSecret>("SELECT id, x, y, name, text, discovery_id, revealed FROM map_secrets WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addSecret(levelId: number, s: Omit<MapSecret, "id" | "revealed">): void {
  db.prepare("INSERT INTO map_secrets (level_id, x, y, name, text, discovery_id) VALUES (?, ?, ?, ?, ?, ?)").run(levelId, s.x, s.y, s.name, s.text, s.discovery_id);
}

export function deleteSecret(id: number): void {
  db.prepare("DELETE FROM map_secrets WHERE id = ?").run(id);
}

export function setSecretRevealed(id: number, revealed: boolean): void {
  db.prepare("UPDATE map_secrets SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, id);
}

/** A token spends movement: it moves to (col, row) and `feet` is added to what it has moved this turn. */
export function walkToken(id: number, col: number, row: number, feet: number): void {
  db.prepare<[number, number]>("UPDATE map_tokens SET moved = moved + ? WHERE id = ?").run(feet, id);
  moveToken(id, col, row);
}

/** Players' tokens still to roll initiative in the level's encounter (they join the turn order once they roll). */
export function getEncounterWaiting(levelId: number): number[] {
  const row = db.prepare<[number], { waiting: string }>("SELECT waiting FROM encounters WHERE level_id = ?").get(levelId);
  return row ? JSON.parse(row.waiting) : [];
}

export function setEncounterWaiting(levelId: number, tokenIds: number[]): void {
  db.prepare<[string, number]>("UPDATE encounters SET waiting = ? WHERE level_id = ?").run(JSON.stringify(tokenIds), levelId);
}

/** A round stopped mid-resolution for the GM to settle a contested move: its dice seed, the calls made so far, and
 * the contest waiting on them (see lib/resolveRound.ts). */
export interface PendingRound {
  seed: number;
  decisions: Record<string, number>;
  contest?: import("@/lib/resolveRound").Contest; // a contested move waiting on the GM's call
  save?: import("@/lib/resolveRound").SaveRequest; // or a player's save against a condition, waiting on their roll
  rolloff?: Record<number, number | null>; // a roll-off under way: each side's d20 (null = their player hasn't rolled yet)
}

export function getPendingRound(levelId: number): PendingRound | null {
  const row = db.prepare<[number], { pending: string | null }>("SELECT pending FROM encounters WHERE level_id = ?").get(levelId);
  return row?.pending ? JSON.parse(row.pending) : null;
}

export function setPendingRound(levelId: number, p: PendingRound | null): void {
  db.prepare<[string | null, number]>("UPDATE encounters SET pending = ? WHERE level_id = ?").run(p ? JSON.stringify(p) : null, levelId);
}

// ---------- Round plans ----------

// What each creature in an encounter plans to do this round (steps in order) and whether its planner is ready.
db.exec(`CREATE TABLE IF NOT EXISTS round_plans (
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT '[]',
  ready INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (level_id, token_id)
)`);

addColumn("round_plans", "rolled", "INTEGER NOT NULL DEFAULT 0"); // the player's dice for it: 0 not yet, 1 rolling, 2 rolled (plan set)

export function getRoundPlan(levelId: number, tokenId: number): { plan: PlanStep[]; ready: boolean; rolled: 0 | 1 | 2 } {
  const r = db.prepare<[number, number], { plan: string; ready: number; rolled: number }>("SELECT plan, ready, rolled FROM round_plans WHERE level_id = ? AND token_id = ?").get(levelId, tokenId);
  return { plan: r ? JSON.parse(r.plan) : [], ready: !!r?.ready, rolled: (r?.rolled ?? 0) as 0 | 1 | 2 };
}

/** Sets where a plan's dice are (0 not rolled, 1 rolling, 2 rolled), keeping the plan. */
export function setPlanRolled(levelId: number, tokenId: number, rolled: 0 | 1 | 2, plan?: PlanStep[]): void {
  db.prepare("INSERT INTO round_plans (level_id, token_id, plan, rolled) VALUES (?, ?, ?, ?) ON CONFLICT(level_id, token_id) DO UPDATE SET rolled = excluded.rolled" + (plan ? ", plan = excluded.plan" : "")).run(
    levelId, tokenId, JSON.stringify(plan ?? []), rolled
  );
}

/** Which tokens on the level are rolling their plan's dice right now. */
export function rollingTokens(levelId: number): Set<number> {
  return new Set(db.prepare<[number], { token_id: number }>("SELECT token_id FROM round_plans WHERE level_id = ? AND rolled = 1").all(levelId).map((r) => r.token_id));
}

export function saveRoundPlan(levelId: number, tokenId: number, plan: PlanStep[], ready: boolean): void {
  db.prepare("INSERT INTO round_plans (level_id, token_id, plan, ready) VALUES (?, ?, ?, ?) ON CONFLICT(level_id, token_id) DO UPDATE SET plan = excluded.plan, ready = excluded.ready").run(
    levelId, tokenId, JSON.stringify(plan), ready ? 1 : 0
  );
}

/** Which tokens on the level are ready with their round plan. */
export function readyTokens(levelId: number): Set<number> {
  return new Set(db.prepare<[number], { token_id: number }>("SELECT token_id FROM round_plans WHERE level_id = ? AND ready = 1").all(levelId).map((r) => r.token_id));
}

export function clearRoundPlans(levelId: number): void {
  db.prepare("DELETE FROM round_plans WHERE level_id = ?").run(levelId);
}

/** A token as a mover in an encounter: where it is and its creature's or character's movement (JSON). */
export function getTokenMover(tokenId: number): { token_id: number; level_id: number; col: number; row: number; movement: string } | undefined {
  return db
    .prepare<[number], { token_id: number; level_id: number; col: number; row: number; movement: string }>(
      `SELECT t.id AS token_id, t.level_id, t.col, t.row, COALESCE(ch.movement, cr.movement, '{}') AS movement
       FROM map_tokens t LEFT JOIN characters ch ON ch.id = t.character_id LEFT JOIN creatures cr ON cr.id = t.creature_id WHERE t.id = ?`
    )
    .get(tokenId);
}

export function getLastRoundLog(levelId: number): string[] {
  const row = db.prepare<[number], { last_log: string }>("SELECT last_log FROM encounters WHERE level_id = ?").get(levelId);
  return row ? JSON.parse(row.last_log) : [];
}

export function setLastRoundLog(levelId: number, lines: string[]): void {
  db.prepare<[string, number]>("UPDATE encounters SET last_log = ? WHERE level_id = ?").run(JSON.stringify(lines), levelId);
}

/** Token names on a level, with several of the same name numbered (Human 1, Human 2) so they can be told apart. */
export function tokenLabels(levelId: number): Map<number, string> {
  const tokens = listTokens(levelId);
  const count = new Map<string, number>(), seen = new Map<string, number>();
  for (const t of tokens) count.set(t.name, (count.get(t.name) ?? 0) + 1);
  return new Map(
    tokens.map((t) => {
      const n = (seen.get(t.name) ?? 0) + 1;
      seen.set(t.name, n);
      return [t.id, count.get(t.name)! > 1 ? `${t.name} ${n}` : t.name];
    })
  );
}

export function getReplay(levelId: number): Replay | null {
  const row = db.prepare<[number], { replay: string | null }>("SELECT replay FROM encounters WHERE level_id = ?").get(levelId);
  return row?.replay ? JSON.parse(row.replay) : null;
}

export function setReplay(levelId: number, replay: Replay, log?: string[]): void {
  db.prepare<[string, number]>("UPDATE encounters SET replay = ? WHERE level_id = ?").run(JSON.stringify(replay), levelId);
  // Kept for the rest of the encounter, so players can look back over every round they've had.
  const stories = [...getRoundStories(levelId).filter((r) => r.round !== replay.round), { round: replay.round, showAt: replay.starts + (replay.frames.length + 1) * 1000, story: replay.story ?? [], ...(log ? { log } : {}) }];
  db.prepare<[string, number]>("UPDATE encounters SET stories = ? WHERE level_id = ?").run(JSON.stringify(stories), levelId);
}

/** A resolved round's events (raw: each player is only ever told their own part), and when its playback ends. */
export interface RoundStory {
  round: number;
  showAt: number; // ms since epoch: the playback's end (players hear about it then)
  story: import("@/lib/roundStory").StoryEvent[];
  log?: string[]; // the GM's log of the round, with the numbers (never sent to players)
}

export function getRoundStories(levelId: number): RoundStory[] {
  const row = db.prepare<[number], { stories: string }>("SELECT stories FROM encounters WHERE level_id = ?").get(levelId);
  return row ? JSON.parse(row.stories) : [];
}

// ---------- The GM's map ----------

// The level the GM has loaded in the session (null = follow the party). Players are unaffected.
db.exec("CREATE TABLE IF NOT EXISTS gm_view (id INTEGER PRIMARY KEY CHECK (id = 1), level_id INTEGER)");

export function setGmViewLevel(levelId: number | null): void {
  db.prepare("INSERT OR REPLACE INTO gm_view (id, level_id) VALUES (1, ?)").run(levelId);
}

/** The map the GM is working on: the level they loaded, else the party's. Encounters and the console use it. */
export function getGmLevelId(): number | undefined {
  const loaded = db.prepare<[], { level_id: number | null }>("SELECT m.id AS level_id FROM gm_view g JOIN map_levels m ON m.id = g.level_id").get()?.level_id;
  return loaded ?? getCurrentLevelId();
}

/** Every player's character and where its tokens are (a row per token: location and level), or nowhere yet. */
export function listPlayerPlaces(): { character: string; player: string; player_id: number; level_id: number | null; location: string | null; level: string | null }[] {
  return db
    .prepare<[], { character: string; player: string; player_id: number; level_id: number | null; location: string | null; level: string | null }>(
      `SELECT c.name AS character, u.name AS player, u.id AS player_id, t.level_id, l.name AS location, m.name AS level
       FROM characters c JOIN users u ON u.id = c.player_id
       LEFT JOIN map_tokens t ON t.character_id = c.id LEFT JOIN map_levels m ON m.id = t.level_id LEFT JOIN locations l ON l.id = m.location_id
       ORDER BY u.name, c.name`
    )
    .all();
}

/**
 * Deletes a character and everything that's only about it: its tokens (and their round plans), professions,
 * journal, fog memory, pending rolls and objective assignments. Discoveries it owned lose their owner.
 */
export function deleteCharacter(id: number): void {
  db.transaction(() => {
    const tokens = db.prepare<[number], { id: number }>("SELECT id FROM map_tokens WHERE character_id = ?").all(id).map((t) => t.id);
    for (const t of tokens) db.prepare("DELETE FROM round_plans WHERE token_id = ?").run(t);
    db.prepare("DELETE FROM map_tokens WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM character_professions WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM container_items WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM sightings WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM roll_requests WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM journal_entries WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM objective_characters WHERE character_id = ?").run(id);
    db.prepare("UPDATE discoveries SET character_id = NULL WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM characters WHERE id = ?").run(id);
  })();
}

/** Player names by character id (characters nobody plays are left out). */
export function characterPlayers(): Map<number, string> {
  return new Map(
    db.prepare<[], { id: number; name: string }>("SELECT c.id, u.name FROM characters c JOIN users u ON u.id = c.player_id").all().map((r) => [r.id, r.name])
  );
}

/** Planned targeted steps on a level (who aims what at whom), for drawing on the map; optionally one token's only. */
export type PlanTarget = { from: number; to: number; action: string; label: string; at: { col: number; row: number } | null }; // at: where they'll be (null: where they stand)
export function listPlanTargets(levelId: number, tokenId?: number): PlanTarget[] {
  const rows = db.prepare<[number], { token_id: number; plan: string }>("SELECT token_id, plan FROM round_plans WHERE level_id = ?").all(levelId);
  return rows
    .filter((r) => tokenId === undefined || r.token_id === tokenId)
    .flatMap((r) => {
      // Each aimed step from where the moves before it leave them (so a move, attack, move plan aims from the middle).
      let at: { col: number; row: number } | null = null;
      return (JSON.parse(r.plan) as PlanStep[]).flatMap((s) => {
        if (s.kind === "move") {
          at = s.to;
          return [];
        }
        const label = s.use?.name ?? s.action;
        const to = s.picks?.length ? s.picks.map((p) => p.id) : s.target ? [s.target.id] : [];
        return to.map((id) => ({ from: r.token_id, to: id, action: s.action, label, at }));
      });
    });
}

/** Each plan's moves as a trail of waypoints (in order), for drawing the route it takes. */
export function listPlanRoutes(levelId: number, tokenId?: number): { token: number; points: { col: number; row: number; step?: number }[] }[] {
  const rows = db.prepare<[number], { token_id: number; plan: string }>("SELECT token_id, plan FROM round_plans WHERE level_id = ?").all(levelId);
  return rows
    .filter((r) => tokenId === undefined || r.token_id === tokenId)
    .map((r) => ({ token: r.token_id, points: (JSON.parse(r.plan) as PlanStep[]).flatMap((s, step) => (s.kind === "move" ? [{ ...s.to, step }] : [])) })) // step: which plan step it ends (dragging it changes that move)
    .filter((r) => r.points.length);
}

/** Tokens on a level that are down (health 0 or less): they sit out planning until revived (health above 0). */
export function downTokens(levelId: number): Set<number> {
  return new Set(
    db.prepare<[number], { id: number }>(
      `SELECT t.id FROM map_tokens t LEFT JOIN characters c ON c.id = t.character_id
       WHERE t.level_id = ? AND COALESCE(CASE WHEN t.character_id IS NULL THEN t.hp ELSE c.hp END, 1) <= 0`
    ).all(levelId).map((r) => r.id)
  );
}

// ---------- Containers ----------

// What's in a character's containers (a belt, a pack…): each container they own has its own inventory, kept with
// the container (unequip it and equip it again, and its contents are still there). A stack fills one of the
// container's slots (its capacity), up to the item's max stack.
db.exec(`CREATE TABLE IF NOT EXISTS container_items (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL,
  container_id INTEGER NOT NULL, -- the container item
  item_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
)`);

/** The GM sets a token's side (null: back to its kind's default). */
export function setTokenAllegiance(tokenId: number, allegiance: string | null): void {
  db.prepare("UPDATE map_tokens SET allegiance = ? WHERE id = ?").run(allegiance, tokenId);
}

// ---------- Traps (lib/traps.ts) ----------

// Hazards the GM places on a level, hidden from players until found; `sprung`: the tokens each has sprung on.
db.exec(`CREATE TABLE IF NOT EXISTS map_traps (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  name TEXT NOT NULL DEFAULT 'Trap',
  area TEXT NOT NULL, -- JSON TrapArea
  springs TEXT NOT NULL DEFAULT 'enter', -- enter,start,end
  who TEXT NOT NULL DEFAULT '', -- '' | party | hostile
  often TEXT NOT NULL DEFAULT 'once', -- once | each | always
  damage TEXT,
  damage_type TEXT NOT NULL DEFAULT '',
  save_attr TEXT NOT NULL DEFAULT 'agility',
  save_dc INTEGER NOT NULL DEFAULT 12,
  save_half INTEGER NOT NULL DEFAULT 1,
  effects TEXT NOT NULL DEFAULT '[]', -- JSON catalog effect ids
  stops INTEGER NOT NULL DEFAULT 1,
  find_dc INTEGER NOT NULL DEFAULT 14,
  found INTEGER NOT NULL DEFAULT 0,
  sprung TEXT NOT NULL DEFAULT '[]' -- JSON token ids
)`);

addColumn("map_traps", "seen_by", "TEXT NOT NULL DEFAULT '[]'"); // JSON token ids: who saw it go off (their players see it; others don't)
type TrapRow = Omit<Trap, "area" | "springs" | "effects" | "sprung" | "seen_by"> & { area: string; springs: string; effects: string; sprung: string; seen_by: string };
const parseTrap = (r: TrapRow): Trap => ({ ...r, area: JSON.parse(r.area), springs: r.springs ? areaFires(r.springs) : [] /* none: only a trigger sets it off */, effects: JSON.parse(r.effects), sprung: JSON.parse(r.sprung), seen_by: JSON.parse(r.seen_by ?? "[]") });

/** A level's traps. */
export function listTraps(levelId: number): Trap[] {
  return db.prepare<[number], TrapRow>("SELECT * FROM map_traps WHERE level_id = ? ORDER BY id").all(levelId).map(parseTrap);
}

export function getTrap(id: number): (Trap & { level_id: number }) | undefined {
  const r = db.prepare<[number], TrapRow & { level_id: number }>("SELECT * FROM map_traps WHERE id = ?").get(id);
  return r ? { ...parseTrap(r), level_id: r.level_id } : undefined;
}

/** Places a trap (the rest as the defaults: springs on entering, once, Agility DC 12 for half, stops the mover, DC 14 to find); returns its id. */
export function addTrap(levelId: number, area: TrapArea, name = "Trap"): number {
  return Number(db.prepare("INSERT INTO map_traps (level_id, name, area) VALUES (?, ?, ?)").run(levelId, name, JSON.stringify(area)).lastInsertRowid);
}

/** Saves what a trap does (not where it is, whether it's found, or whom it has sprung on). */
export function saveTrap(id: number, t: Omit<Trap, "id" | "area" | "found" | "sprung">): void {
  db.prepare(`UPDATE map_traps SET name = @name, springs = @springs, who = @who, often = @often, damage = @damage, damage_type = @damage_type,
    save_attr = @save_attr, save_dc = @save_dc, save_half = @save_half, effects = @effects, stops = @stops, find_dc = @find_dc WHERE id = @id`)
    .run({ ...t, springs: t.springs.join(","), effects: JSON.stringify(t.effects), damage: t.damage || null, id });
}

export function moveTrap(id: number, area: TrapArea): void {
  db.prepare("UPDATE map_traps SET area = ? WHERE id = ?").run(JSON.stringify(area), id);
}

export function deleteTrap(id: number): void {
  db.prepare("DELETE FROM map_traps WHERE id = ?").run(id);
}

/** Found (by a Search) or revealed by the GM: players see it; hidden again (false). */
export function setTrapFound(id: number, found: boolean): void {
  db.prepare("UPDATE map_traps SET found = ? WHERE id = ?").run(found ? 1 : 0, id);
}

/** Who saw a trap go off (added to those who already had): their players see it on the map. */
export function trapSeenBy(id: number, tokenIds: number[]): void {
  const t = getTrap(id);
  if (!t) return;
  db.prepare("UPDATE map_traps SET seen_by = ? WHERE id = ?").run(JSON.stringify([...new Set([...(t.seen_by ?? []), ...tokenIds])]), id);
}

/** Records that a trap sprang on a token (spending it, or spending it for them). */
export function markTrapSprung(id: number, tokenId: number): void {
  const t = getTrap(id);
  if (t && !t.sprung.includes(tokenId)) db.prepare("UPDATE map_traps SET sprung = ? WHERE id = ?").run(JSON.stringify([...t.sprung, tokenId]), id);
}

/** Re-arms a trap (whom it has sprung on is forgotten). */
export function resetTrap(id: number): void {
  db.prepare("UPDATE map_traps SET sprung = '[]' WHERE id = ?").run(id);
}

// ---------- Map triggers (lib/triggers.ts) ----------

// Zones that make things happen when someone comes into one (and the like); always hidden from players.
db.exec(`CREATE TABLE IF NOT EXISTS map_triggers (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  name TEXT NOT NULL DEFAULT 'Trigger',
  area TEXT NOT NULL, -- JSON TrapArea
  springs TEXT NOT NULL DEFAULT 'enter', -- enter,start,end
  who TEXT NOT NULL DEFAULT '', -- '' | party | hostile
  often TEXT NOT NULL DEFAULT 'once', -- once | each | always
  outcomes TEXT NOT NULL DEFAULT '[]', -- JSON TriggerOutcome[]
  sprung TEXT NOT NULL DEFAULT '[]' -- JSON token ids
)`);

addColumn("map_triggers", "interact", "INTEGER NOT NULL DEFAULT 0"); // fires when someone within reach Interacts with it
type MapTriggerRow = Omit<MapTrigger, "area" | "springs" | "outcomes" | "sprung" | "interact"> & { area: string; springs: string; outcomes: string; sprung: string; interact: number };
const parseTrigger = (r: MapTriggerRow): MapTrigger => ({ ...r, area: JSON.parse(r.area), springs: areaFires(r.springs), outcomes: JSON.parse(r.outcomes), sprung: JSON.parse(r.sprung), interact: !!r.interact });

/** A level's map triggers. */
export function listMapTriggers(levelId: number): MapTrigger[] {
  return db.prepare<[number], MapTriggerRow>("SELECT * FROM map_triggers WHERE level_id = ? ORDER BY id").all(levelId).map(parseTrigger);
}

export function getMapTrigger(id: number): (MapTrigger & { level_id: number }) | undefined {
  const r = db.prepare<[number], MapTriggerRow & { level_id: number }>("SELECT * FROM map_triggers WHERE id = ?").get(id);
  return r ? { ...parseTrigger(r), level_id: r.level_id } : undefined;
}

/** Places a map trigger (springs on entering, once, doing nothing until it's given outcomes); returns its id. */
export function addMapTrigger(levelId: number, area: TrapArea, name = "Trigger"): number {
  return Number(db.prepare("INSERT INTO map_triggers (level_id, name, area) VALUES (?, ?, ?)").run(levelId, name, JSON.stringify(area)).lastInsertRowid);
}

/** Saves when a map trigger fires, for whom, how often, and what it does. */
export function saveMapTrigger(id: number, t: Omit<MapTrigger, "id" | "area" | "sprung">): void {
  db.prepare("UPDATE map_triggers SET name = @name, springs = @springs, who = @who, often = @often, outcomes = @outcomes, interact = @interact WHERE id = @id")
    .run({ ...t, springs: t.springs.join(","), outcomes: JSON.stringify(t.outcomes), interact: t.interact ? 1 : 0, id });
}

export function deleteMapTrigger(id: number): void {
  db.prepare("DELETE FROM map_triggers WHERE id = ?").run(id);
}

/** Records that a map trigger fired for a token. */
export function markMapTriggerSprung(id: number, tokenId: number): void {
  const t = getMapTrigger(id);
  if (t && !t.sprung.includes(tokenId)) db.prepare("UPDATE map_triggers SET sprung = ? WHERE id = ?").run(JSON.stringify([...t.sprung, tokenId]), id);
}

/** Re-arms a map trigger (whom it has fired for is forgotten). */
export function resetMapTrigger(id: number): void {
  db.prepare("UPDATE map_triggers SET sprung = '[]' WHERE id = ?").run(id);
}

// Last, once every table exists: the retired conditions become effects, and the built-in effects are seeded.
settleEffects();
