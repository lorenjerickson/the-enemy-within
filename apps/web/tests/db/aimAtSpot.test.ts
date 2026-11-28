import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, item, level } from "./seed";
import { addCreatureToken, placeCharacterToken } from "@/lib/db/tokens";
import { saveAction } from "@/lib/db/catalog";
import { getRoundPlan } from "@/lib/db/rounds";
import { saveEncounter } from "@/lib/db/encounters";
import { gearActions } from "@/lib/combat";
import { addPlanStep, tokenPlanner } from "@/lib/roundPlanServer";

const act = (name: string, o: object) => ({ name, description: "", roll: "normal", attack: "+2", damage: "1d4", damage_type: "", radius: 0, split: 0, boosts: [], roll_grants: [], duration_amount: 1, duration_unit: "", seconds: 2, range_ft: 5, area_shape: "", area_ft: 0, save_dc: 12, save_attr: "agility", save_half: 1, area_lasts: 0, area_fires: "end", targets: "anyone", target_who: "", target_count: "one", target_n: 1, conditions: [], kind: "action", ...o }) as never;
const torch = item({ name: "Torch", slots: ["main hand"], hands: 1 });
saveAction(null, { item_id: torch }, act("Throw torch", { range_ft: 30, damage_type: "fire" }));
saveAction(null, { item_id: torch }, act("Bash", {}));

test("a ranged attack can be aimed at a spot (in range); a melee one can't", () => {
  const lv = level("Cellar"), id = character("Ada", { equipment: { "main hand": torch } });
  const me = placeCharacterToken(lv, id, 0, 0), rat = addCreatureToken(lv, creature("Rat"), 9, 0);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: me, initiative: 15 }, { token_id: rat, initiative: 8 }] });
  const use = (n: string) => gearActions(me).find((g) => g.name === n)!.id, p = () => tokenPlanner(me)!;
  assert.equal(addPlanStep(p(), { kind: "action", action: "attack", use: use("Bash"), aim: { col: 1.2, row: 0.7 } }), "Only a ranged attack can be aimed at a spot");
  assert.equal(addPlanStep(p(), { kind: "action", action: "attack", use: use("Throw torch"), aim: { col: 8.2, row: 0.3 } }), "Out of range (30 ft)");
  assert.equal(addPlanStep(p(), { kind: "action", action: "attack", use: use("Throw torch"), aim: { col: 4.2, row: 0.3 } }), null);
  const step = getRoundPlan(lv, me).plan.at(-1)!;
  assert.ok(step.kind === "action" && !step.target && step.aim?.col === 4.5 && step.aim.row === 0.5, JSON.stringify(step));
});
