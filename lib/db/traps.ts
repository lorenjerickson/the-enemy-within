import type { TrapArea } from "@/lib/traps";
import { db } from "@/lib/db/connection";
import type { MapTrigger } from "@/lib/triggers";
import { areaFires } from "@/lib/aoe";

/* Map triggers (the Traps layer is gone: traps are hazards, lib/hazards.ts; map_traps is kept empty for older exports). */

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
