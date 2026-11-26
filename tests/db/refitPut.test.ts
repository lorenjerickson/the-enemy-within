import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, item, level } from "./seed";
import { addCreatureToken, placeCharacterToken } from "@/lib/db/tokens";
import { addToContainer, characterContainers, getCharacter, saveAction } from "@/lib/db/catalog";
import { getRoundPlan } from "@/lib/db/rounds";
import { saveEncounter } from "@/lib/db/encounters";
import { gearActions, putOptions, saveRefit, useUpItem } from "@/lib/combat";
import { addPlanStep, plannedEquipment, tokenPlanner } from "@/lib/roundPlanServer";
import { afterRefits } from "@/lib/roundPlan";

const act = (name: string) => ({ name, description: "", roll: "normal", attack: null, damage: null, damage_type: "", radius: 0, split: 0, boosts: [], roll_grants: [], duration_amount: 1, duration_unit: "", seconds: 2, range_ft: 5, area_shape: "", area_ft: 0, save_dc: 12, save_attr: "agility", save_half: 1, area_lasts: 0, area_fires: "end", targets: "anyone", target_who: "", target_count: "one", target_n: 1, conditions: [], kind: "action" }) as never;


const pack = item({ name: "Pack", type: "container", capacity: 4, slots: ["back"] });
const pouch = item({ name: "Pouch", type: "container", capacity: 1, slots: ["waist"] });
const belt = item({ name: "Belt", type: "container", capacity: 4, slots: ["waist"] });
const salts = item({ name: "Salts", type: "consumable", max_stack: 5 });
const rope = item({ name: "Rope" });
const lamp = item({ name: "Lamp", slots: ["off hand"], hands: 1 });
saveAction(null, { item_id: salts }, Object.assign(act("Revive"), { targets: "self" }) as never);
saveAction(null, { item_id: lamp }, act("Shine"));

const setup = (waist = belt) => {
  const lv = level("Hall"), id = character("Ada", { equipment: { back: pack, waist, "off hand": lamp } });
  addToContainer(id, pack, salts, 2);
  addToContainer(id, pack, rope, 1);
  const me = placeCharacterToken(lv, id, 0, 0), rat = addCreatureToken(lv, creature("Rat"), 6, 0);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: me, initiative: 15 }, { token_id: rat, initiative: 8 }] });
  const qty = (c: number, it: number) => characterContainers(id).find((x) => x.container.id === c)!.stacks.filter((s) => s.item.id === it).reduce((n, s) => n + s.qty, 0);
  return { id, me, plan: () => getRoundPlan(lv, me).plan, p: () => tokenPlanner(me)!, qty };
};
const revive = (tok: number) => gearActions(tok, undefined, { packs: true }).find((g) => g.name === "Revive")!.id;

test("Refit brings one thing out of a pack onto the belt; Use can reach it from then on", () => {
  const a = setup();
  assert.notEqual(addPlanStep(a.p(), { kind: "action", action: "use", use: revive(a.me) }), null, "still in the pack: out of reach");
  assert.equal(addPlanStep(a.p(), { kind: "action", action: "refit", put: { item: salts, from: pack, into: belt } }), null);
  assert.deepEqual((a.plan()[0] as { put?: unknown }).put, { item: { id: salts, name: "Salts" }, from: { id: pack, name: "Pack" }, into: { id: belt, name: "Belt" }, belt: true });
  assert.equal(addPlanStep(a.p(), { kind: "action", action: "use", use: revive(a.me) }), null, "on the belt now");
});

test("pack to belt is refused without a belt, with no room on it, or once the pack's run out", () => {
  const none = setup(null as never);
  assert.equal(putOptions(none.me, plannedEquipment(none.p()), []).belt, null);
  const small = setup(pouch);
  addToContainer(small.id, pouch, rope, 1);
  assert.equal(addPlanStep(small.p(), { kind: "action", action: "refit", put: { item: salts, from: pack, into: pouch } }), "No room on Pouch");
  const o = putOptions(small.me, plannedEquipment(small.p()), []);
  assert.equal(o.fromPacks.find((f) => f.item.id === salts)?.room, false);
  const rope2 = setup();
  assert.equal(putOptions(rope2.me, plannedEquipment(rope2.p()), []).fromPacks.some((f) => f.item.id === rope), true);
});

test("putting away something equipped empties the slot (its actions go) and needs room where it goes", () => {
  const a = setup();
  const o = putOptions(a.me, plannedEquipment(a.p()), []);
  assert.deepEqual(o.away.find((x) => x.slot === "off hand")?.into.map((c) => c.name).sort(), ["Belt", "Pack"]);
  assert.equal(o.away.some((x) => x.item.id === pack || x.item.id === belt), false, "containers stay worn");
  assert.equal(addPlanStep(a.p(), { kind: "action", action: "refit", put: { item: lamp, slot: "off hand", into: pack } }), null);
  const eq = plannedEquipment(a.p());
  assert.equal(eq["off hand"], null);
  assert.equal(afterRefits(getCharacter(a.id)!.equipment, a.plan())["off hand"], null);
  assert.equal(gearActions(a.me, eq).some((g) => g.name === "Shine"), false);
});

test("after the round: the put is kept; something moved up and used the same round comes off the belt", () => {
  const a = setup();
  const eq = getCharacter(a.id)!.equipment;
  saveRefit(a.me, eq, undefined, eq, { item: { id: salts, name: "Salts" }, from: { id: pack, name: "Pack" }, into: { id: belt, name: "Belt" }, belt: true });
  assert.equal(useUpItem(a.me, { id: salts, where: "belt", container: belt }), true);
  assert.equal(a.qty(pack, salts), 1);
  assert.equal(a.qty(belt, salts), 0);
  saveRefit(a.me, { ...eq, "off hand": null }, undefined, eq, { item: { id: lamp, name: "Lamp" }, slot: "off hand", into: { id: pack, name: "Pack" }, belt: false });
  assert.equal(getCharacter(a.id)!.equipment["off hand"] ?? null, null);
  assert.equal(a.qty(pack, lamp), 1);
});
