import { test } from "node:test";
import assert from "node:assert/strict";
import { answersFromAction, fieldsFromAnswers, questions, type Answers } from "@/lib/actionWizard";
import { gearOf } from "@/lib/actionCard";
import { actionSentence } from "@/lib/actionSummary";

const blank = answersFromAction();
const answer = (a: Partial<Answers>): Answers => ({ ...blank, ...a });
const card = (a: Answers) => actionSentence(gearOf(fieldsFromAnswers(a), (id) => ({ id, name: `Effect ${id}`, effects: [] }) as never));

test("a new action starts with name, type, who and how it affects them", () => {
  assert.deepEqual(questions(blank), ["name", "type", "who", "targetWho", "range", "affects"]);
});

test("the questions branch on the answers", () => {
  assert.deepEqual(questions(answer({ who: "self" })), ["name", "type", "who", "affects"]);
  assert.deepEqual(questions(answer({ who: "several" })), ["name", "type", "who", "targetWho", "count", "range", "affects"]);
  assert.deepEqual(questions(answer({ who: "area", lasts: true, affects: ["attack"] })), ["name", "type", "who", "shape", "place", "areaSize", "lasts", "affects", "damage", "damageSave", "duration"]);
  assert.deepEqual(questions(answer({ type: "reaction", affects: ["effect"] })), ["name", "type", "affects", "effects"]);
  assert.deepEqual(questions(answer({ affects: ["defend", "heal", "aid"] })), ["name", "type", "who", "targetWho", "range", "affects", "defend", "heal", "aid", "duration"]);
});

test("answers make the action the card describes", () => {
  assert.equal(card(answer({ affects: ["attack"], damage: "1d8", damageType: "bludgeoning" })),
    "On a successful attack roll, strikes one creature within 5 feet for 1d8 bludgeoning damage. Takes 2 seconds.");
  assert.equal(card(answer({ who: "area", shape: "circle", areaFt: 20, rangeFt: 150, affects: ["attack"], damage: "8d6", damageType: "fire", saveDc: 15 })),
    "Fills a 20-foot radius up to 150 feet away. Everyone in it takes 8d6 fire damage. Takes 2 seconds.");
  assert.deepEqual(questions(answer({ affects: ["attack"] })).slice(-2), ["damage", "toHit"]);
  assert.equal(card(answer({ affects: ["heal"], heal: "2d4" })), "Heals one target creature within 5 feet for 2d4, no roll needed. Takes 2 seconds.");
  assert.match(card(answer({ affects: ["defend"], defend: "2", durationAmount: 1, durationUnit: "round", targetWho: "friendly", rangeFt: 30 })), /^Gives one friendly within 30 feet \+2 defense/);
  assert.equal(card(answer({ type: "reaction", affects: ["effect"], effects: [7] })), "As a reaction: applies Effect 7 to you. Takes 2 seconds.");
});

test("an action opens with the answers it was saved from", () => {
  const cases: Partial<Answers>[] = [
    { name: "Aimed shot", affects: ["attack", "effect"], damage: "1d8", damageType: "piercing", attackBonus: "2", rangeFt: 60, targetWho: "enemy", effects: [3] },
    { name: "Fireball", who: "area", shape: "circle", areaFt: 20, rangeFt: 150, affects: ["attack"], damage: "8d6", damageType: "fire", lasts: true, durationAmount: 3, durationUnit: "round" },
    { name: "Inspire", who: "several", count: "upto", n: 3, targetWho: "friendly", rangeFt: 30, affects: ["defend", "aid"], aidTarget: "skill:persuasion", aid: "1d4", defend: "1", durationAmount: 1, durationUnit: "minute" },
    { name: "Shield", type: "reaction", affects: ["effect"], effects: [9], seconds: 1 },
    { name: "Second wind", type: "bonus", who: "self", affects: ["heal"], heal: "1d10" },
  ];
  for (const c of cases) {
    const a = answer(c), back = answersFromAction(fieldsFromAnswers(a));
    for (const [k, v] of Object.entries(c)) assert.deepEqual(back[k as keyof Answers], v, `${c.name}: ${k}`);
  }
});

test("an older action's other bonuses survive being edited", () => {
  const old = fieldsFromAnswers(answer({ affects: ["heal"], heal: "2d4" }));
  old.boosts.push({ target: "damage", value: "+1", on: "target" });
  assert.deepEqual(fieldsFromAnswers(answersFromAction(old)).boosts.map((b) => b.target), ["health", "damage"]);
});

test("effects an older action puts on its user as well as its target survive being edited", () => {
  const old = fieldsFromAnswers(answer({ affects: ["attack", "effect"], damage: "1d6", effects: [3] }));
  old.conditions.push({ id: 8, on: "self" });
  assert.deepEqual(fieldsFromAnswers(answersFromAction(old)).conditions, [{ id: 3, on: "target" }, { id: 8, on: "self" }]);
});

test("defend, heal and aid read on the card", () => {
  assert.equal(card(answer({ who: "several", count: "upto", n: 3, targetWho: "friendly", rangeFt: 30, affects: ["defend", "aid"], defend: "1", aidTarget: "skill:persuasion", aid: "1d4", durationAmount: 1, durationUnit: "minute" })),
    "Gives up to 3 friendlies within 30 feet +1 defense, +1d4 Persuasion for 1 minute, no roll needed. Takes 2 seconds.");
  assert.equal(card(answer({ type: "bonus", who: "self", affects: ["heal"], heal: "1d10" })), "As a bonus action: heals you for 1d10. Takes 2 seconds.");
});

test("every question has a short answer line", async () => {
  const { answerLine } = await import("@/lib/actionWizard");
  const a = answer({ name: "Fireball", who: "area", lasts: true, affects: ["attack", "effect"], damage: "1d10", damageType: "fire", effects: [4], rangeFt: 150, areaFt: 20 });
  const lines = questions(a).map((q) => answerLine(q, a, () => "Burning"));
  assert.deepEqual(lines, [
    ["Name", "Fireball"], ["Type", "Action, 2 s"], ["Applies to", "Everyone in an area"], ["Shape", "Circle"], ["Where it goes", "A spot you pick"],
    ["Size", "20 feet, aimed up to 150 feet away"], ["Stays on the map", "Yes"], ["How it affects them", "Attack, apply an effect"],
    ["Damage", "1d10 fire"], ["Save against it", "None: everyone caught takes it"], ["How long", "1 minute"], ["Effects", "Burning"],
  ]);
});

test("no attack on yourself or as a reaction: a ticked attack falls away", async () => {
  const { affectsFor } = await import("@/lib/actionWizard");
  assert.ok(!affectsFor(answer({ who: "self" })).includes("attack"));
  assert.ok(!affectsFor(answer({ type: "reaction" })).includes("attack"));
  const a = answer({ who: "self", affects: ["attack", "heal"], damage: "1d6", heal: "1d4" });
  assert.deepEqual(questions(a).slice(-2), ["affects", "heal"]);
  assert.equal(fieldsFromAnswers(a).damage, null);
});

test("a circle goes on a spot they pick, where they stand, or (not yet) moves with them", () => {
  assert.deepEqual(questions(answer({ who: "area", affects: ["attack"] })).slice(3, 7), ["shape", "place", "areaSize", "lasts"]);
  assert.deepEqual(questions(answer({ who: "area", shape: "cone", affects: ["attack"] })).slice(3, 6), ["shape", "areaSize", "lasts"]);
  assert.deepEqual(questions(answer({ who: "area", place: "follow", affects: ["attack"] })).slice(3, 6), ["shape", "place", "affects"]);
  const here = answer({ name: "Smoke bomb", who: "area", place: "here", areaFt: 10, rangeFt: 60, affects: ["effect"], effects: [2] });
  const f = fieldsFromAnswers(here);
  assert.equal(f.area_at, "self");
  assert.equal(f.range_ft, 0);
  assert.equal(answersFromAction(f).place, "here");
  assert.equal(gearOf(f, () => undefined).area?.at, "self");
  assert.match(card(here), /^Fills a 10-foot radius around where you stand\./);
});

test("polish: 'How many' starts at 'Up to'; Aid's answer line shows the label", async () => {
  const { answerLine } = await import("@/lib/actionWizard");
  assert.equal(blank.count, "upto");
  assert.deepEqual(answerLine("aid", answer({ aidTarget: "skill:persuasion", aid: "1d4" })), ["Aid", "+1d4 Persuasion"]);
  assert.deepEqual(answerLine("aid", answer({ aidTarget: "check", aid: "1" })), ["Aid", "+1 All ability and skill checks"]);
});

test("an area attack can have a save against its damage: kept on saving and opening again, and on the card", () => {
  const a = answer({ name: "Grenade", who: "area", shape: "circle", areaFt: 10, rangeFt: 30, affects: ["attack"], damage: "3d6", damageType: "piercing", damageSave: true, saveAttr: "agility", saveDc: 13, saveHalf: true });
  const f = fieldsFromAnswers(a);
  assert.equal(f.save_dc, 13);
  assert.equal(f.save_half, 1);
  assert.equal(answersFromAction(f).damageSave, true);
  assert.equal(fieldsFromAnswers(answer({ ...a, damageSave: false })).save_dc, 99, "no save: everyone caught takes it");
  assert.match(card(a), /agility save \(DC 13\)|Agility save/i);
});
