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

test("fog in a round: someone in it further than 15 ft can't be seen (disadvantage); smoke a trap lets out counts from the second it goes off", async () => {
  const { areaFromDrawn } = await import("@/lib/aoe");
  const bow = gear({ name: "Bow", range: 20 });
  const shoot = (o: Parameters<typeof resolve>[2], plan = [] as ReturnType<typeof move>[]) => {
    const archer = fighter({ side: "party" });
    resolve([mover(1, { col: 0, row: 0 }, [act("attack", { target: { id: 2, name: "T2" }, use: bow })]), mover(2, { col: 7, row: 0 }, plan)], { 1: archer, 2: foe() }, o);
    return archer.attacks[0]?.more ?? [];
  };
  assert.deepEqual(shoot({}), [], "clear: seen");
  const fog = areaFromDrawn({ shape: "circle", x: 7.5, y: 0.5, r: 2 });
  const { inArea } = await import("@/lib/aoe");
  assert.deepEqual(shoot({ fogAt: (p) => inArea(fog, p) }), ["disadvantage"], "in fog, 35 ft off");
  const vent = { id: -5, name: "Smoke vent", area: { shape: "rect" as const, x: 8, y: 0, w: 1, h: 1 }, springs: ["enter" as const], who: "" as const, often: "always" as const, damage: null, damage_type: "", save_attr: "", save_dc: 99, save_half: 0, effects: [], stops: 0, find_dc: 14, found: 0, sprung: [], given: [] };
  const smoke = areaFromDrawn({ shape: "circle", x: 8.5, y: 0.5, r: 2 });
  assert.deepEqual(shoot({ traps: [vent] as never, smokeTraps: new Map([[-5, smoke]]) }, [move(8, 0, 5)]), ["disadvantage"], "they step on the vent first: lost in its smoke");
  assert.deepEqual(shoot({ traps: [vent] as never, smokeTraps: new Map([[-5, smoke]]) }), [], "nobody set it off: no smoke");
});
