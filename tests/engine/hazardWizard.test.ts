import { test } from "node:test";
import assert from "node:assert/strict";
import { answerLine, answersFromHazard, applyPreset, hazardCard, hazardPatch, questions } from "@/lib/hazardWizard";

test("a hazard opens with its answers and saves back the same settings", () => {
  const pit = { name: "Spike pit", activation: "dormant" as const, setOffBy: ["enter" as const], byTrigger: true, activeFor: "instant" as const, fires: ["enter" as const], who: "party" as const, often: "each" as const, stops: true };
  const p = hazardPatch(answersFromHazard(pit));
  for (const [k, v] of Object.entries(pit)) assert.deepEqual((p as Record<string, unknown>)[k], v, k);
  const gas = { name: "Gas", activation: "dormant" as const, setOffBy: [], byTrigger: true, activeFor: "time" as const, activeMinutes: 1, fires: ["start" as const], who: "" as const, often: "always" as const, stops: false };
  assert.equal(hazardPatch(answersFromHazard(gas)).activeMinutes, 1, "10 rounds");
});

test("the questions branch: presets for a new one; how long it's active only when dormant; whom it catches unless it acts once", () => {
  const always = answersFromHazard({ name: "Fire wall" });
  assert.deepEqual(questions(always, true), ["name", "preset", "activation", "catches", "who", "often", "stops"]);
  const pit = { ...always, activation: "dormant" as const, activeFor: "instant" as const };
  assert.deepEqual(questions(pit), ["name", "activation", "activeFor", "who", "often", "stops"]);
  assert.deepEqual(questions({ ...pit, activeFor: "time" }), ["name", "activation", "activeFor", "catches", "who", "often", "stops"]);
  assert.deepEqual(hazardPatch({ ...always, setOffBy: ["enter"], byTrigger: true }).setOffBy, [], "an always-active one isn't set off");
});

test("presets fill in the answers, and the settings later questions ask about", () => {
  const t = applyPreset(answersFromHazard({ name: "Pit" }), "trap");
  assert.deepEqual([t.activation, t.setOffBy, t.often, t.stops], ["dormant", ["enter"], "each", true]);
  assert.equal(hazardPatch(t).visibility, "hidden");
  const w = applyPreset(t, "ward");
  assert.deepEqual([w.activation, w.who, w.stops, hazardPatch(w).visibility], ["always", "hostile", false, "gm"]);
});

test("the card and the answer lines in plain words", () => {
  const t = applyPreset(answersFromHazard({ name: "Spike pit" }), "trap");
  assert.deepEqual(hazardCard(t), ["It waits until someone comes into it or a map trigger sets it off; then it acts at once on whoever is in it.", "It's for anyone, once for each creature, and stops whoever sets it off."]);
  const gas = { ...t, setOffBy: [], activeFor: "time" as const, activeRounds: 10, fires: ["start" as const], stops: false, often: "always" as const };
  assert.deepEqual(hazardCard(gas), ["It waits until a map trigger sets it off; then it stays active for 10 rounds.", "While active, it catches whoever starts a round in it.", "It's for anyone, every time."]);
  assert.deepEqual(answerLine("activation", gas), ["Activation", "Waits until a map trigger sets it off"]);
});
