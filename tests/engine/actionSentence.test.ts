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
