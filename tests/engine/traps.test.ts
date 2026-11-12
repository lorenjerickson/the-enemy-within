import { test } from "node:test";
import assert from "node:assert/strict";
import { canSpring, describeTrapArea, entersTrap, inTrap, sprungByStep, sprungWhereStanding, type Trap, type TrapArea } from "@/lib/traps";

const pit: TrapArea = { shape: "rect", x: 3, y: 0, w: 1, h: 1 }; // one square, col 3 row 0
const plate: TrapArea = { shape: "circle", x: 5.5, y: 5.5, r: 0.4 }; // a small plate in the middle of a square
const wire: TrapArea = { shape: "line", x1: 6, y1: -2, x2: 6, y2: 2 }; // across a corridor at x = 6
const c = (col: number, row: number) => ({ x: col + 0.5, y: row + 0.5 }); // a token's centre

const trap = (area: TrapArea, t: Partial<Trap> = {}): Trap => ({
  id: 1, name: "Trap", area, springs: ["enter"], who: "", often: "once", damage: "2d6", damage_type: "piercing", save_attr: "agility", save_dc: 12, save_half: 1,
  effects: [], stops: 1, find_dc: 14, found: 0, sprung: [], ...t,
});

test("inside a circle, a rectangle, or standing on a tripwire", () => {
  assert.ok(inTrap(pit, c(3, 0)));
  assert.ok(!inTrap(pit, c(4, 0)));
  assert.ok(inTrap(plate, c(5, 5)));
  assert.ok(!inTrap(plate, c(5, 6)));
  assert.ok(inTrap(wire, { x: 6.2, y: 0 }));
  assert.ok(!inTrap(wire, c(6, 0)), "a square's centre is half a square from its edge");
});

test("coming in: stepping onto it, passing through a small one, crossing a tripwire; starting inside doesn't count", () => {
  assert.ok(entersTrap(pit, c(2, 0), c(3, 0)));
  assert.ok(!entersTrap(pit, c(3, 0), c(4, 0)), "leaving isn't coming in");
  assert.ok(entersTrap(plate, c(4, 5), c(6, 5)), "a two-square step right over it");
  assert.ok(!entersTrap(plate, c(4, 4), c(6, 4)), "passing beside it");
  assert.ok(entersTrap(wire, c(5, 0), c(6, 0)), "crossing the wire between squares");
  assert.ok(!entersTrap(wire, c(4, 0), c(5, 0)));
});

test("who it's for, and how often", () => {
  assert.ok(canSpring(trap(pit), 1, "party"));
  assert.ok(!canSpring(trap(pit, { who: "hostile" }), 1, "party"));
  assert.ok(canSpring(trap(pit, { who: "hostile" }), 2, "hostile"));
  assert.ok(!canSpring(trap(pit, { sprung: [7] }), 1, "party"), "once: spent by anyone");
  assert.ok(canSpring(trap(pit, { often: "each", sprung: [7] }), 1, "party"));
  assert.ok(!canSpring(trap(pit, { often: "each", sprung: [1] }), 1, "party"), "each: not twice on the same creature");
  assert.ok(canSpring(trap(pit, { often: "always", sprung: [1] }), 1, "party"));
});

test("a step springs the traps it comes into that spring on entering", () => {
  const traps = [trap(pit, { id: 1 }), trap(wire, { id: 2 }), trap(pit, { id: 3, springs: ["end"] }), trap(pit, { id: 4, who: "hostile" })];
  assert.deepEqual(sprungByStep(traps, 9, "party", c(2, 0), c(3, 0)).map((t) => t.id), [1]);
  assert.deepEqual(sprungByStep(traps, 9, "party", c(5, 0), c(6, 0)).map((t) => t.id), [2]);
  assert.deepEqual(sprungByStep(traps, 9, "party", c(0, 5), c(1, 5)), []);
});

test("standing in one at the start of a round, or at the end of a move", () => {
  const traps = [trap(pit, { id: 1, springs: ["start"] }), trap(pit, { id: 2, springs: ["end", "enter"] }), trap(pit, { id: 3 })];
  assert.deepEqual(sprungWhereStanding(traps, 9, "party", c(3, 0), "start").map((t) => t.id), [1]);
  assert.deepEqual(sprungWhereStanding(traps, 9, "party", c(3, 0), "end").map((t) => t.id), [2]);
  assert.deepEqual(sprungWhereStanding(traps, 9, "party", c(4, 0), "end"), []);
});

test("descriptions in feet", () => {
  assert.equal(describeTrapArea({ shape: "circle", x: 0, y: 0, r: 2 }), "10 ft radius");
  assert.equal(describeTrapArea({ shape: "rect", x: 0, y: 0, w: 3, h: 2 }), "15 × 10 ft");
  assert.equal(describeTrapArea(wire), "a 20 ft tripwire");
});
