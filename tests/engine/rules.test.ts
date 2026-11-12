import { test } from "node:test";
import assert from "node:assert/strict";
import { allegianceOf, describeTargeting, fits, maxPicks, picksSeveral, relation } from "@/lib/sides";
import { defaultAttributes, formatModifier, modifier, pointBuySpent, skillModifiers } from "@/lib/attributes";
import { boostsOn, combineModes, critImmune, critRange, d20Tweaks, settled, type Status } from "@/lib/status";
import { takeDamage } from "@/lib/health";

const status = (s: Partial<Status>): Status => ({ source: "Test", boosts: [], grants: [], ...s });

test("allegiance defaults: characters with the party, creatures hostile", () => {
  assert.equal(allegianceOf({ character_id: 3 }), "party");
  assert.equal(allegianceOf({ character_id: null }), "hostile");
  assert.equal(allegianceOf({ character_id: null, allegiance: "neutral" }), "neutral");
  assert.equal(allegianceOf({ character_id: 3, allegiance: "nonsense" }), "party");
});

test("relations between sides", () => {
  assert.equal(relation("party", "party"), "friendly");
  assert.equal(relation("party", "hostile"), "enemy");
  assert.equal(relation("hostile", "neutral"), "neutral");
  assert.equal(relation("neutral", "neutral"), "friendly");
  assert.ok(fits("", "neutral"));
  assert.ok(fits("enemy", "enemy"));
  assert.ok(!fits("enemy", "friendly"));
});

test("targeting descriptions and how many to pick", () => {
  assert.equal(describeTargeting({ who: "enemy", count: "upto", n: 3 }, false), "up to 3 enemies in range");
  assert.equal(describeTargeting({ who: "friendly", count: "all", n: 0 }, true), "all friendlies in its area");
  assert.equal(describeTargeting({ who: "", count: "one", n: 1 }, false), "one creature in range");
  assert.equal(describeTargeting({ who: "enemy", count: "exactly", n: 1 }, false), "exactly 1 enemy in range");
  assert.ok(picksSeveral({ who: "", count: "upto", n: 2 }));
  assert.ok(!picksSeveral({ who: "", count: "upto", n: 1 }));
  assert.equal(maxPicks({ who: "", count: "all", n: 0 }), Infinity);
  assert.equal(maxPicks(undefined), 1);
  assert.equal(maxPicks({ who: "", count: "exactly", n: 3 }), 3);
});

test("attribute modifiers, point buy and skills", () => {
  assert.equal(modifier(10), 0);
  assert.equal(modifier(11), 0);
  assert.equal(modifier(9), -1);
  assert.equal(modifier(20), 5);
  assert.equal(modifier(1), -5);
  assert.equal(formatModifier(2), "+2");
  assert.equal(formatModifier(-1), "-1");
  assert.equal(pointBuySpent(defaultAttributes(8)), 0);
  assert.equal(pointBuySpent({ ...defaultAttributes(8), might: 15 }), 9);
  assert.equal(pointBuySpent(defaultAttributes(16)), Infinity);
  const skills = skillModifiers({ ...defaultAttributes(10), intellect: 8, fortitude: 14 });
  const medicine = skills.find((s) => s.skill === "medicine")!;
  assert.equal(medicine.modifier, 2, "a skill under two attributes uses the better");
  assert.deepEqual(medicine.attributes.sort(), ["fortitude", "intellect"]);
  assert.deepEqual(skills.map((s) => s.skill), [...skills.map((s) => s.skill)].sort((a, b) => a.localeCompare(b)));
});

test("damage takes temporary health first; negative damage heals", () => {
  assert.deepEqual(takeDamage({ current: 10, maximum: 10, temporary: 3 }, 5), { current: 8, maximum: 10, temporary: 0 });
  assert.deepEqual(takeDamage({ current: 10, maximum: 10, temporary: 3 }, 2), { current: 10, maximum: 10, temporary: 1 });
  assert.deepEqual(takeDamage({ current: 4, maximum: 10, temporary: 2 }, -3), { current: 7, maximum: 10, temporary: 2 });
});

test("advantage and disadvantage: one of each cancels out", () => {
  const adv = status({ grants: [{ roll: "attack", mode: "advantage" }] as any });
  const dis = status({ grants: [{ roll: "attack", mode: "disadvantage" }] as any });
  assert.equal(combineModes("normal", [adv], "attack"), "advantage");
  assert.equal(combineModes("normal", [adv, dis], "attack"), "normal");
  assert.equal(combineModes("disadvantage", [adv], "attack"), "normal");
  assert.equal(combineModes("normal", [adv], "save:might"), "normal", "grants for other rolls don't count");
  assert.equal(combineModes("normal", [], "attack", ["disadvantage"]), "disadvantage");
});

test("settled: becomes (highest, if higher), then caps (lowest), then factors", () => {
  const sets = [status({ source: "Ogre gloves", sets: [{ target: "attribute:might", value: 19 }] })];
  assert.deepEqual(settled(12, sets, "attribute:might"), { value: 19, note: " [becomes 19 (Ogre gloves)]" });
  assert.equal(settled(20, sets, "attribute:might").value, 20, "already higher");
  const plus = [status({ sets: [{ target: "defense", value: 13, plus: "agility" }] })];
  assert.equal(settled(10, plus, "defense", () => 3).value, 16);
  const capped = [...sets, status({ source: "Weakened", caps: [{ target: "attribute:might", value: 8 }] })];
  assert.equal(settled(12, capped, "attribute:might").value, 8);
  const halved = [status({ factors: [{ target: "defense", factor: 0.5 }] })];
  assert.equal(settled(15, halved, "defense").value, 7);
  assert.equal(settled(15, [], "defense").note, "");
});

test("roll tweaks: rerolls, minimums, critical range, immunity", () => {
  const lucky = status({ tweaks: [{ kind: "reroll", roll: "attack", at: 1 }, { kind: "minroll", roll: "check:agility", min: 10 }] });
  assert.deepEqual(d20Tweaks([lucky], ["attack"]), { reroll: 1, min: 0 });
  assert.deepEqual(d20Tweaks([lucky], ["check:agility"]), { reroll: 0, min: 10 });
  assert.equal(critRange([]), 20);
  assert.equal(critRange([status({ tweaks: [{ kind: "crit", range: 19 }] }), status({ tweaks: [{ kind: "crit", range: 18 }] })]), 18);
  assert.ok(critImmune([status({ tweaks: [{ kind: "nocrit" }] })]));
  assert.ok(!critImmune());
  assert.deepEqual(boostsOn([status({ boosts: [{ target: "attack", value: "+2" }, { target: "defense", value: "+1" }] as any })], "attack"), ["+2"]);
});
