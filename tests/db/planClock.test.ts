import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, placeCharacterToken } from "@/lib/db/tokens";
import { createUser } from "@/lib/db/users";
import { db } from "@/lib/db/connection";
import { getRoundPlan, readyTokens, saveRoundPlan } from "@/lib/db/rounds";
import { saveEncounter } from "@/lib/db/encounters";
import { planClock } from "../../app/(play)/play/planClock";

const player = (username: string) => {
  createUser({ name: username, username, contact: "", role: "player" } as never, "pw");
  return db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get(username)!.id;
};
const owned = (name: string, by: number) => { const id = character(name); db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(by, id); return id; };

test("the countdown: only when just one player's character is left to be ready; out of time, no plan and ready", () => {
  const lv = level("Arena");
  const milo = placeCharacterToken(lv, owned("Milo", player("pm")), 0, 0), tilly = placeCharacterToken(lv, owned("Tilly", player("pt")), 1, 0);
  const rat = addCreatureToken(lv, creature("Rat"), 5, 5);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: milo, initiative: 15 }, { token_id: tilly, initiative: 12 }, { token_id: rat, initiative: 8 }] });
  assert.equal(planClock(lv), null, "three still planning");
  saveRoundPlan(lv, rat, [], true);
  assert.equal(planClock(lv), null, "two players still planning");
  saveRoundPlan(lv, tilly, [], true);
  saveRoundPlan(lv, milo, [{ kind: "move", to: { col: 1, row: 1 }, feet: 5 }], false);
  const c = planClock(lv)!;
  assert.equal(c.tokenId, milo);
  assert.ok(c.endsAt - Date.now() > 29_000 && c.endsAt - Date.now() <= 30_000);
  assert.equal(planClock(lv)!.endsAt, c.endsAt, "the same clock on every look");
  db.prepare("UPDATE plan_clock SET started = started - 31000 WHERE level_id = ?").run(lv);
  assert.equal(planClock(lv), null);
  assert.ok(readyTokens(lv).has(milo));
  assert.deepEqual(getRoundPlan(lv, milo).plan, [], "out of time: no plan");
});

test("no countdown when the one left is the GM's", () => {
  const lv = level("Pit");
  const milo = placeCharacterToken(lv, owned("Milo2", player("pm2")), 0, 0), rat = addCreatureToken(lv, creature("Rat2"), 5, 5);
  saveEncounter(lv, { round: 1, turn: 0, order: [{ token_id: milo, initiative: 15 }, { token_id: rat, initiative: 8 }] });
  saveRoundPlan(lv, milo, [], true);
  assert.equal(planClock(lv), null);
});
