/**
 * Improvise (backlog N): a player wants to do something the rules don't cover ("tip the oil barrel toward the door").
 * They ask with a line of intent; the GM is told and the two settle it at the table, and the app records what was
 * agreed. While one is open, that player's planning clock waits.
 */
import { db } from "@/lib/db";
import type { TriggerOutcome } from "@/lib/triggers";

db.exec(`CREATE TABLE IF NOT EXISTS improvisations (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'asked', -- asked (waiting on the GM) | agreed | done | dropped
  details TEXT -- JSON: what was agreed
)`);
try { db.exec("ALTER TABLE improvisations ADD COLUMN rolled TEXT"); } catch { /* there already */ }

/**
 * How the GM decides an improvisation plays out in the rules (more kinds as play needs them; "place an area" next):
 * narrative only (the GM describes it), a script (the library's too), map changes (as triggers make), or an effect from
 * the catalogue on the improviser or someone else.
 */
export type ImproviseOutcome =
  | { kind: "narrative"; text: string }
  | { kind: "script"; script: string }
  | { kind: "map"; outcomes: TriggerOutcome[] }
  | { kind: "effect"; effect: number; on: "self" | "target"; target?: number };

/** The roll an improvisation needs, if any: a skill check, a save or a plain ability roll, against a DC. */
export type ImproviseRoll = { type: "check"; skill: string; dc: number } | { type: "save" | "ability"; attribute: string; dc: number };

/** What the GM settled: what it costs, the roll, what happens on success (and on failure, if anything). */
export interface Agreed {
  name: string; // what it's called on the plan ("Tip the barrel")
  cost: "action" | "bonus" | "free";
  seconds: number;
  roll: ImproviseRoll | null;
  success: ImproviseOutcome;
  failure?: ImproviseOutcome;
}

export interface Improvisation {
  id: number;
  level_id: number;
  token_id: number;
  intent: string;
  status: "asked" | "agreed" | "done" | "dropped"; // asked: waiting on the GM; agreed: settled (to roll, plan or do)
  agreed?: Agreed;
  rolled?: { total: number; natural: number }; // the player's roll (its outcome isn't shown to them until it plays out)
}

const COLS = "id, level_id, token_id, intent, status, details, rolled";
type Row = { id: number; level_id: number; token_id: number; intent: string; status: Improvisation["status"]; details: string | null; rolled: string | null };
const parse = (r: Row | undefined): Improvisation | undefined =>
  r && { id: r.id, level_id: r.level_id, token_id: r.token_id, intent: r.intent, status: r.status, ...(r.details ? { agreed: JSON.parse(r.details) as Agreed } : {}), ...(r.rolled ? { rolled: JSON.parse(r.rolled) } : {}) };

/** Whether a roll succeeded (a natural 1 never does; it's a critical failure). */
export const rollSucceeds = (roll: ImproviseRoll | null, rolled?: { total: number; natural: number }) => !roll || (!!rolled && rolled.natural !== 1 && rolled.total >= roll.dc);

/** A token asks to improvise (one at a time: a new ask replaces an open one). */
export function askImprovise(levelId: number, tokenId: number, intent: string): number {
  db.prepare("UPDATE improvisations SET status = 'dropped' WHERE token_id = ? AND status = 'asked'").run(tokenId);
  return Number(db.prepare("INSERT INTO improvisations (level_id, token_id, intent) VALUES (?, ?, ?)").run(levelId, tokenId, intent.trim().slice(0, 300)).lastInsertRowid);
}

/** A token's open ask (waiting on the GM), if any. */
export const openImprovisation = (tokenId: number): Improvisation | undefined =>
  parse(db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE token_id = ? AND status = 'asked' ORDER BY id DESC`).get(tokenId));

/** A token's settled improvisation not yet done (to roll for, plan or do). */
export const agreedImprovisation = (tokenId: number): Improvisation | undefined =>
  parse(db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE token_id = ? AND status = 'agreed' ORDER BY id DESC`).get(tokenId));

/** The GM settles it (any earlier settled one of theirs is dropped). */
export function agreeImprovisation(id: number, agreed: Agreed): void {
  const i = getImprovisation(id);
  if (!i) return;
  db.prepare("UPDATE improvisations SET status = 'dropped' WHERE token_id = ? AND status = 'agreed' AND id != ?").run(i.token_id, id);
  db.prepare("UPDATE improvisations SET status = 'agreed', details = ?, rolled = NULL WHERE id = ?").run(JSON.stringify(agreed), id);
}

/** The player's roll came in (kept; its outcome is shown when it plays out). */
export const setImproviseRolled = (id: number, rolled: { total: number; natural: number }): void => void db.prepare("UPDATE improvisations SET rolled = ? WHERE id = ?").run(JSON.stringify(rolled), id);

/** It has played out. */
export const finishImprovisation = (id: number): void => void db.prepare("UPDATE improvisations SET status = 'done' WHERE id = ?").run(id);

/** Every open ask on a level (the GM's list). */
export const listOpenImprovisations = (levelId?: number): Improvisation[] =>
  levelId === undefined
    ? db.prepare<[], Row>(`SELECT ${COLS} FROM improvisations WHERE status = 'asked' ORDER BY id`).all().map((r) => parse(r)!)
    : db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE level_id = ? AND status = 'asked' ORDER BY id`).all(levelId).map((r) => parse(r)!);

/** The player takes it back, or the GM turns it down. */
export const dropImprovisation = (id: number): void => void db.prepare("UPDATE improvisations SET status = 'dropped' WHERE id = ?").run(id);

export const getImprovisation = (id: number): Improvisation | undefined => parse(db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE id = ?`).get(id));
