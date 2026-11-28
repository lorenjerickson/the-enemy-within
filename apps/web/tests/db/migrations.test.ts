import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db/connection";
import { listActions, saveAction } from "@/lib/db/catalog";
import { runMigrations } from "@/lib/db/migrations";

test("the action-boosts migration ran once and is recorded: boosts the action interview saves (Defend, Aid, Heal) stay", () => {
  assert.ok(db.prepare("SELECT 1 FROM migrations_done WHERE name = 'action-boosts-to-conditions'").get());
  db.exec("INSERT INTO creatures (id, name, type, attributes, equipment, health) VALUES (950, 'Medic', 'humanoid', '{}', '{}', '10')");
  saveAction(null, { creature_id: 950 }, {
    name: "Second wind", description: "", roll: "normal", attack: null, damage: null, damage_type: "", radius: 0, split: 0,
    boosts: [{ target: "health", value: "+1d10", on: "self" }], roll_grants: [], duration_amount: 1, duration_unit: "round", seconds: 1, range_ft: 0,
    area_shape: "", area_ft: 0, save_dc: 12, save_attr: "agility", save_half: 0, area_lasts: 0, area_fires: "", target_who: "", target_count: "one", target_n: 1,
    targets: "self", conditions: [], kind: "bonus",
  });
  runMigrations();
  assert.deepEqual(listActions({ creature_id: 950 })[0].boosts, [{ target: "health", value: "+1d10", on: "self" }]);
});
