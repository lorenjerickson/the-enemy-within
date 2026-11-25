import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { getCondition, getVars, listAfflictions, placeCharacterToken, saveEffectDef } from "@/lib/db";
import { agreeImprovisation, agreedImprovisation, askImprovise, dropImprovisation, getImprovisation, listOpenImprovisations, openImprovisation, rollSucceeds, setImproviseRolled } from "@/lib/improvise";
import { playImprovisation } from "@/app/(play)/play/improvising";

test("asking to improvise: one open ask per token (a new one replaces it), listed for the GM, dropped when taken back", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Mira"), 0, 0);
  askImprovise(lv, tok, "tip the oil barrel");
  askImprovise(lv, tok, "  tip the oil barrel toward the door ");
  assert.equal(openImprovisation(tok)?.intent, "tip the oil barrel toward the door");
  assert.deepEqual(listOpenImprovisations(lv).map((i) => i.intent), ["tip the oil barrel toward the door"]);
  dropImprovisation(openImprovisation(tok)!.id);
  assert.equal(openImprovisation(tok), undefined);
});


test("the GM settles it (cost, roll, outcomes); it plays out by the roll: success, failure, a natural 1 never succeeds", () => {
  assert.equal(rollSucceeds(null), true);
  assert.equal(rollSucceeds({ type: "check", skill: "athletics", dc: 12 }, { total: 14, natural: 9 }), true);
  assert.equal(rollSucceeds({ type: "check", skill: "athletics", dc: 12 }, { total: 11, natural: 9 }), false);
  assert.equal(rollSucceeds({ type: "save", attribute: "agility", dc: 2 }, { total: 9, natural: 1 }), false);
  const lv = level(), tok = placeCharacterToken(lv, character("Ned"), 0, 0);
  const id = askImprovise(lv, tok, "kick the barrel into the river");
  agreeImprovisation(id, { name: "Kick the barrel", cost: "action", seconds: 2, roll: { type: "check", skill: "athletics", dc: 12 }, success: { kind: "script", script: "game.vars.barrel = 'gone'" }, failure: { kind: "narrative", text: "It won't budge." } });
  assert.equal(openImprovisation(tok), undefined, "settled: no longer waiting on the GM");
  assert.equal(agreedImprovisation(tok)?.agreed?.name, "Kick the barrel");
  setImproviseRolled(id, { total: 8, natural: 6 });
  const told = playImprovisation(getImprovisation(id)!);
  assert.deepEqual(told.get(tok), ["Kick the barrel: it doesn't work.", "It won't budge."]);
  assert.notEqual(getVars().barrel, "gone");
  assert.equal(getImprovisation(id)!.status, "done");
  const id2 = askImprovise(lv, tok, "again");
  agreeImprovisation(id2, { name: "Kick it again", cost: "action", seconds: 2, roll: null, success: { kind: "script", script: "game.vars.barrel = 'gone'" } });
  playImprovisation(getImprovisation(id2)!);
  assert.equal(getVars().barrel, "gone");
});

test("an effect outcome on the improviser (or someone else)", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Ora"), 0, 0);
  const brave = saveEffectDef(null, { name: "Emboldened", description: "", modifiers: [{ kind: "speed", factor: 1.5 }], rounds: 2 });
  const id = askImprovise(lv, tok, "a rousing yell");
  agreeImprovisation(id, { name: "Rousing yell", cost: "bonus", seconds: 1, roll: null, success: { kind: "effect", effect: brave, on: "self" } });
  const told = playImprovisation(getImprovisation(id)!);
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Emboldened"));
  assert.match(told.get(tok)?.[0] ?? "", /You're emboldened/);
  void getCondition;
});

test("settled: a player is asked for its roll; out of combat it plays out when the roll comes in; with no roll, at once", async () => {
  const { createUser, db, getOpenRollRequest } = await import("@/lib/db");
  const { startImprovisation, improvisationRolled } = await import("@/app/(play)/play/improvising");
  createUser({ name: "impP", username: "impP", contact: "", role: "player" } as never, "pw");
  const pid = db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get("impP")!.id;
  const lv = level(), pc = character("Pip");
  db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(pid, pc);
  const tok = placeCharacterToken(lv, pc, 0, 0);
  const id = askImprovise(lv, tok, "climb the chandelier");
  agreeImprovisation(id, { name: "Chandelier", cost: "action", seconds: 2, roll: { type: "check", skill: "athletics", dc: 12 }, success: { kind: "narrative", text: "You swing across." } });
  startImprovisation(id);
  assert.deepEqual(getOpenRollRequest(pid)?.action, { kind: "improvise", id });
  assert.equal(improvisationRolled(id, { total: 15, natural: 13 }), "Chandelier: it works. You swing across.");
  assert.equal(getImprovisation(id)!.status, "done");
  const id2 = askImprovise(lv, tok, "shout");
  agreeImprovisation(id2, { name: "Shout", cost: "free", seconds: 0, roll: null, success: { kind: "script", script: "game.vars.shouted = true" } });
  startImprovisation(id2);
  assert.equal(getVars().shouted, true);
});

test("in a round: an agreed (and rolled) improvisation goes into the plan as one step at its cost and time; done, it plays out after the round", async () => {
  const { creature } = await import("./seed");
  const { addCreatureToken, getRoundPlan, saveEncounter, db } = await import("@/lib/db");
  const { addPlanStep, tokenPlanner } = await import("@/lib/roundPlanServer");
  const { resolveMovement } = await import("@/lib/resolveRound");
  const lv = level(), pc = character("Quin");
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: { value: 5, dist: "ft", per: "s" } }), pc);
  const me = placeCharacterToken(lv, pc, 0, 0), rat = addCreatureToken(lv, creature("Rat"), 6, 0);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: me, initiative: 15 }, { token_id: rat, initiative: 8 }] });
  assert.equal(addPlanStep(tokenPlanner(me)!, { kind: "action", action: "improvise" }), "Nothing agreed with the GM yet");
  const id = askImprovise(lv, me, "tip the table for cover");
  agreeImprovisation(id, { name: "Tip the table", cost: "bonus", seconds: 1, roll: { type: "check", skill: "athletics", dc: 10 }, success: { kind: "narrative", text: "It crashes over." } });
  assert.equal(addPlanStep(tokenPlanner(me)!, { kind: "action", action: "improvise" }), null, "in a round: planned first, its roll goes with the plan dice");
  const { planRolls } = await import("@/lib/planRolls");
  assert.deepEqual(planRolls(me, getRoundPlan(lv, me).plan).map((r) => [r.step, r.key, r.spec.label]), [[0, "check", "Tip the table: Athletics"]]);
  setImproviseRolled(id, { total: 14, natural: 12 });
  const step = getRoundPlan(lv, me).plan[0];
  assert.deepEqual(step.kind === "action" && step.improv, { id, name: "Tip the table", seconds: 1, cost: "bonus" });
  assert.equal(addPlanStep(tokenPlanner(me)!, { kind: "action", action: "search" }), null, "a bonus action: the action is still free");
  const r = resolveMovement([{ tokenId: me, name: "Quin", initiative: 15, start: { col: 0, row: 0 }, plan: [step], fps: 5 }], [], [], false);
  assert.deepEqual(r.improvised.map((x) => x.id), [id]);
  assert.match(playImprovisation(getImprovisation(id)!).get(me)!.join(" "), /Tip the table: it works\. It crashes over\./);
});

test("place an area: the template where it was put (a line from the improviser); a critical failure shifts it to a compass point by its size", async () => {
  const { templateArea, shifted, setImprovisePlaced, needsPlacing } = await import("@/lib/improvise");
  const { listLastingAreas } = await import("@/lib/db");
  assert.deepEqual(templateArea({ shape: "circle", ft: 10 }, { x: 5, y: 5 }, { x: 0, y: 0 }), { shape: "circle", origin: { x: 5, y: 5 }, dir: 0, size: 2 });
  assert.equal(templateArea({ shape: "line", ft: 15 }, { x: 3, y: 0.5 }, { x: 0.5, y: 0.5 }).dir, 0);
  const n = shifted({ x: 5, y: 5 }, { shape: "circle", ft: 10 }, 1), e = shifted({ x: 5, y: 5 }, { shape: "circle", ft: 10 }, 3);
  assert.deepEqual([+n.x.toFixed(6), +n.y.toFixed(6)], [5, 3], "1: north, 10 ft");
  assert.deepEqual([+e.x.toFixed(6), +e.y.toFixed(6)], [7, 5], "3: east");
  const lv = level(), tok = placeCharacterToken(lv, character("Rue"), 0, 0);
  const id = askImprovise(lv, tok, "tip the oil barrel");
  agreeImprovisation(id, { name: "Tip the barrel", cost: "action", seconds: 2, roll: null, success: { kind: "area", template: { shape: "rect", ft: 10, ft2: 10 }, settings: { name: "Oil slick", look: "oil", damage: null, dc: 12, save: "agility", half: true, fires: ["inside"], flammable: true, minutes: 0 } } });
  assert.equal(needsPlacing(getImprovisation(id)!), true);
  setImprovisePlaced(id, { x: 4, y: 4 });
  playImprovisation(getImprovisation(id)!);
  const slick = listLastingAreas(lv).find((l) => l.name === "Oil slick")!;
  assert.deepEqual([slick.area.shape, slick.area.origin, slick.flammable], ["rect", { x: 4, y: 4 }, true]);
});

test("a template to place: nothing (no roll, no outcome) until it's placed and the GM goes ahead", async () => {
  const { setImprovisePlaced, goAheadImprovisation, waitingOnTemplate } = await import("@/lib/improvise");
  const { startImprovisation } = await import("@/app/(play)/play/improvising");
  const { listLastingAreas } = await import("@/lib/db");
  const lv = level(), tok = placeCharacterToken(lv, character("Sol"), 0, 0);
  const id = askImprovise(lv, tok, "spill the lamp oil");
  agreeImprovisation(id, { name: "Spill oil", cost: "action", seconds: 2, roll: null, success: { kind: "area", template: { shape: "circle", ft: 5 }, settings: { name: "Lamp oil", look: "oil", damage: null, dc: 12, save: "agility", half: true, fires: ["inside"], minutes: 0 } } });
  startImprovisation(id);
  assert.equal(getImprovisation(id)!.status, "agreed", "not placed yet");
  setImprovisePlaced(id, { x: 3, y: 3 });
  assert.equal(waitingOnTemplate(getImprovisation(id)!), true, "placed, but the GM hasn't gone ahead");
  startImprovisation(id);
  assert.equal(getImprovisation(id)!.status, "agreed");
  goAheadImprovisation(id);
  startImprovisation(id);
  assert.equal(getImprovisation(id)!.status, "done");
  assert.ok(listLastingAreas(lv).some((l) => l.name === "Lamp oil"));
});
