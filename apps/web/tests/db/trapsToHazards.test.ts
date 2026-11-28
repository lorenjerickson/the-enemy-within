import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { db } from "@/lib/db/connection";
import { addMapTrigger, listMapTriggers, saveMapTrigger } from "@/lib/db/traps";

/** A trap as an older campaign stored it (the Traps layer is gone): a row in map_traps. */
function oldTrap(levelId: number, t: Record<string, unknown>): number {
  const row = { name: "Trap", springs: "enter", who: "", often: "once", damage: null, damage_type: "", save_attr: "agility", save_dc: 12, save_half: 1, effects: "[]", stops: 1, find_dc: 14, found: 0, sprung: "[]", seen_by: "[]", ...t };
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO map_traps (level_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`).run(levelId, ...cols.map((c) => (row as Record<string, unknown>)[c] as never)).lastInsertRowid);
}
import { saveEffectDef } from "@/lib/db/effects";
import { listLastingAreas } from "@/lib/db/areas";
import { trapsToHazards } from "@/lib/db/migrations";
import { isActive, mayCatch, setsOff, type Hazard } from "@/lib/hazards";

test("traps become dormant hazards: what set them off, who, how often, stops, found, damage and save, effects; spent ones dropped; triggers repointed", () => {
  const lv = level("Vault");
  const net = saveEffectDef(null, { name: "Netted", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 2 });
  oldTrap(lv, { name: "Spike pit", area: JSON.stringify({ shape: "rect", x: 3, y: 0, w: 1, h: 1 }), springs: "enter,end", who: "party", often: "each", damage: "2d6", damage_type: "piercing", save_dc: 13, effects: JSON.stringify([net]), find_dc: 15, found: 1, sprung: "[7]" });
  const lever = oldTrap(lv, { name: "Blade", area: JSON.stringify({ shape: "line", x1: 0, y1: 0, x2: 3, y2: 0 }), springs: "", often: "always", damage: "1d8", damage_type: "slashing", save_attr: "", stops: 0 });
  const spent = oldTrap(lv, { name: "Floor", area: JSON.stringify({ shape: "circle", x: 6, y: 6, r: 1 }), damage: "1d6", save_attr: "", sprung: "[3]" });
  const trig = addMapTrigger(lv, { shape: "rect", x: 9, y: 9, w: 1, h: 1 }, "Plate");
  saveMapTrigger(trig, { name: "Plate", springs: ["enter"], who: "", often: "always", outcomes: [{ kind: "trap", trap: lever }, { kind: "trap", trap: spent }, { kind: "stop" }] as never, interact: false }); // outcomes as an older campaign had them

  trapsToHazards();

  const hz = listLastingAreas(lv) as Hazard[];
  assert.deepEqual(hz.map((h) => h.name).sort(), ["Blade", "Spike pit"], "the spent floor is gone");
  const p = hz.find((h) => h.name === "Spike pit")!;
  assert.ok(setsOff(p, "enter") && setsOff(p, "end") && !setsOff(p, "start"));
  assert.ok(!isActive(p, 0), "dormant");
  assert.ok(!mayCatch(p, 7, "party") && mayCatch(p, 8, "party") && !mayCatch(p, 8, "hostile"));
  assert.equal(p.stops, true);
  assert.equal(p.found, true);
  assert.deepEqual([p.damage, p.damageType, p.save, p.dc, p.half], ["2d6", "piercing", "agility", 13, true]);
  assert.deepEqual(p.conditions?.map((c) => c.name), ["Netted"]);
  const b = hz.find((h) => h.name === "Blade")!;
  assert.ok(!setsOff(b, "enter") && b.byTrigger, "only a map trigger sets it off");
  assert.equal(b.dc, 99, "no save against its damage");
  assert.deepEqual(listMapTriggers(lv)[0].outcomes, [{ kind: "area", area: b.id, to: "set off" }, { kind: "stop" }]);
  assert.equal(db.prepare<[], { n: number }>("SELECT COUNT(*) n FROM map_traps").get()!.n, 0, "map_traps left empty");
});
