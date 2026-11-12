import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { addMapTrigger, deleteMapTrigger, getMapTrigger, listMapTriggers, markMapTriggerSprung, resetMapTrigger, saveMapTrigger } from "@/lib/db";
import { describeOutcome, type TriggerOutcome } from "@/lib/triggers";
import { sprungByStep } from "@/lib/traps";

const lv = level();

test("a placed trigger: defaults, saved outcomes, firing and re-arming, removal", () => {
  const id = addMapTrigger(lv, { shape: "line", x1: 6, y1: -2, x2: 6, y2: 2 });
  let t = getMapTrigger(id)!;
  assert.deepEqual([t.name, t.springs, t.who, t.often, t.outcomes, t.sprung], ["Trigger", ["enter"], "", "once", [], []]);
  const outcomes: TriggerOutcome[] = [{ kind: "door", door: 3, to: "lock" }, { kind: "trap", trap: 2 }, { kind: "stop" }, { kind: "script", script: "game.vars.alarm = true" }];
  saveMapTrigger(id, { name: "Alarm wire", springs: ["enter"], who: "party", often: "each", outcomes });
  markMapTriggerSprung(id, 7);
  t = getMapTrigger(id)!;
  assert.equal(t.name, "Alarm wire");
  assert.deepEqual(t.outcomes, outcomes);
  assert.deepEqual(t.sprung, [7]);
  resetMapTrigger(id);
  assert.deepEqual(getMapTrigger(id)!.sprung, []);
  deleteMapTrigger(id);
  assert.ok(!listMapTriggers(lv).some((x) => x.id === id));
});

test("triggers use the same zone checks as traps", () => {
  const id = addMapTrigger(lv, { shape: "line", x1: 6, y1: -2, x2: 6, y2: 2 });
  const t = getMapTrigger(id)!;
  assert.equal(sprungByStep([t], 1, "party", { x: 5.5, y: 0.5 }, { x: 6.5, y: 0.5 }).length, 1, "crossing the wire");
  assert.equal(sprungByStep([t], 1, "party", { x: 4.5, y: 0.5 }, { x: 5.5, y: 0.5 }).length, 0);
});

test("outcomes in words", () => {
  const name = (kind: string, id: number) => `${kind} ${id}`;
  assert.equal(describeOutcome({ kind: "door", door: 1, to: "close" }, name), "closes door 1");
  assert.equal(describeOutcome({ kind: "door", door: 1, to: "unlock" }, name), "unlocks door 1");
  assert.equal(describeOutcome({ kind: "light", light: 2, on: false }, name), "turns light 2 off");
  assert.equal(describeOutcome({ kind: "trap", trap: 4 }, name), "sets off trap 4");
  assert.equal(describeOutcome({ kind: "stop" }), "stops them");
});
