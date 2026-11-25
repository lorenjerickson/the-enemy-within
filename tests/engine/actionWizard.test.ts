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
  assert.deepEqual(questions(answer({ who: "area", lasts: true, affects: ["attack"] })), ["name", "type", "who", "shape", "areaSize", "lasts", "affects", "damage", "avoid", "duration"]);
  assert.deepEqual(questions(answer({ type: "reaction", affects: ["effect"] })), ["name", "type", "affects", "effects"]);
  assert.deepEqual(questions(answer({ affects: ["defend", "heal", "aid"] })), ["name", "type", "who", "targetWho", "range", "affects", "defend", "heal", "aid", "duration"]);
});

test("answers make the action the card describes", () => {
  assert.equal(card(answer({ affects: ["attack"], damage: "1d8", damageType: "bludgeoning" })),
    "On a successful attack roll, strikes one creature within 5 feet for 1d8 bludgeoning damage. Takes 2 seconds.");
  assert.equal(card(answer({ who: "area", shape: "circle", areaFt: 20, rangeFt: 150, affects: ["attack"], damage: "8d6", damageType: "fire", saveDc: 15 })),
    "Fills a 20-foot radius up to 150 feet away. Everyone in it makes an Agility save (DC 15) or takes 8d6 fire damage, half on a success. Takes 2 seconds.");
  assert.equal(card(answer({ affects: ["heal"], heal: "2d4" })), "Heals one target creature within 5 feet for 2d4, no roll needed. Takes 2 seconds.");
  assert.match(card(answer({ affects: ["defend"], defend: "2", durationAmount: 1, durationUnit: "round", targetWho: "friendly", rangeFt: 30 })), /^Gives one friendly within 30 feet \+2 defense/);
  assert.equal(card(answer({ type: "reaction", affects: ["effect"], effects: [7] })), "As a reaction: applies Effect 7 to you. Takes 2 seconds.");
});

test("an action opens with the answers it was saved from", () => {
  const cases: Partial<Answers>[] = [
    { name: "Aimed shot", affects: ["attack", "effect"], damage: "1d8", damageType: "piercing", attackBonus: "2", rangeFt: 60, targetWho: "enemy", effects: [3] },
    { name: "Fireball", who: "area", shape: "circle", areaFt: 20, rangeFt: 150, affects: ["attack"], damage: "8d6", damageType: "fire", saveDc: 15, lasts: true, durationAmount: 3, durationUnit: "round" },
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
