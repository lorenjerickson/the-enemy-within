import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";

fs.mkdirSync("data", { recursive: true });
const db = new Database("data/game.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    contact TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL
  )
`);

export default db;

export type Role = "gm" | "player";

export interface User {
  id: number;
  name: string;
  username: string;
  contact: string | null;
  role: Role;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function getGm(): User | undefined {
  return db
    .prepare<[], User>("SELECT id, name, username, contact, role FROM users WHERE role = 'gm'")
    .get();
}

export function createUser(u: Omit<User, "id">, password: string): void {
  db.prepare<[string, string, string | null, string, Role]>(
    "INSERT INTO users (name, username, contact, password_hash, role) VALUES (?, ?, ?, ?, ?)"
  ).run(u.name, u.username, u.contact, hashPassword(password), u.role);
}
