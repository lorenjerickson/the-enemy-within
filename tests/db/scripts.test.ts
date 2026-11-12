import { test } from "node:test";
import assert from "node:assert/strict";
import { character } from "./seed";
import { getCharacter, getVars, listActiveTriggers, setGameTime } from "@/lib/db";
import { characterHealth } from "@/lib/health";
import { checkGameState, fireTriggers, tryGameScript } from "@/lib/game";

const annis = character("Annis", { health: "20", attributes: { might: 14 } });
const bram = character("Bram", { health: "10" });

test("a script's changes to characters are saved", () => {
  const r = tryGameScript("game.players.annis.health -= 5\ngame.players['bram'].attributes.might = 16");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(characterHealth(annis)!.current, 15);
  assert.equal(getCharacter(bram)!.attributes.might, 16);
});

test("a failing script saves nothing", () => {
  const before = characterHealth(annis)!.current;
  const r = tryGameScript("game.players.annis.health -= 5\ngame.players.nobody.health = 0");
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /Line 2/);
  assert.equal(characterHealth(annis)!.current, before);
});

test("the script returns its last value as JSON", () => {
  const r = tryGameScript("game.players.count");
  assert.deepEqual(r, { ok: true, value: "2" });
});

test("game.vars persist between scripts", () => {
  tryGameScript("game.vars.alarm = true\ngame.vars.visits += 2");
  tryGameScript("game.vars.visits += 1");
  assert.deepEqual({ alarm: getVars().alarm, visits: getVars().visits }, { alarm: true, visits: 3 });
});

test("checkGameState asks without saving", () => {
  const before = characterHealth(annis)!.current;
  const r = checkGameState("game.players.annis.health = 1\ngame.players.annis.health.current");
  assert.deepEqual(r, { ok: true, value: 1 });
  assert.equal(characterHealth(annis)!.current, before);
});

test("select() in a script asks the GM, then carries on with the answer", () => {
  const ask = tryGameScript("select(game.players, 'Who?').health -= 1", undefined, []);
  assert.equal(ask.ok, false);
  assert.ok(!ask.ok && ask.prompt, "a prompt comes back");
  const before = characterHealth(bram)!.current;
  assert.equal(tryGameScript("select(game.players, 'Who?').health -= 1", undefined, [[bram]]).ok, true);
  assert.equal(characterHealth(bram)!.current, before - 1);
  assert.match(JSON.stringify(tryGameScript("select(game.players, 'Who?')")), /needs someone to answer/, "discovery and reward scripts have no one to ask");
});

test("ON triggers go off once when their condition becomes true", () => {
  assert.equal(tryGameScript("ON game.vars.door == 'open' DO\n   game.vars.ambush += 1").ok, true);
  assert.equal(listActiveTriggers().length, 1);
  tryGameScript("game.vars.door = 'open'");
  assert.equal(getVars().ambush, 1);
  tryGameScript("game.vars.other = 1");
  assert.equal(getVars().ambush, 1, "not again while it stays true");
  tryGameScript("game.vars.door = 'shut'");
  tryGameScript("game.vars.door = 'open'");
  assert.equal(getVars().ambush, 2, "again once it becomes true again");
});

test("a timer trigger fires as game time passes", () => {
  tryGameScript("game.calendar.timers.start('holmes').expires(1, 'hours')");
  tryGameScript("WITH game.calendar.timers['holmes'] AS T\n   ON T.expired DO\n      game.vars.too_late = true");
  setGameTime(30);
  fireTriggers();
  assert.equal(getVars().too_late, undefined);
  setGameTime(90);
  fireTriggers();
  assert.equal(getVars().too_late, true);
});
