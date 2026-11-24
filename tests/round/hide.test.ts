import { test } from "node:test";
import assert from "node:assert/strict";
import { act, fighter, gear, move, mover, resolve, wall } from "./harness";

const hider = () => fighter({ side: "party", hp: 20 }), foe = () => fighter({ side: "hostile", hp: 20 });
const hidden = new Map([[1, 15]]);

test("standing still behind a wall, an enemy who comes into view doesn't give them away", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }), mover(2, { col: 5, row: 3 }, [move(5, 0, 15)])], { 1: hider(), 2: foe() }, { hidden });
  assert.deepEqual(r.hiddenLeft, [{ tokenId: 1, stealth: 15 }]);
});

test("moving into an enemy's view gives them away", () => {
  const r = resolve([mover(1, { col: 0, row: 3 }, [move(0, 0, 15)]), mover(2, { col: 6, row: 0 })], { 1: hider(), 2: foe() }, { hidden, walls: [wall(-1, 2, 8, 2)] });
  assert.deepEqual(r.hiddenLeft, []);
  assert.match(r.text, /T1 is no longer hidden \(T2 sees them move\)/);
});

test("moving where no enemy can see (behind a wall) keeps them hidden", () => {
  const r = resolve([mover(1, { col: 0, row: 5 }, [move(0, 3, 10)]), mover(2, { col: 6, row: 0 })], { 1: hider(), 2: foe() }, { hidden, walls: [wall(-1, 2, 8, 2)] });
  assert.deepEqual(r.hiddenLeft, [{ tokenId: 1, stealth: 15 }]);
});

test("an enemy right next to them gives them away", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }), mover(2, { col: 4, row: 0 }, [move(1, 0, 15)])], { 1: hider(), 2: foe() }, { hidden });
  assert.match(r.text, /T1 is no longer hidden \(T2 is right next to them\)/);
});

test("attacking from hiding (from afar) gives them away once it's done; until then they're hidden", () => {
  const shot = gear({ id: 60, name: "Shot", range: 8 });
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("attack", { target: { id: 2, name: "T2" }, use: shot })]), mover(2, { col: 5, row: 0 })], { 1: hider(), 2: foe() }, { hidden });
  assert.match(r.at(2), /T1 is no longer hidden \(they acted\)/);
  assert.deepEqual(r.hiddenLeft, []);
  const idle = resolve([mover(1, { col: 0, row: 0 }), mover(2, { col: 5, row: 0 })], { 1: hider(), 2: foe() }, { hidden });
  assert.deepEqual(idle.hiddenLeft, [{ tokenId: 1, stealth: 15 }]);
});

test("Hide in a round: out of every enemy's sight as it's done, they're hidden (Stealth after the round); in sight, it fails", () => {
  const behind = resolve([mover(1, { col: 0, row: 4 }, [act("hide")]), mover(2, { col: 6, row: 0 })], { 1: hider(), 2: foe() }, { walls: [wall(-1, 2, 8, 2)] });
  assert.deepEqual(behind.hides, [{ tokenId: 1, hurried: false }]);
  assert.equal(behind.hiddenLeft.length, 1);
  const open = resolve([mover(1, { col: 0, row: 0 }, [act("hide", { hurried: true })]), mover(2, { col: 6, row: 0 })], { 1: hider(), 2: foe() });
  assert.deepEqual(open.hides, []);
  assert.match(open.text, /T1 tries to hide, but T2 can see them/);
});
