import { fireHazards, fireReaches, ignite, inFogOf } from "@/lib/aoe";
import type { LastingArea } from "@/lib/aoe";
import { db } from "@/lib/db/connection";
import { getGameTime } from "@/lib/db/calendar";
import type { Exposures, Exposure } from "@/lib/exposure";
import { listEffects } from "@/lib/db/mapThings";
import { isActive, type Hazard } from "@/lib/hazards";

export function addLastingArea(levelId: number, a: Omit<LastingArea, "id">): number {
  const { name, ends, ...spec } = a;
  db.prepare("DELETE FROM hazards WHERE ends <= ?").run(getGameTime());
  return Number(db.prepare("INSERT INTO hazards (level_id, name, ends, spec) VALUES (?, ?, ?, ?)").run(levelId, name, ends, JSON.stringify(spec)).lastInsertRowid);
}

export function getExposures(levelId: number): Exposures {
  const r = db.prepare<[number], { data: string }>("SELECT data FROM level_exposure WHERE level_id = ?").get(levelId);
  return new Map(r ? (JSON.parse(r.data) as [number, Exposure[]][]) : []);
}

/** Levels where someone is still exposed to lingering harm (burning, poisoned…). */
export const exposedLevels = (): number[] => db.prepare<[], { level_id: number }>("SELECT level_id FROM level_exposure WHERE data != '[]'").all().map((r) => r.level_id);

export function saveExposures(levelId: number, all: Exposures): void {
  const data = [...all].filter(([, l]) => l.length);
  db.prepare("INSERT INTO level_exposure (level_id, data) VALUES (?, ?) ON CONFLICT (level_id) DO UPDATE SET data = excluded.data").run(levelId, JSON.stringify(data));
}

/** How far anyone sees in fog (feet): fog map effects are Obscured (the areas design, Q7). */
export const FOG_SIGHT_FT = 15;

/** Whether a spot (grid units, a token's centre) is in fog: a placed fog effect's oval, or fog over the whole map; switched on. */
export function inFog(levelId: number, p: { x: number; y: number }): boolean {
  return inFogOf(listEffects(levelId), p);
}

/**
 * Every area that does something on a level: its lasting areas, and placed fire map effects (switched on), which burn
 * whoever is in them like a lingering fire area (1d6 fire each interval, no save, +1 while inside, −2 after; the
 * areas design, Q7). A fire effect's area is the circle inside its rectangle; its id is the effect's, negated.
 */
export function listHazards(levelId: number): LastingArea[] {
  const now = getGameTime(); // those doing something now: switched on, not spent, always active or triggered and still active (dormant ones wait in hazards.ts)
  return [...listLastingAreas(levelId).filter((l) => isActive(l, now)), ...fireHazards(listEffects(levelId))];
}

/** One lasting area (or none, gone or run out). */
export function getLastingArea(id: number): (LastingArea & { level_id: number }) | undefined {
  const r = db.prepare<[number], { id: number; level_id: number; name: string; ends: number; spec: string }>("SELECT id, level_id, name, ends, spec FROM hazards WHERE id = ?").get(id);
  return r ? { id: r.id, level_id: r.level_id, name: r.name, ends: r.ends, ...JSON.parse(r.spec) } : undefined;
}

/** Fire reaches these flammable areas: each burns for a few rounds (`ignite`), then it's spent. */
export function igniteAreas(ids: number[]): void {
  for (const id of ids) {
    const a = getLastingArea(id);
    if (!a?.flammable) continue;
    const { id: _id, level_id: _l, ...rest } = a;
    updateLastingArea(id, ignite({ id, ...rest }, getGameTime()));
  }
}

/** Out of a round: any fire on the level (a fire area, a fire map effect) touching a flammable area sets it burning (and so on, as it spreads). */
export function spreadFire(levelId: number): void {
  for (let pass = 0; pass < 10; pass++) {
    const lit = fireReaches(listHazards(levelId));
    if (!lit.length) return;
    igniteAreas(lit);
  }
}

/** A lasting area switched on or off (a trigger, the GM). */
export function setLastingAreaOff(id: number, off: boolean): void {
  const a = getLastingArea(id);
  if (!a) return;
  const { id: _id, level_id: _l, ...rest } = a;
  updateLastingArea(id, { ...rest, off: off || undefined });
}

/** A hidden lasting area is found (players see it from now on). */
export function setLastingAreaFound(id: number): void {
  const a = getLastingArea(id);
  if (!a || a.found || (a.visibility ?? "shown") !== "hidden") return;
  const { id: _id, level_id: _l, ...rest } = a;
  updateLastingArea(id, { ...rest, found: true });
}

/** The GM changes a lasting area (everything but where it is). */
export function updateLastingArea(id: number, a: Omit<Hazard, "id">): void {
  const { name, ends, ...spec } = a;
  db.prepare<[string, number, string, number]>("UPDATE hazards SET name = ?, ends = ?, spec = ? WHERE id = ?").run(name, ends, JSON.stringify(spec), id);
}

/** Hazards (on any level) that a script condition activates or deactivates, with their levels. */
export function listScriptedHazards(): (Hazard & { level_id: number })[] {
  return db
    .prepare<[number], { id: number; level_id: number; name: string; ends: number; spec: string }>("SELECT id, level_id, name, ends, spec FROM hazards WHERE ends > ? AND (spec LIKE '%\"activatesWhen\":\"_%' OR spec LIKE '%\"deactivatesWhen\":\"_%') ORDER BY id")
    .all(getGameTime())
    .map((r) => ({ id: r.id, level_id: r.level_id, name: r.name, ends: r.ends, ...JSON.parse(r.spec) }));
}

/** A level's lasting areas still in effect. */
export function listLastingAreas(levelId: number): LastingArea[] {
  return db
    .prepare<[number, number], { id: number; name: string; ends: number; spec: string }>("SELECT id, name, ends, spec FROM hazards WHERE level_id = ? AND ends > ? ORDER BY id")
    .all(levelId, getGameTime())
    .map((r) => ({ id: r.id, name: r.name, ends: r.ends, ...JSON.parse(r.spec) }));
}

export function removeLastingArea(id: number): void {
  db.prepare("DELETE FROM hazards WHERE id = ?").run(id);
}
