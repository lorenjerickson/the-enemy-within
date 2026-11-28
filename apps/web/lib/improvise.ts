/**
 * Improvise (backlog N): a player wants to do something the rules don't cover ("tip the oil barrel toward the door").
 * They ask with a line of intent; the GM is told and the two settle it at the table, and the app records what was
 * agreed. While one is open, that player's planning clock waits.
 */
import { db } from "@/lib/db/connection";
import { getTokenActor } from "@/lib/db/tokens";
import { saveRollFor, skillCheckFor } from "@/lib/creatureChanges";
import type { RollSpec } from "@/lib/rolls";
import type { Attributes } from "@/lib/attributes";
import type { TriggerOutcome } from "@/lib/triggers";
import type { Template } from "@/lib/templates";
export { templateArea, shifted, type Template } from "@/lib/templates";
import type { AreaAt, LastingArea } from "@/lib/aoe";
import type { Effect } from "@/lib/conditions";

db.exec(`CREATE TABLE IF NOT EXISTS improvisations (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'asked', -- asked (waiting on the GM) | agreed | missed (the GM places where it lands) | done | dropped
  details TEXT -- JSON: what was agreed
)`);
try { db.exec("ALTER TABLE improvisations ADD COLUMN rolled TEXT"); } catch { /* there already */ }
try { db.exec("ALTER TABLE improvisations ADD COLUMN placed TEXT"); } catch { /* there already */ } // where its template was put
try { db.exec("ALTER TABLE improvisations ADD COLUMN result TEXT"); } catch { /* there already */ } // what the improviser was told when it played out (until they've seen it)

/**
 * How the GM decides an improvisation plays out in the rules (more kinds as play needs them; "place an area" next):
 * narrative only (the GM describes it), a script (the library's too), map changes (as triggers make), or an effect from
 * the catalogue on the improviser or someone else.
 */
export type ImproviseOutcome =
  | { kind: "narrative"; text: string }
  | { kind: "script"; script: string }
  | { kind: "map"; outcomes: TriggerOutcome[] }
  | { kind: "effect"; effect: number; on: "self" | "target"; target?: number; copy?: Effect } // copy: the agreed effect as tuned (backlog W)
  | { kind: "area"; template: Template; settings: AreaSettings }; // place an area: the player places the template, the GM can move it

/** What a placed area does: as the GM's Areas settings (name, look, damage, save, effects, timings, lingering, flammable, who sees it), lasting `minutes` (0: until removed). */
export type AreaSettings = Omit<LastingArea, "id" | "area" | "ends" | "conditions"> & { minutes: number; effectIds?: number[] }; // effectIds: catalogue effects put on whoever fails its save



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
  go?: boolean; // a template to place: the GM has gone ahead with where it was put (then the roll)
}

export interface Improvisation {
  id: number;
  level_id: number;
  token_id: number;
  intent: string;
  status: "asked" | "agreed" | "missed" | "done" | "dropped"; // asked: waiting on the GM; agreed: settled (to roll, plan or do); missed: a plain miss, the GM places where it lands
  agreed?: Agreed;
  rolled?: { total: number; natural: number }; // the player's roll (its outcome isn't shown to them until it plays out)
  placed?: { x: number; y: number }; // where the player put its template (the GM may move it)
}

/** Whether its template still needs placing (an area outcome on success or failure, not yet put down). */
export const needsPlacing = (i: Improvisation) => !i.placed && [i.agreed?.success, i.agreed?.failure].some((o) => o?.kind === "area");
/** The template to place (the success one, else the failure one). */
export const templateOf = (i: Improvisation): Template | undefined => [i.agreed?.success, i.agreed?.failure].find((o): o is Extract<ImproviseOutcome, { kind: "area" }> => o?.kind === "area")?.template;

const COLS = "id, level_id, token_id, intent, status, details, rolled, placed";
type Row = { id: number; level_id: number; token_id: number; intent: string; status: Improvisation["status"]; details: string | null; rolled: string | null; placed: string | null };
const parse = (r: Row | undefined): Improvisation | undefined =>
  r && { id: r.id, level_id: r.level_id, token_id: r.token_id, intent: r.intent, status: r.status, ...(r.details ? { agreed: JSON.parse(r.details) as Agreed } : {}), ...(r.rolled ? { rolled: JSON.parse(r.rolled) } : {}), ...(r.placed ? { placed: JSON.parse(r.placed) } : {}) };

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
  db.prepare("UPDATE improvisations SET status = 'agreed', details = ?, rolled = NULL, placed = NULL WHERE id = ?").run(JSON.stringify(agreed), id);
}

/** Its template is put down (by the player, or moved by the GM). */
export const setImprovisePlaced = (id: number, at: { x: number; y: number }): void => void db.prepare("UPDATE improvisations SET placed = ? WHERE id = ?").run(JSON.stringify({ x: at.x, y: at.y }), id);

/** A plain miss (not a natural 1) whose failure places an area: the GM picks where it lands (a natural 1 goes astray at random). */
export const gmPlacesMiss = (i: Improvisation) => !!i.agreed?.roll && !!i.rolled && i.rolled.natural !== 1 && !rollSucceeds(i.agreed.roll, i.rolled) && i.agreed.failure?.kind === "area";

/** It missed: waiting for the GM to place where it lands. */
export const markImproviseMissed = (id: number): void => void db.prepare("UPDATE improvisations SET status = 'missed' WHERE id = ?").run(id);

/** Improvisations on a level that missed, waiting for the GM to place where they land. */
export const listMissedImprovisations = (levelId: number): Improvisation[] =>
  db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE level_id = ? AND status = 'missed' ORDER BY id`).all(levelId).map((r) => parse(r)!);

/** The GM goes ahead with where its template was put. */
export function goAheadImprovisation(id: number): void {
  const i = getImprovisation(id);
  if (i?.agreed) db.prepare("UPDATE improvisations SET details = ? WHERE id = ?").run(JSON.stringify({ ...i.agreed, go: true }), id);
}

/** Whether it's waiting on its template: to be placed, or for the GM to go ahead with it. */
export const waitingOnTemplate = (i: Improvisation) => !!templateOf(i) && (!i.placed || !i.agreed?.go);

/** Settled improvisations on a level not yet played out (the GM's list: placing, going ahead). */
export const listAgreedImprovisations = (levelId: number): Improvisation[] =>
  db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE level_id = ? AND status = 'agreed' ORDER BY id`).all(levelId).map((r) => parse(r)!);

/** The player's roll came in (kept; its outcome is shown when it plays out). */
export const setImproviseRolled = (id: number, rolled: { total: number; natural: number }): void => void db.prepare("UPDATE improvisations SET rolled = ? WHERE id = ?").run(JSON.stringify(rolled), id);

/** It has played out. */
export const finishImprovisation = (id: number, result = ""): void => void db.prepare("UPDATE improvisations SET status = 'done', result = ? WHERE id = ?").run(result || null, id);

/** How a token's last improvisation went, until they've seen it. */
export const improvisationResult = (tokenId: number): { id: number; text: string } | undefined =>
  db.prepare<[number], { id: number; text: string }>("SELECT id, result AS text FROM improvisations WHERE token_id = ? AND status = 'done' AND result IS NOT NULL ORDER BY id DESC").get(tokenId);
export const seenImprovisationResult = (id: number): void => void db.prepare("UPDATE improvisations SET result = NULL WHERE id = ?").run(id);

/** Every open ask on a level (the GM's list). */
export const listOpenImprovisations = (levelId?: number): Improvisation[] =>
  levelId === undefined
    ? db.prepare<[], Row>(`SELECT ${COLS} FROM improvisations WHERE status = 'asked' ORDER BY id`).all().map((r) => parse(r)!)
    : db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE level_id = ? AND status = 'asked' ORDER BY id`).all(levelId).map((r) => parse(r)!);

/** The player takes it back, or the GM turns it down. */
export const dropImprovisation = (id: number): void => void db.prepare("UPDATE improvisations SET status = 'dropped' WHERE id = ?").run(id);

export const getImprovisation = (id: number): Improvisation | undefined => parse(db.prepare<[number], Row>(`SELECT ${COLS} FROM improvisations WHERE id = ?`).get(id));

/** The dice an improvisation's roll needs, for its improviser (null: no roll). */
export function improviseRollSpec(i: Improvisation): RollSpec | null {
  const r = i.agreed?.roll, me = getTokenActor(i.token_id);
  if (!r || !me) return null;
  const spec = r.type === "check" ? skillCheckFor(i.token_id, r.skill, JSON.parse(me.attributes) as Attributes) : saveRollFor(i.token_id, r.attribute as never, "");
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return { ...spec, label: `${i.agreed!.name}: ${r.type === "check" ? cap(r.skill) : `${cap(r.attribute)} ${r.type}`}` };
}
