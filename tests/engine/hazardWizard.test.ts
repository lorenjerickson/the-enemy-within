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
  assert.deepEqual(questions(always, true).slice(0, 7), ["name", "preset", "activation", "catches", "who", "often", "stops"]);
  assert.deepEqual(questions(always).slice(-7), ["visible", "look", "damage", "effects", "lingers", "lasts", "when"]);
  const pit = { ...always, activation: "dormant" as const, activeFor: "instant" as const };
  assert.deepEqual(questions(pit).slice(0, 6), ["name", "activation", "activeFor", "who", "often", "stops"]);
  assert.deepEqual(questions({ ...pit, activeFor: "time" }).slice(0, 7), ["name", "activation", "activeFor", "catches", "who", "often", "stops"]);
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
  assert.deepEqual(hazardCard(t), ["It waits until someone comes into it or a map trigger sets it off; then it acts at once on whoever is in it.", "It's for anyone, once for each creature, and stops whoever sets it off.", "Players see it once it goes off, or a Search beats DC 14."]);
  const gas = { ...t, setOffBy: [], activeFor: "time" as const, activeRounds: 10, fires: ["start" as const], stops: false, often: "always" as const };
  assert.deepEqual(hazardCard(gas), ["It waits until a map trigger sets it off; then it stays active for 10 rounds.", "While active, it catches whoever starts a round in it.", "It's for anyone, every time.", "Players see it once it goes off, or a Search beats DC 14."]);
  assert.deepEqual(answerLine("activation", gas), ["Activation", "Waits until a map trigger sets it off"]);
});

test("part 2: what it does, who sees and hears it, how long, to settings and back", () => {
  const h = { name: "Fire wall", look: "fire" as const, damage: "2d6", damageType: "fire", save: "agility" as const, dc: 13, half: true, lingers: true, buildUp: 2, decay: 3, flammable: true, visibility: "hidden" as const, findDc: 16, sound: 9, soundHidden: true, ends: 105, conditions: [{ id: 4 } as never] };
  const a = answersFromHazard(h, 100);
  assert.deepEqual([a.damageSave, a.saveDc, a.lasts, a.effectIds, a.look], [true, 13, 5, [4], "fire"]);
  const p = hazardPatch(a);
  for (const k of ["damage", "damageType", "save", "dc", "half", "lingers", "buildUp", "decay", "flammable", "visibility", "findDc", "sound", "soundHidden", "look"] as const) assert.deepEqual(p[k], h[k], k);
  assert.equal(hazardPatch({ ...a, damageSave: false }).dc, 99, "no save against its damage");
  assert.equal(hazardPatch({ ...a, look: "none" }).noLook, true);
  assert.deepEqual(hazardCard(a).slice(-4), ["It deals 2d6 fire damage, half on a successful Agility save (DC 13).", "Its harm lingers: 2 more each round inside, 3 less each round after leaving.", "Fire sets it burning.", "Players see it once it goes off, or a Search beats DC 16."]);
});
