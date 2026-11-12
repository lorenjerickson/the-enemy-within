import { test } from "node:test";
import assert from "node:assert/strict";
import { diceRange, rollDice, sumDice, usingDice, withSeed } from "@/lib/dice";

test("diceRange: dice, modifiers, negatives and plain numbers", () => {
  assert.deepEqual(diceRange("2d6"), { min: 2, max: 12 });
  assert.deepEqual(diceRange("d8-1"), { min: 0, max: 7 });
  assert.deepEqual(diceRange("3d4+2"), { min: 5, max: 14 });
  assert.deepEqual(diceRange(" 1d6 + 1 "), { min: 2, max: 7 });
  assert.deepEqual(diceRange("-1d4"), { min: -4, max: -1 });
  assert.deepEqual(diceRange("+2"), { min: 2, max: 2 });
  assert.deepEqual(diceRange("nonsense"), { min: 0, max: 0 });
});

test("sumDice joins formulas and adds ranges", () => {
  assert.deepEqual(sumDice(["3d4", "2d6"]), { formula: "3d4 + 2d6", min: 5, max: 24 });
  assert.equal(sumDice(["1d6", "-1"]).formula, "1d6 - 1");
});

test("rollDice: flat numbers and mixed terms", () => {
  assert.equal(rollDice("7"), 7);
  assert.equal(rollDice("2 + 3 - 1"), 4);
  for (let i = 0; i < 200; i++) {
    const r = rollDice("3d4 + 2d6 - 1");
    assert.ok(r >= 4 && r <= 23, `out of range: ${r}`);
  }
});

test("rollDice rejects things that aren't formulas", () => {
  assert.throws(() => rollDice(""));
  assert.throws(() => rollDice("1d6+fire"));
});

test("usingDice spends thrown dice first, in order", () => {
  assert.equal(usingDice([4, 6], () => rollDice("2d6+1")), 11);
  assert.equal(usingDice([20], () => rollDice("1d20")), 20);
});

test("usingDice: a die that doesn't fit the sides ends the thrown sequence", () => {
  for (let i = 0; i < 50; i++) {
    const r = usingDice([9, 1], () => rollDice("2d6"));
    assert.ok(r >= 2 && r <= 12);
  }
});

test("usingDice restores the outer sequence afterwards", () => {
  const r = usingDice([3], () => {
    usingDice([1], () => rollDice("1d6"));
    return rollDice("1d6");
  });
  assert.equal(r, 3);
});

test("withSeed makes random dice repeatable", () => {
  const a = withSeed(42, () => Array.from({ length: 10 }, () => rollDice("1d20")));
  const b = withSeed(42, () => Array.from({ length: 10 }, () => rollDice("1d20")));
  const c = withSeed(43, () => Array.from({ length: 10 }, () => rollDice("1d20")));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.every((n) => n >= 1 && n <= 20));
});

test("thrown dice win over the seed, and the seed picks up after them", () => {
  const seeded = withSeed(7, () => rollDice("1d20"));
  const mixed = withSeed(7, () => usingDice([5], () => [rollDice("1d20"), rollDice("1d20")]));
  assert.deepEqual(mixed, [5, seeded]);
});
