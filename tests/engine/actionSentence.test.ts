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
  assert.equal(actionSentence(g), "Strikes one enemy within 60 ft: +2 to hit, 1d8 piercing. On a hit: Puts Bleeding on them.");
  assert.equal(gearSummary(g)[0], actionSentence(g));
});

test("an area reads as who it hits, the save and the damage", () => {
  const g = { ...base, name: "Fireball", range: 30, damage: "8d6", damageType: "fire", area: { shape: "circle" as const, ft: 20, dc: 15, save: "agility" as const, half: true } };
  assert.equal(actionSentence(g), "Hits everyone in a 20 ft radius up to 150 ft away: Agility save DC 15, 8d6 fire, half on a save.");
});

test("a condition with no damage says there's no roll", () => {
  const g = { ...base, name: "Mesmerize", range: 6, statuses: { minutes: 1, target: status({ conditions: [cond("Mesmerized")] }) } };
  assert.equal(actionSentence(g), "Puts Mesmerized on one creature within 30 ft. No roll.");
});

test("healing on yourself or others", () => {
  const g = { ...base, name: "Healing Draught", targets: "anyone" as const, statuses: { minutes: 0, target: status({ boosts: [{ target: "health", value: "+2d4" }] }) } };
  assert.equal(actionSentence(g), "Heals you or one creature 2d4 within reach. No roll.");
});

test("a reaction on yourself", () => {
  const g = { ...base, name: "Shield", self: true, kind: "reaction" as const, statuses: { minutes: 0.1, self: status({ conditions: [cond("Shielded")] }) } };
  assert.equal(actionSentence(g), "Reaction: Puts Shielded on you.");
});
