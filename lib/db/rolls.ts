import type { RollSpec, RolledPart } from "@/lib/rolls";
import { db } from "@/lib/db/connection";
import { getEncounter, saveEncounter, setEncounterWaiting, getEncounterWaiting } from "@/lib/db/encounters";
import { clearAssist } from "@/lib/db/tokens";

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
  | { kind: "search"; dc: number; at?: { col: number; row: number } } // at: where they searched from (a Search in a round: where they stood when it finished)
  | { kind: "initiative"; levelId: number; tokenId: number }
  | { kind: "hide"; levelId: number; tokenId: number; inRound?: boolean } // inRound: they already hid in a round; the roll only sets the total // Hide: their Stealth total is how hard they are to find (if no enemy sees them as they roll)
  | { kind: "rolloff"; levelId: number; tokenId: number } // a roll-off for a contested spot
  | { kind: "conditionSave"; levelId: number; tokenId: number; key: string } // a save against a condition as it lands, mid-round
  | { kind: "improvise"; id: number } // the roll an improvisation needs (its outcome shown when it plays out)
  | { kind: "areaSave"; levelId: number; areaId: number; tokenId: number; leaving?: boolean; staying?: boolean };

 // out of combat: a save against a lasting area they walked into (left, stayed in)

type RollRequestRow = { id: number; player_id: number; character_id: number; spec: string; action: string; result: string | null };

const parseRequest = (r: RollRequestRow): RollRequest => ({ ...r, spec: JSON.parse(r.spec), action: JSON.parse(r.action), result: r.result ? JSON.parse(r.result) : null });

/** A roll request for a character who was helped (Assist): advantage on it ("helped by …"), and the help is used up. Not initiative. */
function withAssist(characterId: number, spec: RollSpec, action: RollAction): RollSpec {
  if (action.kind === "initiative" || action.kind === "conditionSave") return spec; // a save mid-round: the round counts help itself
  const help = db.prepare<[number], { token_id: number; by_name: string }>("SELECT a.token_id, a.by_name FROM assists a JOIN map_tokens t ON t.id = a.token_id WHERE t.character_id = ?").get(characterId);
  if (!help) return spec;
  clearAssist(help.token_id);
  return { ...spec, mode: spec.mode === "disadvantage" ? "normal" : "advantage", label: `${spec.label} (helped by ${help.by_name})` };
}

/**
 * Help (Assist) given while the helped character has a roll waiting that isn't rolled yet (not initiative): it applies
 * to that one (advantage, "helped by …") and is used up. Returns whether it did.
 */
export function assistOpenRequest(tokenId: number): boolean {
  const r = db
    .prepare<[number], { id: number; spec: string; action: string; character_id: number }>(
      "SELECT r.id, r.spec, r.action, r.character_id FROM roll_requests r JOIN map_tokens t ON t.character_id = r.character_id WHERE t.id = ? AND r.done = 0 AND r.result IS NULL ORDER BY r.id DESC LIMIT 1"
    )
    .get(tokenId);
  if (!r) return false;
  const spec = withAssist(r.character_id, JSON.parse(r.spec) as RollSpec, JSON.parse(r.action) as RollAction);
  if (spec.label === (JSON.parse(r.spec) as RollSpec).label) return false; // not helped (initiative)
  db.prepare("UPDATE roll_requests SET spec = ? WHERE id = ?").run(JSON.stringify(spec), r.id);
  return true;
}

export function requestRoll(playerId: number, characterId: number, spec: RollSpec, action: RollAction): void {
  spec = withAssist(characterId, spec, action);
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

/** The open condition save asked of whoever plays this token, if they haven't rolled it. */
export function openConditionSaveRequest(tokenId: number): RollRequest | undefined {
  return db.prepare<[], RollRequestRow>("SELECT id, player_id, character_id, spec, action, result FROM roll_requests WHERE done = 0 AND result IS NULL ORDER BY id DESC").all()
    .map(parseRequest).find((r) => r.action.kind === "conditionSave" && r.action.tokenId === tokenId);
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
