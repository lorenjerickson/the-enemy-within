import crypto from "node:crypto";
import { db } from "@/lib/db/connection";

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
  watching?: boolean; // the GM only watching this (present) player: they see what the player sees, and can't do anything
  actingToken?: number; // the GM playing one of their own tokens (a creature): its token
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
