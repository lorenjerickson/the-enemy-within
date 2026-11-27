import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { db } from "@/lib/db/connection";
import { addMapTrigger, addTrap, listMapTriggers, markTrapSprung, saveMapTrigger, saveTrap, setTrapFound } from "@/lib/db/traps";
import { saveEffectDef } from "@/lib/db/effects";
import { listLastingAreas } from "@/lib/db/areas";
import { trapsToHazards } from "@/lib/db/migrations";
import { isActive, mayCatch, setsOff, type Hazard } from "@/lib/hazards";

test("traps become dormant hazards: what set them off, who, how often, stops, found, damage and save, effects; spent ones dropped; triggers repointed", () => {
  const lv = level("Vault");
  const net = saveEffectDef(null, { name: "Netted", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 2 });
  const pit = addTrap(lv, { shape: "rect", x: 3, y: 0, w: 1, h: 1 }, "Spike pit");
  saveTrap(pit, { name: "Spike pit", springs: ["enter", "end"], who: "party", often: "each", damage: "2d6", damage_type: "piercing", save_attr: "agility", save_dc: 13, save_half: 1, effects: [net], stops: 1, find_dc: 15 });
  markTrapSprung(pit, 7);
  setTrapFound(pit, true);
  const lever = addTrap(lv, { shape: "line", x1: 0, y1: 0, x2: 3, y2: 0 }, "Blade");
  saveTrap(lever, { name: "Blade", springs: [], who: "", often: "always", damage: "1d8", damage_type: "slashing", save_attr: "", save_dc: 12, save_half: 1, effects: [], stops: 0, find_dc: 14 });
  const spent = addTrap(lv, { shape: "circle", x: 6, y: 6, r: 1 }, "Floor");
  saveTrap(spent, { name: "Floor", springs: ["enter"], who: "", often: "once", damage: "1d6", damage_type: "", save_attr: "", save_dc: 12, save_half: 1, effects: [], stops: 1, find_dc: 14 });
  markTrapSprung(spent, 3);
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
