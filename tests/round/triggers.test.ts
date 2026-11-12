import { test } from "node:test";
import assert from "node:assert/strict";
import { attack, fighter, move, mover, resolve } from "./harness";
import type { MapTrigger } from "@/lib/triggers";

const wire = (t: Partial<MapTrigger> = {}): MapTrigger => ({
  id: 1, name: "Alarm wire", area: { shape: "line", x1: 3, y1: -2, x2: 3, y2: 2 }, springs: ["enter"], who: "", often: "once", outcomes: [{ kind: "script", script: "game.vars.alarm = true" }], sprung: [], ...t,
});

test("crossing a trigger mid-round notes it, the second it happens, for the GM", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)])], { 1: fighter() }, { triggers: [wire()] });
  assert.deepEqual(r.triggersFired, [{ triggerId: 1, tokenId: 1, sec: 3 }]);
  assert.match(r.at(3), /⚡ Alarm wire \(T1\)/);
  assert.deepEqual(r.final.get(1), { col: 5, row: 0 }, "it doesn't stop them unless it says so");
});

test("'stop them' stops the mover at once; their actions still happen", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [move(4, 0, 20), attack(2)]), mover(2, { col: 4, row: 1 })],
    { 1: fighter({ dmg: 4 }), 2: fighter({ hp: 20 }) },
    { triggers: [wire({ outcomes: [{ kind: "stop" }] })] },
  );
  assert.deepEqual(r.final.get(1), { col: 3, row: 0 });
  assert.match(r.at(3), /stopped where they are/);
  assert.equal(r.hp.get(2), 16, "T2 is next to where T1 was stopped: the planned attack still lands");
});

test("who it's for, how often, and starting or ending the round in one", () => {
  const two = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)]), mover(2, { col: 0, row: 1 }, [move(5, 1, 25)])], { 1: fighter({ side: "party" }), 2: fighter({ side: "hostile" }) }, { triggers: [wire({ who: "hostile", often: "each" })] });
  assert.deepEqual(two.triggersFired.map((f) => f.tokenId), [2]);
  const plate = { shape: "rect" as const, x: 2, y: 0, w: 1, h: 1 };
  const start = resolve([mover(1, { col: 2, row: 0 })], { 1: fighter() }, { triggers: [wire({ area: plate, springs: ["start"] })] });
  assert.equal(start.triggersFired[0]?.sec, 1);
  const end = resolve([mover(1, { col: 0, row: 0 }, [move(2, 0, 10)])], { 1: fighter() }, { triggers: [wire({ area: plate, springs: ["end"] })] });
  assert.equal(end.triggersFired[0]?.sec, 6);
  const spent = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)])], { 1: fighter() }, { triggers: [wire({ sprung: [9] })] });
  assert.deepEqual(spent.triggersFired, []);
});
