import { test } from "node:test";
import assert from "node:assert/strict";
import { actionSentence, gearSummary } from "@/lib/actionSummary";
import type { GearAction } from "@/lib/roundPlan";

const base: GearAction = { id: 1, name: "x", seconds: 2, range: 1, attack: null, damage: null, roll: "normal" };
const status = (s: object) => ({ source: "x", boosts: [], grants: [], ...s }) as never;
const cond = (name: string) => ({ name, effects: [] }) as never;

test("an attack reads as a strike, with what a hit leaves", () => {
  const g = { ...base, name: "Aimed shot", range: 12, attack: "2", damage: "1d8", damageType: "piercing",
    targeting: { who: "enemy" as const, count: "one" as const, n: 1 }, statuses: { minutes: 1, target: status({ conditions: [cond("Bleeding")] }) } };
  assert.equal(actionSentence(g), "On a successful attack roll (+2), strikes one enemy within 60 feet for 1d8 piercing damage. A hit also applies Bleeding to the target. Takes 2 seconds.");
  assert.equal(gearSummary(g)[0], actionSentence(g));
});

test("an area reads as who it hits, the save and the damage", () => {
  const g = { ...base, name: "Fireball", range: 30, damage: "8d6", damageType: "fire", area: { shape: "circle" as const, ft: 20, dc: 15, save: "agility" as const, half: true } };
  assert.equal(actionSentence(g), "Fills a 20-foot radius up to 150 feet away. Everyone in it makes an Agility save (DC 15) or takes 8d6 fire damage, half on a success. Takes 2 seconds.");
});

test("a condition with no damage says there's no roll", () => {
  const g = { ...base, name: "Mesmerize", range: 6, statuses: { minutes: 1, target: status({ conditions: [cond("Mesmerized")] }) } };
  assert.equal(actionSentence(g), "Applies Mesmerized to one creature within 30 feet, no roll needed. Takes 2 seconds.");
});

test("healing on yourself or others", () => {
  const g = { ...base, name: "Healing Draught", targets: "anyone" as const, statuses: { minutes: 0, target: status({ boosts: [{ target: "health", value: "+2d4" }] }) } };
  assert.equal(actionSentence(g), "Heals one target creature within 5 feet for 2d4, no roll needed. Takes 2 seconds.");
});

test("a plain melee attack reads in one sentence", () => {
  const g = { ...base, name: "Club", damage: "1d8", damageType: "bludgeoning" };
  assert.deepEqual(gearSummary(g), ["On a successful attack roll, strikes one creature within 5 feet for 1d8 bludgeoning damage. Takes 2 seconds."]);
});

test("a named effect is said in plain words, once", () => {
  const mesmerized = { name: "Mesmerized", id: 5, rounds: 10, duration: "rounds", effects: [{ id: 5, name: "Mesmerized", description: "", modifiers: [{ kind: "boost", target: "attribute:intellect", value: "-2" }, { kind: "roll", roll: "attack", mode: "disadvantage" }] }] };
  const g = { ...base, name: "Mesmerize", range: 6, statuses: { minutes: 1, target: status({ conditions: [mesmerized] }) } };
  assert.equal(actionSentence(g), "Applies Mesmerized (-2 Intellect and disadvantage on attack rolls for 10 rounds) to one creature within 30 feet, no roll needed. Takes 2 seconds.");
});

test("a reaction on yourself", () => {
  const g = { ...base, name: "Shield", self: true, kind: "reaction" as const, statuses: { minutes: 0.1, self: status({ conditions: [cond("Shielded")] }) } };
  assert.equal(actionSentence(g), "As a reaction: applies Shielded to you. Takes 2 seconds.");
});

test("settings that don't apply stay off the card", async () => {
  const { gearOf } = await import("@/lib/actionCard");
  const fields = {
    name: "Mesmerize", description: "", roll: "advantage" as const, attack: "2", damage: null, damage_type: "fire" as const, radius: 0, split: 0 as const,
    boosts: [], roll_grants: [], duration_amount: 3, duration_unit: "hour" as const, seconds: 2, range_ft: 30,
    area_shape: "circle" as const, area_ft: 0, save_dc: 12, save_attr: "agility" as const, save_half: 1 as const, area_lasts: 1 as const, area_fires: "end",
    target_who: "" as const, target_count: "one" as const, target_n: 2, kind: "action" as const, targets: "" as const, conditions: [{ id: 5, on: "target" as const }],
  };
  const card = actionSentence(gearOf(fields, () => ({ name: "Mesmerized", id: 5, effects: [] }) as never));
  assert.equal(card, "Applies Mesmerized to one creature within 30 feet, no roll needed. Takes 2 seconds.");
  assert.doesNotMatch(card, /DC|to hit|advantage|fire|hour|Agility/);
});

test("bonus and free actions say so", () => {
  const g = { ...base, name: "Second wind", self: true, kind: "bonus" as const, statuses: { minutes: 0.1, self: status({ boosts: [{ target: "health", value: "+1d10" }] }) } };
  assert.equal(actionSentence(g), "As a bonus action: heals you for 1d10. Takes 2 seconds.");
  assert.match(actionSentence({ ...g, kind: "free" }), /^As a free action: /);
});
