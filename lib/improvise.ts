/**
 * Improvise (backlog N): a player wants to do something the rules don't cover ("tip the oil barrel toward the door").
 * They ask with a line of intent; the GM is told and the two settle it at the table, and the app records what was
 * agreed. While one is open, that player's planning clock waits.
 */
import { db } from "@/lib/db";

db.exec(`CREATE TABLE IF NOT EXISTS improvisations (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'asked', -- asked (waiting on the GM) | agreed | done | dropped
  details TEXT -- JSON: what was agreed
)`);

export interface Improvisation {
  id: number;
  level_id: number;
  token_id: number;
  intent: string;
  status: "asked" | "agreed" | "done" | "dropped";
}

const COLS = "id, level_id, token_id, intent, status";

/** A token asks to improvise (one at a time: a new ask replaces an open one). */
export function askImprovise(levelId: number, tokenId: number, intent: string): number {
  db.prepare("UPDATE improvisations SET status = 'dropped' WHERE token_id = ? AND status = 'asked'").run(tokenId);
  return Number(db.prepare("INSERT INTO improvisations (level_id, token_id, intent) VALUES (?, ?, ?)").run(levelId, tokenId, intent.trim().slice(0, 300)).lastInsertRowid);
}

/** A token's open ask (waiting on the GM), if any. */
export const openImprovisation = (tokenId: number): Improvisation | undefined =>
  db.prepare<[number], Improvisation>(`SELECT ${COLS} FROM improvisations WHERE token_id = ? AND status = 'asked' ORDER BY id DESC`).get(tokenId);

/** Every open ask on a level (the GM's list). */
export const listOpenImprovisations = (levelId?: number): Improvisation[] =>
  levelId === undefined
    ? db.prepare<[], Improvisation>(`SELECT ${COLS} FROM improvisations WHERE status = 'asked' ORDER BY id`).all()
    : db.prepare<[number], Improvisation>(`SELECT ${COLS} FROM improvisations WHERE level_id = ? AND status = 'asked' ORDER BY id`).all(levelId);

/** The player takes it back, or the GM turns it down. */
export const dropImprovisation = (id: number): void => void db.prepare("UPDATE improvisations SET status = 'dropped' WHERE id = ?").run(id);

export const getImprovisation = (id: number): Improvisation | undefined => db.prepare<[number], Improvisation>(`SELECT ${COLS} FROM improvisations WHERE id = ?`).get(id);
