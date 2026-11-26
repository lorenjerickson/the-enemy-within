import { db } from "@/lib/db/connection";

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

/** Players' tokens still to roll initiative in the level's encounter (they join the turn order once they roll). */
export function getEncounterWaiting(levelId: number): number[] {
  const row = db.prepare<[number], { waiting: string }>("SELECT waiting FROM encounters WHERE level_id = ?").get(levelId);
  return row ? JSON.parse(row.waiting) : [];
}

export function setEncounterWaiting(levelId: number, tokenIds: number[]): void {
  db.prepare<[string, number]>("UPDATE encounters SET waiting = ? WHERE level_id = ?").run(JSON.stringify(tokenIds), levelId);
}
