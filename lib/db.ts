import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import { CREATURE_TYPES, type CreatureType, type Movement } from "@/lib/creatureTypes";
import type { Attributes } from "@/lib/attributes";
import {
  DEFAULT_BACKGROUND, DEFAULT_GRID, DEFAULT_MAP_IMAGE, DEFAULT_TEMPLATE_COLORS,
  type ClipMode, type ControlEdge, type LightKind, type MapBackground, type MapGrid, type MapImage, type MapLayer, type StructureKind, type TemplateColors,
} from "@/lib/maps";
import type { ModifierTarget } from "@/lib/modifiers";
import type { Boost, DamageType, DurationUnit, RollGrant, RollMode } from "@/lib/actions";
import type { EffectKind } from "@/lib/effects";
import { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity } from "@/lib/itemTypes";

fs.mkdirSync("data", { recursive: true });
export const db = new Database("data/game.db");

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
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
addColumn("items", "slots", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of EquipSlot
addColumn("characters", "hp", "INTEGER"); // current health; null until first rolled from the health formula
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
}

const ITEM_COLUMNS = "id, name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots";

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
      `INSERT INTO items (name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots)
       VALUES (@name, @description, @image, @type, @weight, @value, @rarity, @durability, @defense, @damage, @attack, @max_stack, @capacity, @slots)`
    ).run(params);
  } else {
    db.prepare<ItemRow>(
      `UPDATE items SET name = @name, description = @description, image = @image, type = @type, weight = @weight,
         value = @value, rarity = @rarity, durability = @durability, defense = @defense, damage = @damage,
         attack = @attack, max_stack = @max_stack, capacity = @capacity, slots = @slots
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
}

type ActionFields = Omit<Action, "id" | ActionOwnerColumn>;
type ActionRow = Omit<Action, "boosts" | "roll_grants"> & { boosts: string; roll_grants: string };

const ACTION_COLUMNS =
  "id, profession_id, item_id, creature_id, name, description, roll, attack, damage, damage_type, radius, split, boosts, roll_grants, duration_amount, duration_unit";

export function listActions(owner: ActionOwner): Action[] {
  const [column, id] = ownerOf(owner);
  return db
    .prepare<[number], ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE ${column} = ? ORDER BY name`)
    .all(id)
    .map((r) => ({ ...r, boosts: JSON.parse(r.boosts), roll_grants: JSON.parse(r.roll_grants) }));
}

/** Inserts when id is null, otherwise updates. */
export function saveAction(id: number | null, owner: ActionOwner, a: ActionFields): void {
  const params = { ...a, boosts: JSON.stringify(a.boosts), roll_grants: JSON.stringify(a.roll_grants) };
  if (id === null) {
    db.prepare<Omit<ActionRow, "id">>(
      `INSERT INTO actions (profession_id, item_id, creature_id, name, description, roll, attack, damage, damage_type, radius, split,
         boosts, roll_grants, duration_amount, duration_unit)
       VALUES (@profession_id, @item_id, @creature_id, @name, @description, @roll, @attack, @damage, @damage_type, @radius, @split,
         @boosts, @roll_grants, @duration_amount, @duration_unit)`
    ).run({ profession_id: null, item_id: null, creature_id: null, ...owner, ...params });
  } else {
    db.prepare<Omit<ActionRow, ActionOwnerColumn>>(
      `UPDATE actions SET name = @name, description = @description, roll = @roll, attack = @attack,
         damage = @damage, damage_type = @damage_type, radius = @radius, split = @split,
         boosts = @boosts, roll_grants = @roll_grants, duration_amount = @duration_amount, duration_unit = @duration_unit WHERE id = @id`
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
}

export function listTokens(levelId: number): MapToken[] {
  return db
    .prepare<[number], MapToken>(
      `SELECT t.id, t.creature_id, t.character_id, COALESCE(ch.name, cr.name) AS name, COALESCE(ch.image, cr.image) AS image, t.col, t.row, t.hp,
         CASE WHEN t.character_id IS NULL THEN cr.token_overhead ELSE ch.token_overhead END AS token_overhead,
         CASE WHEN t.character_id IS NULL THEN cr.token_side ELSE ch.token_side END AS token_side,
         CASE WHEN t.character_id IS NULL THEN cr.height ELSE ch.height END AS height
       FROM map_tokens t
       LEFT JOIN creatures cr ON cr.id = t.creature_id
       LEFT JOIN characters ch ON ch.id = t.character_id
       WHERE t.level_id = ? ORDER BY t.id`
    )
    .all(levelId);
}

export function addCreatureToken(levelId: number, creatureId: number, col: number, row: number, hp: number | null = null): number {
  return Number(
    db.prepare<[number, number, number, number, number | null]>("INSERT INTO map_tokens (level_id, creature_id, col, row, hp) VALUES (?, ?, ?, ?, ?)").run(
      levelId, creatureId, col, row, hp
    ).lastInsertRowid
  );
}

export function setTokenHp(id: number, hp: number): void {
  db.prepare<[number, number]>("UPDATE map_tokens SET hp = ? WHERE id = ?").run(hp, id);
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

/** Places a character on a level. A character exists once, so any token it already has (on any level) is removed. */
export function placeCharacterToken(levelId: number, characterId: number, col: number, row: number): number {
  return db.transaction(() => {
    db.prepare<[number]>("DELETE FROM map_tokens WHERE character_id = ?").run(characterId);
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

/** A player's character token: where it stands. */
export function getPlayerToken(playerId: number): { character_id: number; name: string; attributes: string; level_id: number; col: number; row: number } | undefined {
  return db
    .prepare<[number], { character_id: number; name: string; attributes: string; level_id: number; col: number; row: number }>(
      "SELECT c.id AS character_id, c.name, c.attributes, t.level_id, t.col, t.row FROM map_tokens t JOIN characters c ON c.id = t.character_id WHERE c.player_id = ? ORDER BY t.id LIMIT 1"
    )
    .get(playerId);
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

export function saveCharacterState(s: Pick<CharacterState, "id" | "attributes" | "hp" | "conditions">): void {
  db.prepare<[string, number | null, string, number]>("UPDATE characters SET attributes = ?, hp = ?, conditions = ? WHERE id = ?")
    .run(JSON.stringify(s.attributes), s.hp, JSON.stringify(s.conditions), s.id);
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

/** The players present in a session now (their pages checked in recently). */
export function listPresentPlayers(sessionId: number): number[] {
  return db
    .prepare<[number, number], { user_id: number }>("SELECT user_id FROM session_presence WHERE session_id = ? AND last_seen > ?")
    .all(sessionId, Date.now() - PRESENCE_MS)
    .map((r) => r.user_id);
}

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
export function getPlayerTokenLevelId(playerId: number): number | undefined {
  return db
    .prepare<[number], { level_id: number }>(
      "SELECT t.level_id FROM map_tokens t JOIN characters c ON c.id = t.character_id WHERE c.player_id = ? ORDER BY t.id LIMIT 1"
    )
    .get(playerId)?.level_id;
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
