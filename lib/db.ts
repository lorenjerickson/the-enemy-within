import type { Affliction, Condition, ConditionDef, EffectDef, Modifier } from "@/lib/conditions";
import type { RollSpec, RolledPart } from "@/lib/rolls";
import type { PlanStep } from "@/lib/roundPlan";
import type { Replay } from "@/lib/resolveRound";
import type { Fx } from "@/lib/vfx";
import type { Status } from "@/lib/status";
import type { TargetCount, TargetWho } from "@/lib/sides";
import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import { CREATURE_TYPES, type CreatureType, type Movement } from "@/lib/creatureTypes";
import type { Attribute, Attributes } from "@/lib/attributes";
import type { AreaShape, LastingArea } from "@/lib/aoe";
import {
  DEFAULT_BACKGROUND, DEFAULT_GRID, DEFAULT_MAP_IMAGE, DEFAULT_TEMPLATE_COLORS,
  type ClipMode, type ControlEdge, type LightKind, type MapBackground, type MapGrid, type MapImage, type MapLayer, type StructureKind, type TemplateColors,
} from "@/lib/maps";
import type { ModifierTarget } from "@/lib/modifiers";
import type { Boost, DamageType, DurationUnit, RollGrant, RollMode } from "@/lib/actions";
import type { EffectKind } from "@/lib/effects";
import { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity } from "@/lib/itemTypes";

// Where the database and uploaded media live: ./data locally, a mounted volume when deployed (DATA_DIR=/data).
export const DATA_DIR = process.env.DATA_DIR ?? "data";
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(`${DATA_DIR}/game.db`);
// Several processes may open it at once (the production build collects pages with parallel workers): wait for each
// other rather than failing with "database is locked".
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    contact TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS creatures (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS professions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS profession_modifiers (
    id INTEGER PRIMARY KEY,
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    target TEXT NOT NULL, -- ModifierTarget, e.g. "attribute:might", "skill:stealth", "health"
    value TEXT NOT NULL   -- signed number or dice expression, e.g. "+1", "-2", "1d4"
  );
  CREATE TABLE IF NOT EXISTS profession_items (
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    PRIMARY KEY (profession_id, item_id)
  );
  -- A character is a single-instance creature: a copy of a creature template that can then be changed freely.
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    creature_id INTEGER REFERENCES creatures(id), -- template it was based on
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT,
    type TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    equipment TEXT NOT NULL DEFAULT '{}',
    health TEXT NOT NULL,
    movement TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS character_professions (
    character_id INTEGER NOT NULL REFERENCES characters(id),
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    PRIMARY KEY (character_id, profession_id)
  );
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES locations(id), -- null = top level
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );
  -- A location's map has one or more levels (floors), each with its own layer stack.
  CREATE TABLE IF NOT EXISTS map_levels (
    id INTEGER PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES locations(id),
    name TEXT NOT NULL,
    background TEXT -- JSON MapBackground
  );
  -- Layers the GM has hidden on a level (all layers are visible by default).
  CREATE TABLE IF NOT EXISTS level_hidden_layers (
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    layer TEXT NOT NULL, -- MapLayer
    PRIMARY KEY (level_id, layer)
  );
  -- Tiles placed on a level: an asset covering a rectangle of grid cells.
  CREATE TABLE IF NOT EXISTS map_tiles (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    col INTEGER NOT NULL,
    row INTEGER NOT NULL,
    cols INTEGER NOT NULL DEFAULT 1,
    rows INTEGER NOT NULL DEFAULT 1
  );
  -- Structure on a level. Lines (wall/door/window) run between grid corners (x1,y1)-(x2,y2);
  -- a staircase occupies cell (x1,y1) and leads to target_level_id.
  CREATE TABLE IF NOT EXISTS map_structures (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    kind TEXT NOT NULL, -- StructureKind
    x1 INTEGER NOT NULL,
    y1 INTEGER NOT NULL,
    x2 INTEGER NOT NULL,
    y2 INTEGER NOT NULL,
    target_level_id INTEGER REFERENCES map_levels(id)
  );
  -- Tokens on a level: a creature (initial placement by the GM) or a character, in a grid cell.
  CREATE TABLE IF NOT EXISTS map_tokens (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    creature_id INTEGER REFERENCES creatures(id),
    character_id INTEGER REFERENCES characters(id),
    col INTEGER NOT NULL,
    row INTEGER NOT NULL
  );
  -- Ambient sounds on a level: a named playlist of audio clips. Only one plays at a time.
  CREATE TABLE IF NOT EXISTS ambient_sounds (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ambient_clips (
    id INTEGER PRIMARY KEY,
    sound_id INTEGER NOT NULL REFERENCES ambient_sounds(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    mode TEXT NOT NULL DEFAULT 'loop' -- ClipMode
  );
  -- Positional sounds on a level: an audio asset at a grid position (cell units) heard within a radius (cells).
  CREATE TABLE IF NOT EXISTS positional_sounds (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    radius REAL NOT NULL DEFAULT 3
  );
  -- Light sources on a level, at a grid position (cell units). Directional lights shine a cone
  -- of spread degrees towards angle degrees (0 = east, 90 = south).
  CREATE TABLE IF NOT EXISTS light_sources (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    kind TEXT NOT NULL, -- LightKind
    x REAL NOT NULL,
    y REAL NOT NULL,
    radius REAL NOT NULL DEFAULT 4,
    angle REAL NOT NULL DEFAULT 0,
    spread REAL NOT NULL DEFAULT 60,
    flicker INTEGER NOT NULL DEFAULT 0
  );
  -- GM-only sticky notes on a level; (x, y) is the note's top-left in grid units.
  CREATE TABLE IF NOT EXISTS map_notes (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    text TEXT NOT NULL
  );
  -- GM control buttons along an edge of a level's scene, in the order added.
  CREATE TABLE IF NOT EXISTS map_controls (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    edge TEXT NOT NULL, -- ControlEdge
    label TEXT NOT NULL
  );
  -- Reusable media for maps, e.g. tile images.
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- AssetType, e.g. 'image'
    usage TEXT NOT NULL, -- AssetUsage, e.g. 'tile'
    url TEXT NOT NULL
  );
  -- An action belongs to exactly one owner: a profession or an item.
  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY,
    profession_id INTEGER REFERENCES professions(id),
    item_id INTEGER REFERENCES items(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    roll TEXT NOT NULL DEFAULT 'normal', -- RollMode for the to-hit roll
    attack TEXT,                         -- to-hit modifier, signed number or dice
    damage TEXT,                         -- damage dice
    damage_type TEXT NOT NULL DEFAULT '', -- DamageType, '' when no damage
    radius REAL NOT NULL DEFAULT 0,      -- metres around the actor; 0 = single target
    split INTEGER NOT NULL DEFAULT 0     -- 1 = damage divided evenly across everyone in the radius
  );
  -- from_id advances to to_id; to_id's prerequisites are all its from_ids.
  CREATE TABLE IF NOT EXISTS profession_advancements (
    from_id INTEGER NOT NULL REFERENCES professions(id),
    to_id INTEGER NOT NULL REFERENCES professions(id),
    PRIMARY KEY (from_id, to_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id)
  );
`);

/** Gives new (or old, unnamed) lights, effects and doors a default name such as "Light 3" or "Fire 7". */
function nameUnnamed(): void {
  const has = (table: string, column: string) =>
    db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (has("light_sources", "name")) db.exec("UPDATE light_sources SET name = 'Light ' || id WHERE name IS NULL OR name = ''");
  if (has("map_effects", "name"))
    db.exec("UPDATE map_effects SET name = upper(substr(kind, 1, 1)) || substr(kind, 2) || ' ' || id WHERE name IS NULL OR name = ''");
  if (has("map_structures", "name")) db.exec("UPDATE map_structures SET name = 'Door ' || id WHERE kind = 'door' AND (name IS NULL OR name = '')");
}

// Add columns introduced after a database was first created.
export function addColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    // Another process (a parallel build worker) added it between the check and now: fine.
    if (!(e instanceof Error && /duplicate column name/i.test(e.message))) throw e;
  }
}
addColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
addColumn("items", "type", "TEXT NOT NULL DEFAULT 'utility'");
addColumn("items", "weight", "REAL NOT NULL DEFAULT 0");
addColumn("items", "value", "INTEGER NOT NULL DEFAULT 0");
addColumn("items", "rarity", "TEXT NOT NULL DEFAULT ''");
addColumn("items", "durability", "INTEGER NOT NULL DEFAULT 0");
addColumn("items", "defense", "TEXT");
addColumn("items", "damage", "TEXT");
addColumn("items", "attack", "TEXT");
addColumn("items", "max_stack", "INTEGER");
addColumn("items", "capacity", "INTEGER");
addColumn("creatures", "type", "TEXT NOT NULL DEFAULT 'beast'");
addColumn("creatures", "attributes", "TEXT NOT NULL DEFAULT '{}'"); // JSON Attributes
addColumn("creatures", "equipment", "TEXT NOT NULL DEFAULT '{}'"); // JSON Equipment
addColumn("creatures", "health", "TEXT NOT NULL DEFAULT '1d8'"); // dice formula for initial health
addColumn("creatures", "movement", "TEXT NOT NULL DEFAULT '{}'"); // JSON Movement
addColumn("actions", "creature_id", "INTEGER REFERENCES creatures(id)");
addColumn("actions", "boosts", "TEXT NOT NULL DEFAULT '[]'"); // JSON Boost[]
addColumn("actions", "duration_amount", "INTEGER NOT NULL DEFAULT 1");
addColumn("actions", "duration_unit", "TEXT NOT NULL DEFAULT ''"); // DurationUnit, '' = instant
addColumn("map_levels", "position", "REAL NOT NULL DEFAULT 0"); // higher = further up
db.exec("UPDATE map_levels SET position = id WHERE position = 0");
addColumn("map_levels", "map_image", "TEXT"); // JSON MapImage
addColumn("map_levels", "grid", "TEXT"); // JSON MapGrid
addColumn("map_levels", "template_colors", "TEXT"); // JSON TemplateColors
addColumn("map_structures", "open", "INTEGER NOT NULL DEFAULT 0"); // doors only: 1 = open
addColumn("map_notes", "w", "REAL NOT NULL DEFAULT 1.6"); // size in grid cells
addColumn("map_notes", "h", "REAL NOT NULL DEFAULT 1.6"); // minimum height; grows to fit text
addColumn("map_controls", "icon", "TEXT NOT NULL DEFAULT 'GiClick'"); // react-icons Game Icons name
addColumn("map_controls", "script", "TEXT NOT NULL DEFAULT ''"); // game script run when the button is clicked
addColumn("creatures", "token_overhead", "TEXT"); // token art seen from above (overhead maps)
addColumn("creatures", "token_side", "TEXT"); // token art seen side-on (portrait maps)
addColumn("characters", "token_overhead", "TEXT");
addColumn("characters", "token_side", "TEXT");
addColumn("map_tokens", "hp", "INTEGER");
addColumn("characters", "in_party", "INTEGER NOT NULL DEFAULT 0"); // 1 = a player character (game.characters.party)
addColumn("characters", "player_id", "INTEGER REFERENCES users(id)"); // the player who plays it (sees its journal)
// Game time, in minutes since the campaign began, moved forward by the GM; and named timers measured against it.
db.exec(`CREATE TABLE IF NOT EXISTS calendar (id INTEGER PRIMARY KEY CHECK (id = 1), now REAL NOT NULL DEFAULT 0)`);
db.exec("INSERT OR IGNORE INTO calendar (id, now) VALUES (1, 0)");
db.exec(`CREATE TABLE IF NOT EXISTS timers (name TEXT PRIMARY KEY, started REAL NOT NULL)`);
addColumn("timers", "duration", "REAL"); // minutes until it expires; null = never
// ON … THEN triggers made by scripts: checked whenever game state changes, run once when the condition holds.
db.exec(`CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY,
  prelude TEXT NOT NULL DEFAULT '[]',
  condition TEXT NOT NULL,
  action TEXT NOT NULL,
  level_id INTEGER,
  created REAL NOT NULL,
  fired REAL,
  error TEXT
)`);
addColumn("triggers", "watches", "TEXT NOT NULL DEFAULT '{}'"); // JSON: watched WITH names -> value at the last check
addColumn("triggers", "last", "INTEGER NOT NULL DEFAULT 0"); // 1 = the condition held at the last check
// Animated effects on a level, drawn in the order added. No position = covers the whole map.
db.exec(`CREATE TABLE IF NOT EXISTS map_effects (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  kind TEXT NOT NULL,
  x REAL,
  y REAL,
  radius REAL,
  intensity REAL NOT NULL DEFAULT 0.5
)`);
addColumn("light_sources", "name", "TEXT"); // scripts refer to lights, effects and doors by name
addColumn("light_sources", "enabled", "INTEGER NOT NULL DEFAULT 1"); // 0 = switched off
addColumn("map_effects", "name", "TEXT");
addColumn("map_effects", "enabled", "INTEGER NOT NULL DEFAULT 1");
addColumn("map_structures", "name", "TEXT"); // doors only
nameUnnamed();
addColumn("map_effects", "w", "REAL"); // a placed effect's area: (x, y) top-left, w × h cells
addColumn("map_effects", "h", "REAL");
// Effects placed as circles (centre + radius) before areas existed become the square around the circle.
db.exec("UPDATE map_effects SET x = x - radius, y = y - radius, w = 2 * radius, h = 2 * radius WHERE radius IS NOT NULL AND w IS NULL");
addColumn("positional_sounds", "loop", "INTEGER NOT NULL DEFAULT 0"); // 1 = plays on a loop
addColumn("creatures", "height", "REAL NOT NULL DEFAULT 1.8"); // metres, for side-on tokens
addColumn("characters", "height", "REAL NOT NULL DEFAULT 1.8");
addColumn("map_levels", "figure_height", "REAL NOT NULL DEFAULT 1"); // portrait maps: grid cells a 1.8 m figure stands // a creature token's current health; null until first rolled
addColumn("map_levels", "illumination", "REAL NOT NULL DEFAULT 1"); // global light, 0 = dark .. 1 = full
addColumn("ambient_sounds", "volume", "REAL NOT NULL DEFAULT 1"); // 0..1
addColumn("positional_sounds", "volume", "REAL NOT NULL DEFAULT 1"); // 0..1
db.exec("UPDATE level_hidden_layers SET layer = 'structure' WHERE layer = 'walls'"); // layer renamed
addColumn("actions", "roll_grants", "TEXT NOT NULL DEFAULT '[]'"); // JSON RollGrant[]
addColumn("actions", "seconds", "REAL NOT NULL DEFAULT 2"); // time it takes in a combat round
addColumn("actions", "range_ft", "REAL NOT NULL DEFAULT 5"); // how far the target may be (5 = within reach)
addColumn("actions", "area_shape", "TEXT NOT NULL DEFAULT ''"); // AreaShape, '' = single target
addColumn("actions", "area_ft", "REAL NOT NULL DEFAULT 0"); // circle radius, or cone / line length
addColumn("actions", "save_dc", "INTEGER NOT NULL DEFAULT 12"); // an area's save
addColumn("actions", "save_attr", "TEXT NOT NULL DEFAULT 'agility'");
addColumn("actions", "save_half", "INTEGER NOT NULL DEFAULT 1"); // 1 = a successful save takes half damage, 0 = none
addColumn("actions", "area_lasts", "INTEGER NOT NULL DEFAULT 0"); // 1 = the area stays on the map for the duration
addColumn("actions", "targets", "TEXT NOT NULL DEFAULT ''");
addColumn("actions", "target_who", "TEXT NOT NULL DEFAULT ''"); // TargetWho: '' anyone, friendly, enemy
addColumn("actions", "target_count", "TEXT NOT NULL DEFAULT 'one'"); // TargetCount: one, exactly, upto, all
addColumn("actions", "target_n", "INTEGER NOT NULL DEFAULT 1"); // N for exactly / up to N
addColumn("actions", "effects", "TEXT NOT NULL DEFAULT '[]'"); // the first version's catalog effects (now conditions: see the migration below)
addColumn("actions", "conditions", "TEXT NOT NULL DEFAULT '[]'"); // JSON [{ id, on }]: catalog conditions it puts on its user / target
addColumn("map_tokens", "allegiance", "TEXT"); // Allegiance (party, hostile, neutral); null = by kind (characters party, creatures hostile) // ActionTargets: who it can be used on; '' = worked out from what it does
addColumn("items", "slots", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of EquipSlot
addColumn("items", "range_ft", "REAL NOT NULL DEFAULT 5"); // weapons: how far they reach (5 = melee)
addColumn("items", "hands", "INTEGER NOT NULL DEFAULT 0"); // held in 0 (not held), 1 or 2 hands
addColumn("items", "effects", "TEXT NOT NULL DEFAULT '[]'"); // JSON effect ids: on whoever has it equipped (fire resistance, +1 defense)
addColumn("creatures", "effects", "TEXT NOT NULL DEFAULT '[]'"); // JSON effect ids: always on the creature (immune to poison)
addColumn("characters", "hp", "INTEGER"); // current health; null until first rolled from the health formula
addColumn("characters", "hp_max", "INTEGER"); // maximum health, rolled once from the formula
addColumn("characters", "hp_temp", "INTEGER"); // temporary health, lost before current
addColumn("map_tokens", "hp_max", "INTEGER");
addColumn("map_tokens", "target", "INTEGER"); // the token it has selected as its target (kept from round to round)
addColumn("map_tokens", "hp_temp", "INTEGER");
addColumn("map_tokens", "equipment", "TEXT"); // a creature token's own equipment once refitted (JSON); null = its template's
addColumn("characters", "conditions", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of condition names
db.exec("CREATE TABLE IF NOT EXISTS game_vars (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); // script variables, JSON values
// The running encounter on a map level; turn_order is JSON [{ token_id, initiative }], highest first.
db.exec(`CREATE TABLE IF NOT EXISTS encounters (
  level_id INTEGER PRIMARY KEY REFERENCES map_levels(id),
  round INTEGER NOT NULL,
  turn INTEGER NOT NULL,
  turn_order TEXT NOT NULL
)`);

addColumn("map_structures", "locked", "INTEGER NOT NULL DEFAULT 0"); // doors: 1 = locked (only the GM or a successful pick lock opens it)
addColumn("map_structures", "lock_dc", "INTEGER NOT NULL DEFAULT 15"); // doors: what a pick lock roll must reach
addColumn("encounters", "replay", "TEXT"); // JSON Replay of the last resolved round (lib/resolveRound.ts)
addColumn("encounters", "last_log", "TEXT NOT NULL DEFAULT '[]'"); // JSON lines: what happened in the last resolved round
addColumn("encounters", "waiting", "TEXT NOT NULL DEFAULT '[]'"); // JSON token ids still to roll initiative (players)
addColumn("encounters", "pending", "TEXT");
addColumn("encounters", "stories", "TEXT NOT NULL DEFAULT '[]'"); // JSON RoundStory[]: every resolved round's events (players' accounts of earlier rounds) // JSON PendingRound: a round being resolved, waiting on the GM's call on a contested move
addColumn("map_tokens", "moved", "REAL NOT NULL DEFAULT 0"); // feet moved this turn (counts against the creature's speed)
addColumn("map_levels", "hide_walls", "INTEGER NOT NULL DEFAULT 0"); // 1 = the GM has hidden wall lines (they still act as walls)
// Where the party starts the campaign: an area (x, y top-left, w × h cells) on one map level.
db.exec(`CREATE TABLE IF NOT EXISTS party_start (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL
)`);

// One-time migration: the old per-profession "ranks" tree becomes linked professions.
const hasRanks = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ranks'").get();
if (hasRanks) {
  db.transaction(() => {
    type OldRank = { id: number; profession_id: number; parent_id: number | null; name: string; description: string };
    const ranks = db.prepare<[], OldRank>("SELECT * FROM ranks ORDER BY id").all();
    const newId = new Map<number, number>();
    for (const r of ranks) {
      const id = Number(db.prepare("INSERT INTO professions (name, description) VALUES (?, ?)").run(r.name, r.description).lastInsertRowid);
      newId.set(r.id, id);
      const from = r.parent_id === null ? r.profession_id : newId.get(r.parent_id)!;
      db.prepare("INSERT INTO profession_advancements (from_id, to_id) VALUES (?, ?)").run(from, id);
    }
    db.exec("DROP TABLE ranks");
  })();
}

// One-time migration: profession_actions became the shared actions table.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'profession_actions'").get()) {
  db.exec(`
    INSERT INTO actions (id, profession_id, name, description, roll, attack, damage, damage_type, radius, split)
      SELECT id, profession_id, name, description, roll, attack, damage, damage_type, radius, split FROM profession_actions;
    DROP TABLE profession_actions;
  `);
}

// One-time migration: per-location map settings became the location's first level.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'location_hidden_layers'").get()) {
  db.transaction(() => {
    const hasBackground = db.prepare<[], { name: string }>("PRAGMA table_info(locations)").all().some((c) => c.name === "background");
    const locations = db.prepare<[], { id: number; background: string | null }>(
      `SELECT id, ${hasBackground ? "background" : "NULL AS background"} FROM locations`
    ).all();
    for (const l of locations) {
      const levelId = Number(
        db.prepare("INSERT INTO map_levels (location_id, name, background) VALUES (?, 'Ground', ?)").run(l.id, l.background).lastInsertRowid
      );
      db.prepare("INSERT INTO level_hidden_layers (level_id, layer) SELECT ?, layer FROM location_hidden_layers WHERE location_id = ?").run(levelId, l.id);
    }
    db.exec("DROP TABLE location_hidden_layers");
  })();
}

// File images that existed before the asset library into it (idempotent: skips URLs already present).
db.exec(`
  INSERT INTO assets (name, type, usage, url)
    SELECT name, 'image', 'item', image FROM items WHERE image IS NOT NULL
    UNION ALL SELECT name, 'image', 'creature', image FROM creatures WHERE image IS NOT NULL
    UNION ALL SELECT name, 'image', 'creature', image FROM characters WHERE image IS NOT NULL
    UNION ALL SELECT name || ' background', 'image', 'background', json_extract(background, '$.image') FROM map_levels
      WHERE json_extract(background, '$.image') IS NOT NULL
    UNION ALL SELECT name || ' map', 'image', 'map', json_extract(map_image, '$.image') FROM map_levels
      WHERE json_extract(map_image, '$.image') IS NOT NULL;
  DELETE FROM assets WHERE id NOT IN (SELECT MIN(id) FROM assets GROUP BY url);
`);

export default db;

export const USER_COLUMNS = "id, name, username, contact, role, must_change_password";

export type Role = "gm" | "player";

export interface User {
  id: number;
  name: string;
  username: string;
  contact: string | null;
  role: Role;
  must_change_password: 0 | 1;
  playedBy?: number; // set when the GM is playing this (absent) player: the GM's user id
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function getGm(): User | undefined {
  return db
    .prepare<[], User>(`SELECT ${USER_COLUMNS} FROM users WHERE role = 'gm'`)
    .get();
}

export function createUser(u: Omit<User, "id" | "must_change_password">, password: string): void {
  // Players get a temporary password and must change it on first login.
  db.prepare<[string, string, string | null, string, Role, number]>(
    "INSERT INTO users (name, username, contact, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(u.name, u.username, u.contact, hashPassword(password), u.role, u.role === "player" ? 1 : 0);
}

export function changePassword(userId: number, password: string): void {
  db.prepare<[string, number]>(
    "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?"
  ).run(hashPassword(password), userId);
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

export function getPlayer(id: number): User | undefined {
  return db.prepare<[number], User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND role = 'player'`).get(id);
}

/** Players log in with their name, so username follows name. */
export function updatePlayer(id: number, name: string, contact: string): void {
  db.prepare<[string, string, string, number]>(
    "UPDATE users SET name = ?, username = ?, contact = ? WHERE id = ? AND role = 'player'"
  ).run(name, name, contact, id);
}

/** Deletes a player's account (never the GM's): their logins and presence go too; characters they played lose their player. */
export function deletePlayer(id: number): void {
  db.transaction(() => {
    if (!db.prepare<[number], { id: number }>("SELECT id FROM users WHERE id = ? AND role = 'player'").get(id)) return;
    db.prepare<[number]>("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare<[number]>("DELETE FROM session_presence WHERE user_id = ?").run(id);
    db.prepare<[number]>("UPDATE characters SET player_id = NULL WHERE player_id = ?").run(id);
    db.prepare<[number]>("DELETE FROM users WHERE id = ?").run(id);
  })();
}

export function listPlayers(): User[] {
  return db
    .prepare<[], User>(`SELECT ${USER_COLUMNS} FROM users WHERE role = 'player' ORDER BY name`)
    .all();
}

export { CREATURE_TYPES, type CreatureType };
export { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity };

export interface Item {
  id: number;
  name: string;
  description: string;
  image: string | null;
  type: ItemType;
  weight: number; // kg
  value: number;
  rarity: Rarity;
  durability: number; // 1-100
  defense: string | null; // dice formula, armor only
  damage: string | null; // dice formula, weapons only
  attack: string | null; // to-hit modifier (dice or flat), weapons only
  max_stack: number | null; // consumables only; 1 = not stackable
  capacity: number | null; // containers only; number of item slots (a stack fills one slot)
  slots: EquipSlot[]; // slots this item can be equipped in; empty = not equippable
  range_ft: number; // weapons: effective range (5 = melee reach)
  hands: 0 | 1 | 2; // held in one hand, both hands, or not held
}

const ITEM_COLUMNS = "id, name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots, range_ft, hands";

type ItemRow = Omit<Item, "slots"> & { slots: string };

const parseItem = (row: ItemRow): Item => ({ ...row, slots: JSON.parse(row.slots) });

export function listItems(): Item[] {
  return db.prepare<[], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY name`).all().map(parseItem);
}

export function getItem(id: number): Item | undefined {
  const row = db.prepare<[number], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).get(id);
  return row && parseItem(row);
}

/** Inserts when id is null, otherwise updates. */
export function saveItem(id: number | null, item: Omit<Item, "id">): void {
  const params = { ...item, slots: JSON.stringify(item.slots) };
  if (id === null) {
    db.prepare<Omit<ItemRow, "id">>(
      `INSERT INTO items (name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots, range_ft, hands)
       VALUES (@name, @description, @image, @type, @weight, @value, @rarity, @durability, @defense, @damage, @attack, @max_stack, @capacity, @slots, @range_ft, @hands)`
    ).run(params);
  } else {
    db.prepare<ItemRow>(
      `UPDATE items SET name = @name, description = @description, image = @image, type = @type, weight = @weight,
         value = @value, rarity = @rarity, durability = @durability, defense = @defense, damage = @damage,
         attack = @attack, max_stack = @max_stack, capacity = @capacity, slots = @slots, range_ft = @range_ft, hands = @hands
       WHERE id = @id`
    ).run({ ...params, id });
  }
}

export interface Creature {
  id: number;
  name: string;
  description: string;
  image: string | null; // portrait: an artistic rendering, not a token
  token_overhead: string | null; // map token seen from above
  token_side: string | null; // map token seen side-on (portrait maps)
  height: number; // metres; sizes side-on tokens
  type: CreatureType;
  attributes: Attributes;
  equipment: Equipment;
  health: string; // dice formula rolled for initial health
  movement: Movement;
}

/** Enabled equipment slots; each holds an item id, or null when empty. */
export type Equipment = Partial<Record<EquipSlot, number | null>>;

type CreatureRow = Omit<Creature, "attributes" | "equipment" | "movement"> & {
  attributes: string;
  equipment: string;
  movement: string;
};

const CREATURE_COLUMNS = "id, name, description, image, token_overhead, token_side, height, type, attributes, equipment, health, movement";

const parseCreature = (row: CreatureRow): Creature => ({
  ...row,
  attributes: JSON.parse(row.attributes),
  equipment: JSON.parse(row.equipment),
  movement: JSON.parse(row.movement),
});

export function listCreatures(): Creature[] {
  return db.prepare<[], CreatureRow>(`SELECT ${CREATURE_COLUMNS} FROM creatures ORDER BY name`).all().map(parseCreature);
}

export function getCreature(id: number): Creature | undefined {
  const row = db.prepare<[number], CreatureRow>(`SELECT ${CREATURE_COLUMNS} FROM creatures WHERE id = ?`).get(id);
  return row && parseCreature(row);
}

const toParams = (c: Omit<Creature, "id">) => ({
  ...c,
  attributes: JSON.stringify(c.attributes),
  equipment: JSON.stringify(c.equipment),
  movement: JSON.stringify(c.movement),
});

/** Inserts when id is null, otherwise updates. */
export function saveCreature(id: number | null, c: Omit<Creature, "id">): void {
  const params = toParams(c);
  if (id === null) {
    db.prepare<Omit<CreatureRow, "id">>(
      `INSERT INTO creatures (name, description, image, token_overhead, token_side, height, type, attributes, equipment, health, movement)
       VALUES (@name, @description, @image, @token_overhead, @token_side, @height, @type, @attributes, @equipment, @health, @movement)`
    ).run(params);
  } else {
    db.prepare<CreatureRow>(
      `UPDATE creatures SET name = @name, description = @description, image = @image, token_overhead = @token_overhead,
         token_side = @token_side, height = @height, type = @type,
         attributes = @attributes, equipment = @equipment, health = @health, movement = @movement WHERE id = @id`
    ).run({ ...params, id });
  }
}

/** A single-instance creature, copied from a creature template. */
export type Character = Creature & { creature_id: number | null; template_name: string | null };

const CHARACTER_SELECT = `SELECT c.id, c.creature_id, t.name AS template_name, c.name, c.description, c.image,
  c.token_overhead, c.token_side, c.height, c.type,
  c.attributes, c.equipment, c.health, c.movement FROM characters c LEFT JOIN creatures t ON t.id = c.creature_id`;

type CharacterRow = CreatureRow & { creature_id: number | null; template_name: string | null };

export function listCharacters(): Character[] {
  return db.prepare<[], CharacterRow>(`${CHARACTER_SELECT} ORDER BY c.name`).all().map((r) => ({ ...r, ...parseCreature(r) }));
}

export function getCharacter(id: number): Character | undefined {
  const row = db.prepare<[number], CharacterRow>(`${CHARACTER_SELECT} WHERE c.id = ?`).get(id);
  return row && { ...row, ...parseCreature(row) };
}

/** Inserts (based on creatureId) when id is null, otherwise updates. Returns the id. */
export function saveCharacter(id: number | null, creatureId: number | null, c: Omit<Creature, "id">): number {
  const params = toParams(c);
  if (id === null) {
    return Number(
      db.prepare<Omit<CreatureRow, "id"> & { creature_id: number | null }>(
        `INSERT INTO characters (creature_id, name, description, image, token_overhead, token_side, height, type, attributes, equipment, health, movement)
         VALUES (@creature_id, @name, @description, @image, @token_overhead, @token_side, @height, @type, @attributes, @equipment, @health, @movement)`
      ).run({ ...params, creature_id: creatureId }).lastInsertRowid
    );
  } else {
    db.prepare<CreatureRow>(
      `UPDATE characters SET name = @name, description = @description, image = @image, token_overhead = @token_overhead,
         token_side = @token_side, height = @height, type = @type,
         attributes = @attributes, equipment = @equipment, health = @health, movement = @movement WHERE id = @id`
    ).run({ ...params, id });
    return id;
  }
}

export function listCharacterProfessionIds(characterId: number): number[] {
  return db
    .prepare<[number], { profession_id: number }>("SELECT profession_id FROM character_professions WHERE character_id = ?")
    .all(characterId)
    .map((r) => r.profession_id);
}

export function setCharacterProfessions(characterId: number, professionIds: number[]): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM character_professions WHERE character_id = ?").run(characterId);
    const insert = db.prepare<[number, number]>("INSERT INTO character_professions (character_id, profession_id) VALUES (?, ?)");
    for (const pid of professionIds) insert.run(characterId, pid);
  })();
}

export interface Profession {
  id: number;
  name: string;
  description: string;
}

export function listProfessions(): Profession[] {
  return db.prepare<[], Profession>("SELECT id, name, description FROM professions ORDER BY name").all();
}

export function getProfession(id: number): Profession | undefined {
  return db.prepare<[number], Profession>("SELECT id, name, description FROM professions WHERE id = ?").get(id);
}

/** Inserts when id is null, otherwise updates. Returns the id. */
export function saveProfession(id: number | null, p: Omit<Profession, "id">): number {
  if (id === null) {
    return Number(db.prepare<Omit<Profession, "id">>("INSERT INTO professions (name, description) VALUES (@name, @description)").run(p).lastInsertRowid);
  }
  db.prepare<Profession>("UPDATE professions SET name = @name, description = @description WHERE id = @id").run({ ...p, id });
  return id;
}

/** Professions this one advances to (its next-level advancements). */
export function listAdvancements(professionId: number): Profession[] {
  return db
    .prepare<[number], Profession>(
      `SELECT p.id, p.name, p.description FROM profession_advancements a
       JOIN professions p ON p.id = a.to_id WHERE a.from_id = ? ORDER BY p.name`
    )
    .all(professionId);
}

/** Professions that advance to this one. */
export function listPrerequisites(professionId: number): Profession[] {
  return db
    .prepare<[number], Profession>(
      `SELECT p.id, p.name, p.description FROM profession_advancements a
       JOIN professions p ON p.id = a.from_id WHERE a.to_id = ? ORDER BY p.name`
    )
    .all(professionId);
}

export function linkAdvancement(fromId: number, toId: number): void {
  if (fromId === toId) return;
  db.prepare<[number, number]>("INSERT OR IGNORE INTO profession_advancements (from_id, to_id) VALUES (?, ?)").run(fromId, toId);
}

export function unlinkAdvancement(fromId: number, toId: number): void {
  db.prepare<[number, number]>("DELETE FROM profession_advancements WHERE from_id = ? AND to_id = ?").run(fromId, toId);
}

export interface ProfessionModifier {
  id: number;
  profession_id: number;
  target: ModifierTarget;
  value: string;
}

export function listProfessionModifiers(professionId: number): ProfessionModifier[] {
  return db
    .prepare<[number], ProfessionModifier>("SELECT id, profession_id, target, value FROM profession_modifiers WHERE profession_id = ? ORDER BY id")
    .all(professionId);
}

export function addProfessionModifier(m: Omit<ProfessionModifier, "id">): void {
  db.prepare<Omit<ProfessionModifier, "id">>(
    "INSERT INTO profession_modifiers (profession_id, target, value) VALUES (@profession_id, @target, @value)"
  ).run(m);
}

export function removeProfessionModifier(id: number): void {
  db.prepare<[number]>("DELETE FROM profession_modifiers WHERE id = ?").run(id);
}

/** Items handed to whoever takes this profession. */
export function listProfessionItems(professionId: number): Item[] {
  return db
    .prepare<[number], ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM items WHERE id IN (SELECT item_id FROM profession_items WHERE profession_id = ?) ORDER BY name`
    )
    .all(professionId)
    .map(parseItem);
}

export function grantItem(professionId: number, itemId: number): void {
  db.prepare<[number, number]>("INSERT OR IGNORE INTO profession_items (profession_id, item_id) VALUES (?, ?)").run(professionId, itemId);
}

export function revokeItem(professionId: number, itemId: number): void {
  db.prepare<[number, number]>("DELETE FROM profession_items WHERE profession_id = ? AND item_id = ?").run(professionId, itemId);
}

export type ActionOwnerColumn = "profession_id" | "item_id" | "creature_id";
/** Who grants an action: exactly one of { profession_id }, { item_id } or { creature_id }. */
export type ActionOwner = { [K in ActionOwnerColumn]: Record<K, number> }[ActionOwnerColumn];
export const ownerOf = (owner: ActionOwner) => Object.entries(owner)[0] as [ActionOwnerColumn, number];

/** A declared intent granted by a profession, item or creature, with its own roll bonuses/penalties. */
export interface Action extends Record<ActionOwnerColumn, number | null> {
  id: number;
  name: string;
  description: string;
  roll: RollMode;
  attack: string | null;
  damage: string | null;
  damage_type: DamageType | "";
  radius: number;
  split: 0 | 1;
  boosts: Boost[];
  roll_grants: RollGrant[];
  duration_amount: number;
  duration_unit: DurationUnit;
  seconds: number; // time it takes in a combat round
  range_ft: number; // how far away its target may be (5 = within reach)
  area_shape: AreaShape | ""; // an area attack (everyone caught rolls a save); '' = single target
  area_ft: number;
  save_dc: number;
  save_attr: Attribute;
  save_half: 0 | 1;
  area_lasts: 0 | 1; // the area stays on the map for the action's duration
  target_who: TargetWho; // only friendlies / enemies ("" = anyone)
  target_count: TargetCount; // one, exactly N, up to N, or all
  target_n: number;
  targets: ActionTargets; // who it can be used on ('' = worked out: damage or effects on a target → others, else self)
  conditions: { id: number; on: "self" | "target" }[]; // catalog conditions it puts on its user / its target (on a hit, or a failed save)
}

/** Who an action can be used on: only its user, anyone but its user, or either; '' = worked out from what it does. */
export type ActionTargets = "" | "self" | "others" | "anyone";
export const ACTION_TARGETS = ["", "self", "others", "anyone"] as const;

type ActionFields = Omit<Action, "id" | ActionOwnerColumn>;
type ActionRow = Omit<Action, "boosts" | "roll_grants" | "conditions"> & { boosts: string; roll_grants: string; conditions: string };

const ACTION_COLUMNS =
  "id, profession_id, item_id, creature_id, name, description, roll, attack, damage, damage_type, radius, split, boosts, roll_grants, duration_amount, duration_unit, seconds, range_ft, area_shape, area_ft, save_dc, save_attr, save_half, area_lasts, targets, target_who, target_count, target_n, conditions";

export function listActions(owner: ActionOwner): Action[] {
  const [column, id] = ownerOf(owner);
  return db
    .prepare<[number], ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE ${column} = ? ORDER BY name`)
    .all(id)
    .map((r) => ({ ...r, boosts: JSON.parse(r.boosts), roll_grants: JSON.parse(r.roll_grants), conditions: JSON.parse(r.conditions) }));
}

/** Inserts when id is null, otherwise updates. */
export function saveAction(id: number | null, owner: ActionOwner, a: ActionFields): void {
  const params = { ...a, boosts: JSON.stringify(a.boosts), roll_grants: JSON.stringify(a.roll_grants), conditions: JSON.stringify(a.conditions) };
  if (id === null) {
    db.prepare<Omit<ActionRow, "id">>(
      `INSERT INTO actions (profession_id, item_id, creature_id, name, description, roll, attack, damage, damage_type, radius, split,
         boosts, roll_grants, duration_amount, duration_unit, seconds, range_ft, area_shape, area_ft, save_dc, save_attr, save_half, area_lasts, targets, target_who, target_count, target_n, conditions)
       VALUES (@profession_id, @item_id, @creature_id, @name, @description, @roll, @attack, @damage, @damage_type, @radius, @split,
         @boosts, @roll_grants, @duration_amount, @duration_unit, @seconds, @range_ft, @area_shape, @area_ft, @save_dc, @save_attr, @save_half, @area_lasts, @targets, @target_who, @target_count, @target_n, @conditions)`
    ).run({ profession_id: null, item_id: null, creature_id: null, ...owner, ...params });
  } else {
    db.prepare<Omit<ActionRow, ActionOwnerColumn>>(
      `UPDATE actions SET name = @name, description = @description, roll = @roll, attack = @attack,
         damage = @damage, damage_type = @damage_type, radius = @radius, split = @split,
         boosts = @boosts, roll_grants = @roll_grants, duration_amount = @duration_amount, duration_unit = @duration_unit,
         seconds = @seconds, range_ft = @range_ft, area_shape = @area_shape, area_ft = @area_ft, save_dc = @save_dc,
         save_attr = @save_attr, save_half = @save_half, area_lasts = @area_lasts, targets = @targets, target_who = @target_who, target_count = @target_count, target_n = @target_n, conditions = @conditions WHERE id = @id`
    ).run({ ...params, id });
  }
}

export function removeAction(id: number): void {
  db.prepare<[number]>("DELETE FROM actions WHERE id = ?").run(id);
}

/** Every profession with the ids of the professions that advance to it. */
export function listProfessionGraph(): (Profession & { prerequisites: number[] })[] {
  const links = db.prepare<[], { from_id: number; to_id: number }>("SELECT from_id, to_id FROM profession_advancements").all();
  return listProfessions().map((p) => ({
    ...p,
    prerequisites: links.filter((l) => l.to_id === p.id).map((l) => l.from_id),
  }));
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
}

export function listTokens(levelId: number): MapToken[] {
  return db
    .prepare<[number], MapToken>(
      `SELECT t.id, t.creature_id, t.character_id, COALESCE(ch.name, cr.name) AS name, COALESCE(ch.image, cr.image) AS image, t.col, t.row, t.hp,
         CASE WHEN t.character_id IS NULL THEN cr.token_overhead ELSE ch.token_overhead END AS token_overhead,
         CASE WHEN t.character_id IS NULL THEN cr.token_side ELSE ch.token_side END AS token_side,
         CASE WHEN t.character_id IS NULL THEN cr.height ELSE ch.height END AS height, t.allegiance
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

export function moveToken(id: number, col: number, row: number): void {
  db.prepare<[number, number, number]>("UPDATE map_tokens SET col = ?, row = ? WHERE id = ?").run(col, row, id);
  recordSighting(id);
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

// ---------- Calendar ----------

/** Game time in minutes since the campaign began. */
export function getGameTime(): number {
  return db.prepare<[], { now: number }>("SELECT now FROM calendar WHERE id = 1").get()?.now ?? 0;
}

export function setGameTime(minutes: number): void {
  db.prepare<[number]>("UPDATE calendar SET now = ? WHERE id = 1").run(Math.max(0, minutes));
}

export interface Timer {
  name: string;
  started: number; // game time it started, in minutes
  duration: number | null; // minutes until it expires; null = never
}

export function listTimers(): Timer[] {
  return db.prepare<[], Timer>("SELECT name, started, duration FROM timers ORDER BY name").all();
}

/** Replaces all timers (scripts load them all, change them, and save them back). */
export function saveTimers(timers: Timer[]): void {
  db.transaction(() => {
    db.exec("DELETE FROM timers");
    const insert = db.prepare<[string, number, number | null]>("INSERT INTO timers (name, started, duration) VALUES (?, ?, ?)");
    for (const t of timers) insert.run(t.name, t.started, t.duration);
  })();
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

export interface GameSession {
  id: number;
  number: number; // 1 for the first session
  started_at: string;
  game_time: number;
  began_at: string | null; // null while it's in its lobby
  ended_at: string | null; // null while it's running
  start_state: string | null;
  summary: string | null;
}

/** Sessions, most recent first. */
export function listGameSessions(): GameSession[] {
  return db
    .prepare<[], GameSession>(
      "SELECT id, started_at, game_time, began_at, ended_at, start_state, summary, ROW_NUMBER() OVER (ORDER BY id) AS number FROM game_sessions ORDER BY id DESC"
    )
    .all();
}

/** The session being played, if one is running. */
export function getOpenGameSession(): GameSession | undefined {
  return listGameSessions().find((s) => !s.ended_at);
}

/** The GM begins play: the lobby closes. */
export function beginGameSession(id: number): void {
  db.prepare<[string, number]>("UPDATE game_sessions SET began_at = COALESCE(began_at, ?) WHERE id = ?").run(new Date().toISOString(), id);
}

/** A player's page checking in: they're present. */
export function markPresent(sessionId: number, userId: number): void {
  db.prepare<[number, number, number]>(
    "INSERT INTO session_presence (session_id, user_id, last_seen) VALUES (?, ?, ?) ON CONFLICT (session_id, user_id) DO UPDATE SET last_seen = excluded.last_seen"
  ).run(sessionId, userId, Date.now());
}

/** How long after a player's last check-in they still count as present. */
export const PRESENCE_MS = 15_000;

/** The players present in a session now (their pages checked in recently), not counting anyone the GM removed. */
export function listPresentPlayers(sessionId: number): number[] {
  const removed = new Set(sessionMembers(sessionId).filter((m) => m.status === "removed").map((m) => m.user_id));
  return db
    .prepare<[number, number], { user_id: number }>("SELECT user_id FROM session_presence WHERE session_id = ? AND last_seen > ?")
    .all(sessionId, Date.now() - PRESENCE_MS)
    .map((r) => r.user_id)
    .filter((id) => !removed.has(id));
}

// Who the GM put in or took out of a session (its lobby): "gm" = an absent player the GM plays; "removed" = kept out.
// Anyone else is in the session by being present.
db.exec(`CREATE TABLE IF NOT EXISTS session_members (
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'gm' | 'removed'
  PRIMARY KEY (session_id, user_id)
)`);

export function sessionMembers(sessionId: number): { user_id: number; status: "gm" | "removed" }[] {
  return db.prepare<[number], { user_id: number; status: "gm" | "removed" }>("SELECT user_id, status FROM session_members WHERE session_id = ?").all(sessionId);
}

/** The GM adds a player to the session to play for them ("gm"), keeps one out ("removed"), or undoes either (null). */
export function setSessionMember(sessionId: number, userId: number, status: "gm" | "removed" | null): void {
  if (status === null) db.prepare<[number, number]>("DELETE FROM session_members WHERE session_id = ? AND user_id = ?").run(sessionId, userId);
  else db.prepare("INSERT INTO session_members (session_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT (session_id, user_id) DO UPDATE SET status = excluded.status").run(sessionId, userId, status);
}

/** Players the GM plays in this session (added while absent). */
export function gmPlayedPlayers(sessionId: number): number[] {
  return sessionMembers(sessionId).filter((m) => m.status === "gm").map((m) => m.user_id);
}

/** Whether the GM took this player out of the session. */
export const isRemovedFrom = (sessionId: number, userId: number) => sessionMembers(sessionId).some((m) => m.user_id === userId && m.status === "removed");

export function endGameSession(id: number, summary: string): void {
  db.prepare<[string, string, number]>("UPDATE game_sessions SET ended_at = ?, summary = ? WHERE id = ?").run(new Date().toISOString(), summary, id);
}

/** Notes something that happened in the running session, if there is one. */
export function logSessionEvent(text: string): void {
  const open = db.prepare<[], { id: number }>("SELECT id FROM game_sessions WHERE ended_at IS NULL ORDER BY id DESC").get();
  if (open) db.prepare<[number, number, string]>("INSERT INTO session_events (session_id, game_time, text) VALUES (?, ?, ?)").run(open.id, getGameTime(), text);
}

export function listSessionEvents(sessionId: number): { game_time: number; text: string }[] {
  return db.prepare<[number], { game_time: number; text: string }>("SELECT game_time, text FROM session_events WHERE session_id = ? ORDER BY id").all(sessionId);
}

export function getGameSession(id: number): GameSession | undefined {
  return listGameSessions().find((s) => s.id === id);
}

/** Starts a session now, at the current game time, with a snapshot of the game state. Returns its id. */
export function startGameSession(startState: string): number {
  return Number(
    db.prepare<[string, number, string]>("INSERT INTO game_sessions (started_at, game_time, start_state) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), getGameTime(), startState).lastInsertRowid
  );
}

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

export function addLastingArea(levelId: number, a: Omit<LastingArea, "id">): void {
  const { name, ends, ...spec } = a;
  db.prepare("DELETE FROM lasting_areas WHERE ends <= ?").run(getGameTime());
  db.prepare("INSERT INTO lasting_areas (level_id, name, ends, spec) VALUES (?, ?, ?, ?)").run(levelId, name, ends, JSON.stringify(spec));
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

// The catalog: effects (named sets of modifiers) and conditions (what actions put on creatures: the effects they
// apply, plus how long they last and the save that ends them). See lib/conditions.ts.
db.exec(`CREATE TABLE IF NOT EXISTS effects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  modifiers TEXT NOT NULL DEFAULT '[]'
)`);
db.exec(`CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  effects TEXT NOT NULL DEFAULT '[]',
  rounds INTEGER NOT NULL DEFAULT 1,
  save_attr TEXT NOT NULL DEFAULT '',
  save_dc INTEGER NOT NULL DEFAULT 12
)`);

export function listEffectDefs(): EffectDef[] {
  return db.prepare<[], { id: number; name: string; description: string; modifiers: string }>("SELECT * FROM effects ORDER BY name").all().map((r) => ({ ...r, modifiers: JSON.parse(r.modifiers) }));
}

export function getEffectDef(id: number): EffectDef | undefined {
  return listEffectDefs().find((e) => e.id === id);
}

/** Inserts when id is null, otherwise updates; returns the id. */
export function saveEffectDef(id: number | null, e: Omit<EffectDef, "id">): number {
  const params = { name: e.name, description: e.description, modifiers: JSON.stringify(e.modifiers) };
  if (id === null) return Number(db.prepare("INSERT INTO effects (name, description, modifiers) VALUES (@name, @description, @modifiers)").run(params).lastInsertRowid);
  db.prepare("UPDATE effects SET name = @name, description = @description, modifiers = @modifiers WHERE id = @id").run({ ...params, id });
  return id;
}

/** Removes an effect (and takes it out of every condition that applies it). */
export function removeEffectDef(id: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM effects WHERE id = ?").run(id);
    for (const c of listConditionDefs()) if (c.effects.includes(id)) saveConditionDef(c.id, { ...c, effects: c.effects.filter((x) => x !== id) });
  })();
}

type ConditionRow = Omit<ConditionDef, "effects"> & { effects: string };
export function listConditionDefs(): ConditionDef[] {
  return db.prepare<[], ConditionRow>("SELECT * FROM conditions ORDER BY name").all().map((r) => ({ ...r, effects: JSON.parse(r.effects) }));
}

export function getConditionDef(id: number): ConditionDef | undefined {
  return listConditionDefs().find((c) => c.id === id);
}

/** A catalog condition with its effects filled in, as it stands now (what gets put on a creature). */
export function getCondition(id: number): Condition | undefined {
  const c = getConditionDef(id);
  if (!c) return undefined;
  const effects = listEffectDefs();
  return { ...c, effects: c.effects.flatMap((e) => effects.find((x) => x.id === e) ?? []) };
}

/** Inserts when id is null, otherwise updates; returns the id. */
export function saveConditionDef(id: number | null, c: Omit<ConditionDef, "id">): number {
  const params = { name: c.name, description: c.description, effects: JSON.stringify(c.effects), rounds: c.rounds, save_attr: c.save_attr, save_dc: c.save_dc };
  if (id === null) return Number(db.prepare("INSERT INTO conditions (name, description, effects, rounds, save_attr, save_dc) VALUES (@name, @description, @effects, @rounds, @save_attr, @save_dc)").run(params).lastInsertRowid);
  db.prepare("UPDATE conditions SET name = @name, description = @description, effects = @effects, rounds = @rounds, save_attr = @save_attr, save_dc = @save_dc WHERE id = @id").run({ ...params, id });
  return id;
}

export function removeConditionDef(id: number): void {
  db.prepare<[number]>("DELETE FROM conditions WHERE id = ?").run(id);
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

// Once per action: its own boosts and roll effects become a catalog condition (named after it) applying an effect of
// the same name, on whoever it was for; health boosts become an instant heal. Its lists are then emptied, so this runs
// only for actions saved before conditions existed.
{
  type Row = { id: number; name: string; boosts: string; roll_grants: string; duration_amount: number; duration_unit: string; conditions: string };
  const per: Record<string, number> = { round: 1, turn: 1, minute: 10, hour: 600, day: 14400, "short rest": 600, "long rest": 4800 };
  const rows = db.prepare<[], Row>("SELECT id, name, boosts, roll_grants, duration_amount, duration_unit, conditions FROM actions WHERE boosts != '[]' OR roll_grants != '[]'").all();
  if (rows.length) db.transaction(() => {
    for (const r of rows) {
      const boosts: Boost[] = JSON.parse(r.boosts), grants: RollGrant[] = JSON.parse(r.roll_grants), conditions: { id: number; on: "self" | "target" }[] = JSON.parse(r.conditions);
      const sides = (["target", "self"] as const).filter((on) => boosts.some((b) => (b.on ?? "self") === on) || grants.some((g) => (g.on ?? "self") === on));
      for (const on of sides) {
        const modifiers: Modifier[] = [
          ...boosts.filter((b) => (b.on ?? "self") === on).map((b): Modifier => (b.target === "health" ? { kind: "instant", value: b.value.replace(/^\+/, ""), heal: true, damage_type: "" } : { kind: "boost", target: b.target, value: b.value })),
          ...grants.filter((g) => (g.on ?? "self") === on).map((g): Modifier => ({ kind: "roll", roll: g.roll, mode: g.mode })),
        ];
        const name = sides.length > 1 && on === "self" ? `${r.name} (self)` : r.name;
        const effect = saveEffectDef(null, { name, description: `From ${r.name}.`, modifiers });
        const rounds = Math.max(1, (per[r.duration_unit] ?? 1) * Math.max(1, r.duration_amount));
        conditions.push({ id: saveConditionDef(null, { name, description: `From ${r.name}.`, effects: [effect], rounds, save_attr: "", save_dc: 12 }), on });
      }
      db.prepare("UPDATE actions SET boosts = '[]', roll_grants = '[]', conditions = ? WHERE id = ?").run(JSON.stringify(conditions), r.id);
    }
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

/** A kept copy as a Condition (one kept by the first version is an old effect). */
const keptCondition = (json: string): Condition => {
  const c = JSON.parse(json);
  return "per_round" in c ? oldToCondition(c) : c;
};

/** The conditions on a level's tokens, by token id. */
export function listAfflictions(levelId: number): Map<number, Affliction[]> {
  const out = new Map<number, Affliction[]>();
  for (const r of db.prepare<[number], { id: number; token_id: number; effect: string; rounds_left: number; by_token: number | null }>("SELECT id, token_id, effect, rounds_left, by_token FROM token_afflictions WHERE level_id = ? ORDER BY id").all(levelId)) {
    out.set(r.token_id, [...(out.get(r.token_id) ?? []), { id: r.id, condition: keptCondition(r.effect), left: r.rounds_left, by: r.by_token }]);
  }
  return out;
}

/** Replaces a level's conditions with these (after a round, or time passing). */
export function saveAfflictions(levelId: number, all: Map<number, Affliction[]>): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM token_afflictions WHERE level_id = ?").run(levelId);
    const insert = db.prepare("INSERT INTO token_afflictions (level_id, token_id, effect_id, effect, rounds_left, by_token) VALUES (?, ?, ?, ?, ?, ?)");
    for (const [tokenId, list] of all) for (const a of list) if (a.left > 0) insert.run(levelId, tokenId, a.condition.id, JSON.stringify(a.condition), a.left, a.by);
  })();
}

/** Puts a condition on a token (again: its rounds start over). */
export function addAffliction(levelId: number, tokenId: number, condition: Condition, by: number | null): void {
  const all = listAfflictions(levelId);
  all.set(tokenId, [...(all.get(tokenId) ?? []).filter((a) => a.condition.id !== condition.id), { condition, left: condition.rounds, by }]);
  saveAfflictions(levelId, all);
}

export function removeAffliction(id: number): void {
  db.prepare<[number]>("DELETE FROM token_afflictions WHERE id = ?").run(id);
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
  | { kind: "search"; dc: number }
  | { kind: "initiative"; levelId: number; tokenId: number }
  | { kind: "rolloff"; levelId: number; tokenId: number }; // a roll-off for a contested spot

type RollRequestRow = { id: number; player_id: number; character_id: number; spec: string; action: string; result: string | null };
const parseRequest = (r: RollRequestRow): RollRequest => ({ ...r, spec: JSON.parse(r.spec), action: JSON.parse(r.action), result: r.result ? JSON.parse(r.result) : null });

/** Asks a player to roll; replaces any roll they haven't made yet (and puts away one they rolled but left open). */
export function requestRoll(playerId: number, characterId: number, spec: RollSpec, action: RollAction): void {
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
  return db
    .prepare<[number, string], { profession: string; value: string }>(
      `SELECT p.name AS profession, m.value FROM character_professions cp JOIN professions p ON p.id = cp.profession_id
       JOIN profession_modifiers m ON m.profession_id = p.id WHERE cp.character_id = ? AND m.target = ? ORDER BY p.name`
    )
    .all(characterId, target);
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
  contest: import("@/lib/resolveRound").Contest;
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

export function setReplay(levelId: number, replay: Replay): void {
  db.prepare<[string, number]>("UPDATE encounters SET replay = ? WHERE level_id = ?").run(JSON.stringify(replay), levelId);
  // Kept for the rest of the encounter, so players can look back over every round they've had.
  const stories = [...getRoundStories(levelId).filter((r) => r.round !== replay.round), { round: replay.round, showAt: replay.starts + (replay.frames.length + 1) * 1000, story: replay.story ?? [] }];
  db.prepare<[string, number]>("UPDATE encounters SET stories = ? WHERE level_id = ?").run(JSON.stringify(stories), levelId);
}

/** A resolved round's events (raw: each player is only ever told their own part), and when its playback ends. */
export interface RoundStory {
  round: number;
  showAt: number; // ms since epoch: the playback's end (players hear about it then)
  story: import("@/lib/roundStory").StoryEvent[];
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
export function listPlanRoutes(levelId: number, tokenId?: number): { token: number; points: { col: number; row: number }[] }[] {
  const rows = db.prepare<[number], { token_id: number; plan: string }>("SELECT token_id, plan FROM round_plans WHERE level_id = ?").all(levelId);
  return rows
    .filter((r) => tokenId === undefined || r.token_id === tokenId)
    .map((r) => ({ token: r.token_id, points: (JSON.parse(r.plan) as PlanStep[]).flatMap((s) => (s.kind === "move" ? [s.to] : [])) }))
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

export interface ContainerStack {
  id: number;
  item: Item;
  qty: number;
}

/** Equipped containers and their contents: one entry per container worn (a container item with a capacity). */
export function characterContainers(characterId: number): { slot: EquipSlot; container: Item; stacks: ContainerStack[] }[] {
  const c = getCharacter(characterId);
  if (!c) return [];
  const rows = db.prepare<[number], { id: number; container_id: number; item_id: number; qty: number }>("SELECT id, container_id, item_id, qty FROM container_items WHERE character_id = ? ORDER BY id").all(characterId);
  return (Object.entries(c.equipment ?? {}) as [EquipSlot, number | null][]).flatMap(([slot, id]) => {
    const container = id ? getItem(id) : undefined;
    if (!container || !container.capacity) return [];
    const stacks = rows.filter((r) => r.container_id === container.id).flatMap((r) => {
      const item = getItem(r.item_id);
      return item ? [{ id: r.id, item, qty: r.qty }] : [];
    });
    return [{ slot, container, stacks }];
  });
}

/** Puts items in a container: onto a stack of the same item with room first, then into free slots. Returns how many didn't fit. */
export function addToContainer(characterId: number, containerId: number, itemId: number, qty: number): number {
  const container = getItem(containerId), item = getItem(itemId);
  if (!container?.capacity || !item || item.id === containerId) return qty;
  const max = Math.max(1, item.max_stack ?? 1);
  return db.transaction(() => {
    let left = qty;
    const stacks = db.prepare<[number, number], { id: number; item_id: number; qty: number }>("SELECT id, item_id, qty FROM container_items WHERE character_id = ? AND container_id = ?").all(characterId, containerId);
    for (const s of stacks) {
      if (s.item_id !== itemId || s.qty >= max || left <= 0) continue;
      const put = Math.min(left, max - s.qty);
      db.prepare("UPDATE container_items SET qty = qty + ? WHERE id = ?").run(put, s.id);
      left -= put;
    }
    let free = container.capacity! - stacks.length;
    while (left > 0 && free > 0) {
      const put = Math.min(left, max);
      db.prepare("INSERT INTO container_items (character_id, container_id, item_id, qty) VALUES (?, ?, ?, ?)").run(characterId, containerId, itemId, put);
      left -= put;
      free--;
    }
    return left;
  })();
}

/** Takes up to `qty` off a stack (the stack goes when it's empty). */
export function takeFromStack(stackId: number, qty = 1): void {
  db.transaction(() => {
    db.prepare("UPDATE container_items SET qty = qty - ? WHERE id = ?").run(qty, stackId);
    db.prepare("DELETE FROM container_items WHERE id = ? AND qty <= 0").run(stackId);
  })();
}

/** Takes one of an item out of whichever of their worn containers has it; the container it came from, or null. */
export function takeCarried(characterId: number, itemId: number): number | null {
  for (const c of characterContainers(characterId)) {
    const s = c.stacks.find((x) => x.item.id === itemId);
    if (s) {
      takeFromStack(s.id);
      return c.container.id;
    }
  }
  return null;
}

/** The GM sets a token's side (null: back to its kind's default). */
export function setTokenAllegiance(tokenId: number, allegiance: string | null): void {
  db.prepare("UPDATE map_tokens SET allegiance = ? WHERE id = ?").run(allegiance, tokenId);
}
