import { db, nameUnnamed } from "@/lib/db/connection";
import { DEFAULT_TEMPLATE_COLORS, DEFAULT_GRID, DEFAULT_BACKGROUND, DEFAULT_MAP_IMAGE } from "@/lib/maps";
import type { MapBackground, MapImage, MapGrid, TemplateColors, MapLayer, StructureKind } from "@/lib/maps";

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

export function saveFigureHeight(levelId: number, cells: number): void {
  db.prepare<[number, number]>("UPDATE map_levels SET figure_height = ? WHERE id = ?").run(Math.min(20, Math.max(0.1, cells)), levelId);
}

export function saveHideWalls(levelId: number, hide: boolean): void {
  db.prepare<[number, number]>("UPDATE map_levels SET hide_walls = ? WHERE id = ?").run(hide ? 1 : 0, levelId);
}

export function saveIllumination(levelId: number, illumination: number): void {
  db.prepare<[number, number]>("UPDATE map_levels SET illumination = ? WHERE id = ?").run(Math.min(1, Math.max(0, illumination)), levelId);
}

export function getIllumination(levelId: number): number {
  return db.prepare<[number], { illumination: number }>("SELECT illumination FROM map_levels WHERE id = ?").get(levelId)?.illumination ?? 1;
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

export function setGmViewLevel(levelId: number | null): void {
  db.prepare("INSERT OR REPLACE INTO gm_view (id, level_id) VALUES (1, ?)").run(levelId);
}

/** The map the GM is working on: the level they loaded, else the party's. Encounters and the console use it. */
export function getGmLevelId(): number | undefined {
  const loaded = db.prepare<[], { level_id: number | null }>("SELECT m.id AS level_id FROM gm_view g JOIN map_levels m ON m.id = g.level_id").get()?.level_id;
  return loaded ?? getCurrentLevelId();
}
