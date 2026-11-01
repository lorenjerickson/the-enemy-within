import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
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

export function listPlayers(): User[] {
  return db
    .prepare<[], User>(`SELECT ${USER_COLUMNS} FROM users WHERE role = 'player' ORDER BY name`)
    .all();
}

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

export function listItems(): Item[] {
  return db
    .prepare<[], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY name`)
    .all()
    .map((row) => ({ ...row, slots: JSON.parse(row.slots) }));
}

export function createItem(item: Omit<Item, "id">): void {
  db.prepare<Omit<ItemRow, "id">>(
    `INSERT INTO items (name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots)
     VALUES (@name, @description, @image, @type, @weight, @value, @rarity, @durability, @defense, @damage, @attack, @max_stack, @capacity, @slots)`
  ).run({ ...item, slots: JSON.stringify(item.slots) });
}
