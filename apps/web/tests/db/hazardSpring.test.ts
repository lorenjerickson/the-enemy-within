import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { db } from "@/lib/db/connection";
import { createUser } from "@/lib/db/users";
import { addCreatureToken, placeCharacterToken } from "@/lib/db/tokens";
import { addLastingArea, getLastingArea, listHazards } from "@/lib/db/areas";
import { getCondition, listAfflictions, saveEffectDef } from "@/lib/db/effects";
import { getOpenRollRequest } from "@/lib/db/rolls";
import { tokenHealth } from "@/lib/health";
import { UNTIL_REMOVED, areaFromDrawn } from "@/lib/aoe";
import { walkRoute } from "@/app/(play)/play/walk";
import { hazardRolled, hazardsOnStep } from "@/app/(play)/play/hazards";
import type { Hazard } from "@/lib/hazards";

const pit = (o: Partial<Hazard> = {}): Omit<Hazard, "id"> => ({
  name: "Spike pit", look: "fog", noLook: true, area: areaFromDrawn({ shape: "rect", x: 3, y: 0, w: 1, h: 1 }), drawn: true, ends: UNTIL_REMOVED,
  damage: "6", damageType: "piercing", save: "agility", dc: 99, half: true, activation: "dormant", setOffBy: ["enter"], activeFor: "instant", often: "each", stops: true, visibility: "hidden", findDc: 14, ...o,
});
const row = (y: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y }));

test("walking into a dormant hazard springs it: damage, effects, the walk stops; remembered once per creature, seen by whoever set it off", () => {
  const lv = level();
  const hobbled = getCondition(saveEffectDef(null, { name: "Hobbled", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 3 }))!;
  const id = addLastingArea(lv, pit({ conditions: [hobbled] }));
  const tok = placeCharacterToken(lv, character("Annis", { health: "20" }), 1, 0);
  const w = walkRoute(lv, tok, row(0, 1, 6));
  assert.equal(w.stopped, true);
  assert.deepEqual(w.walked.at(-1), { x: 3, y: 0 }, "stopped in the pit");
  assert.equal(tokenHealth(tok)!.current, 14);
  assert.ok(w.told.some((t) => /You set off a trap \(Spike pit\)! You're hurt: moderate \(-6\), you're hobbled, you stop where you are\./.test(t)), w.told.join(" | "));
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Hobbled"));
  const h = getLastingArea(id) as Hazard;
  assert.deepEqual(h.sprung, [tok]);
  assert.ok(h.seenBy?.includes(tok));
  assert.deepEqual(hazardsOnStep(lv, tok, { x: 2, y: 0 }, { x: 3, y: 0 }), [], "once per creature");
  assert.ok(!listHazards(lv).some((x) => x.id === id), "a dormant hazard isn't among those catching walkers");
});

test("a once hazard is spent once it has gone off; who it's for counts; passing beside doesn't set it off", () => {
  const lv = level("Hall");
  const id = addLastingArea(lv, pit({ often: "once", who: "party", stops: false }));
  const rat = addCreatureToken(lv, creature("Rat", { health: "5" }), 2, 0);
  assert.deepEqual(hazardsOnStep(lv, rat, { x: 2, y: 0 }, { x: 3, y: 0 }), [], "only the party sets it off");
  const hero = placeCharacterToken(lv, character("Bram", { health: "20" }), 2, 1);
  assert.deepEqual(hazardsOnStep(lv, hero, { x: 2, y: 1 }, { x: 3, y: 1 }), [], "beside it");
  assert.equal(hazardsOnStep(lv, hero, { x: 2, y: 0 }, { x: 3, y: 0 }).length, 1);
  assert.equal((getLastingArea(id) as Hazard).spent, true);
  const other = placeCharacterToken(lv, character("Cole", { health: "20" }), 2, 0);
  assert.deepEqual(hazardsOnStep(lv, other, { x: 2, y: 0 }, { x: 3, y: 0 }), [], "spent");
});

test("a player's character rolls its own throw for a hazard (one prompt); it lands when the roll comes in", () => {
  createUser({ name: "hzP", username: "hzP", contact: "", role: "player" } as never, "pw");
  const pid = db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get("hzP")!.id;
  const lv = level("Crypt");
  const id = addLastingArea(lv, pit({ dc: 12, half: true, stops: false }));
  const dee = character("Dee", { health: "20" });
  db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(pid, dee);
  const tok = placeCharacterToken(lv, dee, 2, 0);
  const [s] = hazardsOnStep(lv, tok, { x: 2, y: 0 }, { x: 3, y: 0 });
  assert.match(s.player, /Roll your agility save/);
  assert.deepEqual(getOpenRollRequest(pid)!.action, { kind: "hazardSave", levelId: lv, hazardId: id, tokenId: tok });
  assert.equal(tokenHealth(tok)!.current, 20, "nothing yet");
  assert.match(hazardRolled(lv, id, tok, 20), /partly get clear/);
  assert.equal(tokenHealth(tok)!.current, 17, "saved: half of 6");
  assert.deepEqual((getLastingArea(id) as Hazard).sprung, [tok], "remembered once, not again when the roll came in");
});
