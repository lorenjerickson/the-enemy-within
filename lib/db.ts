import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import { CREATURE_TYPES, type CreatureType, type Movement } from "@/lib/creatureTypes";
import type { Attributes } from "@/lib/attributes";
import {
  DEFAULT_BACKGROUND, DEFAULT_GRID, DEFAULT_MAP_IMAGE, DEFAULT_TEMPLATE_COLORS,
  type MapBackground, type MapGrid, type MapImage, type MapLayer, type StructureKind, type TemplateColors,
} from "@/lib/maps";
import type { ModifierTarget } from "@/lib/modifiers";
import type { Boost, DamageType, DurationUnit, RollGrant, RollMode } from "@/lib/actions";
import { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity } from "@/lib/itemTypes";

fs.mkdirSync("data", { recursive: true });
const db = new Database("data/game.db");

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

// Add columns introduced after a database was first created.
function addColumn(table: string, column: string, definition: string): void {
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
db.exec("UPDATE level_hidden_layers SET layer = 'structure' WHERE layer = 'walls'"); // layer renamed
addColumn("actions", "roll_grants", "TEXT NOT NULL DEFAULT '[]'"); // JSON RollGrant[]
addColumn("items", "slots", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of EquipSlot

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
  image: string | null;
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

const CREATURE_COLUMNS = "id, name, description, image, type, attributes, equipment, health, movement";

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
      `INSERT INTO creatures (name, description, image, type, attributes, equipment, health, movement)
       VALUES (@name, @description, @image, @type, @attributes, @equipment, @health, @movement)`
    ).run(params);
  } else {
    db.prepare<CreatureRow>(
      `UPDATE creatures SET name = @name, description = @description, image = @image, type = @type,
         attributes = @attributes, equipment = @equipment, health = @health, movement = @movement WHERE id = @id`
    ).run({ ...params, id });
  }
}

/** A single-instance creature, copied from a creature template. */
export type Character = Creature & { creature_id: number | null; template_name: string | null };

const CHARACTER_SELECT = `SELECT c.id, c.creature_id, t.name AS template_name, c.name, c.description, c.image, c.type,
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
        `INSERT INTO characters (creature_id, name, description, image, type, attributes, equipment, health, movement)
         VALUES (@creature_id, @name, @description, @image, @type, @attributes, @equipment, @health, @movement)`
      ).run({ ...params, creature_id: creatureId }).lastInsertRowid
    );
  } else {
    db.prepare<CreatureRow>(
      `UPDATE characters SET name = @name, description = @description, image = @image, type = @type,
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
  hidden: MapLayer[];
}

/** A location's levels, top level first; a location always has at least one. */
export function listLevels(locationId: number): MapLevel[] {
  const select = () =>
    db.prepare<
      [number],
      { id: number; location_id: number; name: string; position: number; background: string | null; map_image: string | null; grid: string | null; template_colors: string | null }
    >("SELECT id, location_id, name, position, background, map_image, grid, template_colors FROM map_levels WHERE location_id = ? ORDER BY position DESC"
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

export const ASSET_USAGES = ["item", "creature", "background", "map", "tile"] as const;
export type AssetType = "image";
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
}

export function listStructures(levelId: number): MapStructure[] {
  return db
    .prepare<[number], MapStructure>(
      `SELECT s.id, s.kind, s.x1, s.y1, s.x2, s.y2, s.target_level_id, l.name AS target_name
       FROM map_structures s LEFT JOIN map_levels l ON l.id = s.target_level_id WHERE s.level_id = ? ORDER BY s.id`
    )
    .all(levelId);
}

export function addStructure(levelId: number, s: Omit<MapStructure, "id" | "target_name">): void {
  db.prepare<Omit<MapStructure, "id" | "target_name"> & { level_id: number }>(
    `INSERT INTO map_structures (level_id, kind, x1, y1, x2, y2, target_level_id)
     VALUES (@level_id, @kind, @x1, @y1, @x2, @y2, @target_level_id)`
  ).run({ ...s, level_id: levelId });
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
}

export function listTokens(levelId: number): MapToken[] {
  return db
    .prepare<[number], MapToken>(
      `SELECT t.id, t.creature_id, t.character_id, COALESCE(ch.name, cr.name) AS name, COALESCE(ch.image, cr.image) AS image, t.col, t.row
       FROM map_tokens t
       LEFT JOIN creatures cr ON cr.id = t.creature_id
       LEFT JOIN characters ch ON ch.id = t.character_id
       WHERE t.level_id = ? ORDER BY t.id`
    )
    .all(levelId);
}

export function addCreatureToken(levelId: number, creatureId: number, col: number, row: number): void {
  db.prepare<[number, number, number, number]>("INSERT INTO map_tokens (level_id, creature_id, col, row) VALUES (?, ?, ?, ?)").run(
    levelId, creatureId, col, row
  );
}

export function deleteToken(id: number): void {
  db.prepare<[number]>("DELETE FROM map_tokens WHERE id = ?").run(id);
}
