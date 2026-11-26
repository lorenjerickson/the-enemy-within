import type { Trap, TrapArea } from "@/lib/traps";
import { db } from "@/lib/db/connection";
import type { MapTrigger } from "@/lib/triggers";
import { areaFires } from "@/lib/aoe";

 // JSON token ids: who saw it go off (their players see it; others don't)
type TrapRow = Omit<Trap, "area" | "springs" | "effects" | "sprung" | "seen_by"> & { area: string; springs: string; effects: string; sprung: string; seen_by: string };

const parseTrap = (r: TrapRow): Trap => ({ ...r, area: JSON.parse(r.area), springs: r.springs ? areaFires(r.springs) : [] /* none: only a trigger sets it off */, effects: JSON.parse(r.effects), sprung: JSON.parse(r.sprung), seen_by: JSON.parse(r.seen_by ?? "[]") });

/** A level's traps. */
export function listTraps(levelId: number): Trap[] {
  return db.prepare<[number], TrapRow>("SELECT * FROM map_traps WHERE level_id = ? ORDER BY id").all(levelId).map(parseTrap);
}

export function getTrap(id: number): (Trap & { level_id: number }) | undefined {
  const r = db.prepare<[number], TrapRow & { level_id: number }>("SELECT * FROM map_traps WHERE id = ?").get(id);
  return r ? { ...parseTrap(r), level_id: r.level_id } : undefined;
}

/** Places a trap (the rest as the defaults: springs on entering, once, Agility DC 12 for half, stops the mover, DC 14 to find); returns its id. */
export function addTrap(levelId: number, area: TrapArea, name = "Trap"): number {
  return Number(db.prepare("INSERT INTO map_traps (level_id, name, area) VALUES (?, ?, ?)").run(levelId, name, JSON.stringify(area)).lastInsertRowid);
}

/** Saves what a trap does (not where it is, whether it's found, or whom it has sprung on). */
export function saveTrap(id: number, t: Omit<Trap, "id" | "area" | "found" | "sprung">): void {
  db.prepare(`UPDATE map_traps SET name = @name, springs = @springs, who = @who, often = @often, damage = @damage, damage_type = @damage_type,
    save_attr = @save_attr, save_dc = @save_dc, save_half = @save_half, effects = @effects, stops = @stops, find_dc = @find_dc WHERE id = @id`)
    .run({ ...t, springs: t.springs.join(","), effects: JSON.stringify(t.effects), damage: t.damage || null, id });
}

export function moveTrap(id: number, area: TrapArea): void {
  db.prepare("UPDATE map_traps SET area = ? WHERE id = ?").run(JSON.stringify(area), id);
}

export function deleteTrap(id: number): void {
  db.prepare("DELETE FROM map_traps WHERE id = ?").run(id);
}

/** Found (by a Search) or revealed by the GM: players see it; hidden again (false). */
export function setTrapFound(id: number, found: boolean): void {
  db.prepare("UPDATE map_traps SET found = ? WHERE id = ?").run(found ? 1 : 0, id);
}

/** Who saw a trap go off (added to those who already had): their players see it on the map. */
export function trapSeenBy(id: number, tokenIds: number[]): void {
  const t = getTrap(id);
  if (!t) return;
  db.prepare("UPDATE map_traps SET seen_by = ? WHERE id = ?").run(JSON.stringify([...new Set([...(t.seen_by ?? []), ...tokenIds])]), id);
}

/** Records that a trap sprang on a token (spending it, or spending it for them). */
export function markTrapSprung(id: number, tokenId: number): void {
  const t = getTrap(id);
  if (t && !t.sprung.includes(tokenId)) db.prepare("UPDATE map_traps SET sprung = ? WHERE id = ?").run(JSON.stringify([...t.sprung, tokenId]), id);
}

/** Re-arms a trap (whom it has sprung on is forgotten). */
export function resetTrap(id: number): void {
  db.prepare("UPDATE map_traps SET sprung = '[]' WHERE id = ?").run(id);
}

 // fires when someone within reach Interacts with it
type MapTriggerRow = Omit<MapTrigger, "area" | "springs" | "outcomes" | "sprung" | "interact"> & { area: string; springs: string; outcomes: string; sprung: string; interact: number };

const parseTrigger = (r: MapTriggerRow): MapTrigger => ({ ...r, area: JSON.parse(r.area), springs: areaFires(r.springs), outcomes: JSON.parse(r.outcomes), sprung: JSON.parse(r.sprung), interact: !!r.interact });

/** A level's map triggers. */
export function listMapTriggers(levelId: number): MapTrigger[] {
  return db.prepare<[number], MapTriggerRow>("SELECT * FROM map_triggers WHERE level_id = ? ORDER BY id").all(levelId).map(parseTrigger);
}

export function getMapTrigger(id: number): (MapTrigger & { level_id: number }) | undefined {
  const r = db.prepare<[number], MapTriggerRow & { level_id: number }>("SELECT * FROM map_triggers WHERE id = ?").get(id);
  return r ? { ...parseTrigger(r), level_id: r.level_id } : undefined;
}

/** Places a map trigger (springs on entering, once, doing nothing until it's given outcomes); returns its id. */
export function addMapTrigger(levelId: number, area: TrapArea, name = "Trigger"): number {
  return Number(db.prepare("INSERT INTO map_triggers (level_id, name, area) VALUES (?, ?, ?)").run(levelId, name, JSON.stringify(area)).lastInsertRowid);
}

/** Saves when a map trigger fires, for whom, how often, and what it does. */
export function saveMapTrigger(id: number, t: Omit<MapTrigger, "id" | "area" | "sprung">): void {
  db.prepare("UPDATE map_triggers SET name = @name, springs = @springs, who = @who, often = @often, outcomes = @outcomes, interact = @interact WHERE id = @id")
    .run({ ...t, springs: t.springs.join(","), outcomes: JSON.stringify(t.outcomes), interact: t.interact ? 1 : 0, id });
}

export function deleteMapTrigger(id: number): void {
  db.prepare("DELETE FROM map_triggers WHERE id = ?").run(id);
}

/** Records that a map trigger fired for a token. */
export function markMapTriggerSprung(id: number, tokenId: number): void {
  const t = getMapTrigger(id);
  if (t && !t.sprung.includes(tokenId)) db.prepare("UPDATE map_triggers SET sprung = ? WHERE id = ?").run(JSON.stringify([...t.sprung, tokenId]), id);
}

/** Re-arms a map trigger (whom it has fired for is forgotten). */
export function resetMapTrigger(id: number): void {
  db.prepare("UPDATE map_triggers SET sprung = '[]' WHERE id = ?").run(id);
}
