import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import { CREATURE_TYPES, type CreatureType } from "@/lib/creatureTypes";
import type { Attributes } from "@/lib/attributes";
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
  CREATE TABLE IF NOT EXISTS ranks (
    id INTEGER PRIMARY KEY,
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    parent_id INTEGER REFERENCES ranks(id), -- null = first advancement from the base profession
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
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
addColumn("items", "slots", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of EquipSlot

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
}

/** Enabled equipment slots; each holds an item id, or null when empty. */
export type Equipment = Partial<Record<EquipSlot, number | null>>;

type CreatureRow = Omit<Creature, "attributes" | "equipment"> & { attributes: string; equipment: string };

const CREATURE_COLUMNS = "id, name, description, image, type, attributes, equipment";

const parseCreature = (row: CreatureRow): Creature => ({
  ...row,
  attributes: JSON.parse(row.attributes),
  equipment: JSON.parse(row.equipment),
});

export function listCreatures(): Creature[] {
  return db.prepare<[], CreatureRow>(`SELECT ${CREATURE_COLUMNS} FROM creatures ORDER BY name`).all().map(parseCreature);
}

export function getCreature(id: number): Creature | undefined {
  const row = db.prepare<[number], CreatureRow>(`SELECT ${CREATURE_COLUMNS} FROM creatures WHERE id = ?`).get(id);
  return row && parseCreature(row);
}

/** Inserts when id is null, otherwise updates. */
export function saveCreature(id: number | null, c: Omit<Creature, "id">): void {
  const params = { ...c, attributes: JSON.stringify(c.attributes), equipment: JSON.stringify(c.equipment) };
  if (id === null) {
    db.prepare<Omit<CreatureRow, "id">>(
      `INSERT INTO creatures (name, description, image, type, attributes, equipment)
       VALUES (@name, @description, @image, @type, @attributes, @equipment)`
    ).run(params);
  } else {
    db.prepare<CreatureRow>(
      `UPDATE creatures SET name = @name, description = @description, image = @image, type = @type,
         attributes = @attributes, equipment = @equipment WHERE id = @id`
    ).run({ ...params, id });
  }
}

export interface Profession {
  id: number;
  name: string;
  description: string;
}

/** An advancement option. Siblings under the same parent are alternative choices at that level. */
export interface Rank {
  id: number;
  profession_id: number;
  parent_id: number | null;
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

export function listRanks(professionId: number): Rank[] {
  return db
    .prepare<[number], Rank>("SELECT id, profession_id, parent_id, name, description FROM ranks WHERE profession_id = ? ORDER BY id")
    .all(professionId);
}

export function addRank(r: Omit<Rank, "id">): void {
  db.prepare<Omit<Rank, "id">>(
    "INSERT INTO ranks (profession_id, parent_id, name, description) VALUES (@profession_id, @parent_id, @name, @description)"
  ).run(r);
}

export function updateRank(id: number, name: string, description: string): void {
  db.prepare<[string, string, number]>("UPDATE ranks SET name = ?, description = ? WHERE id = ?").run(name, description, id);
}
