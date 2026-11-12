import { test } from "node:test";
import assert from "node:assert/strict";
import { act, attack, fighter, move, mover, resolve, wall } from "./harness";
import { ContestedMove } from "@/lib/resolveRound";

test("a planned move walks its route a square a second at 30 ft", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(3, 0, 15)])], {});
  const cols = r.frames.map((f) => f.pos[1].col);
  assert.deepEqual(cols, [1, 2, 3, 3, 3, 3], "one square a second, there at 3 s");
  assert.deepEqual(r.frames[2].pos[1], { col: 3, row: 0 });
  assert.match(r.text, /T1 ends at 3, 0/);
});

test("a straight walk across open ground stays on the straight line", () => {
  const r = resolve([mover(1, { col: 3, row: 5 }, [move(7, 5, 20)])], {});
  assert.deepEqual(r.frames.slice(0, 4).map((f) => f.pos[1]), [{ col: 4, row: 5 }, { col: 5, row: 5 }, { col: 6, row: 5 }, { col: 7, row: 5 }]);
});

test("a move round a wall follows the walkable route", () => {
  const walls = [wall(1, -5, 1, 1)];
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(2, 0, 20)])], {}, { walls });
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 });
  assert.ok(r.frames.every((f) => f.pos[1].col <= 0 || f.pos[1].row >= 1 || f.pos[1].col >= 2), "never through the wall");
});

test("someone standing in the way holds a mover back a second at a time", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(1, 0)])], {}, { bystanders: [{ tokenId: 9, name: "Crate", at: { col: 1, row: 0 } }] });
  assert.deepEqual(r.final.get(1), { col: 0, row: 0 });
  assert.match(r.at(1), /T1 is held back by Crate/);
  assert.ok(r.story.some((e) => e.k === "blocked" && e.by === 9));
});

test("held back past the end of the round, a planned action runs out of time", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(1, 0), act("search")])], {}, { bystanders: [{ tokenId: 9, name: "Crate", at: { col: 1, row: 0 } }] });
  assert.match(r.text, /T1's search runs out of time this round/);
  assert.ok(r.story.some((e) => e.k === "late"));
});

test("a body on the ground is stepped over, not a blocker", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(2, 0, 10)]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter({ hp: 0 }) });
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 });
});

test("two left in one spot: the round stops for the GM's call, which then holds", () => {
  // T1 steps into T2's square as T2 tries to leave it, but T2 is blocked by a crate: they end up sharing it.
  const movers = () => [mover(1, { col: 0, row: 0 }, [move(1, 0)]), mover(2, { col: 1, row: 0 }, [move(2, 0)])];
  const bystanders = [{ tokenId: 9, name: "Crate", at: { col: 2, row: 0 } }];
  assert.throws(() => resolve(movers(), {}, { bystanders }), (e: unknown) => {
    assert.ok(e instanceof ContestedMove);
    assert.equal(e.contest.key, "1:2@1,0");
    assert.equal(e.contest.sec, 1);
    return true;
  });
  const t1 = resolve(movers(), {}, { bystanders, decisions: { "1:2@1,0": 1 } });
  assert.deepEqual(t1.final.get(1), { col: 1, row: 0 });
  assert.notDeepEqual(t1.final.get(2), { col: 1, row: 0 }, "T2 is pushed aside");
  assert.match(t1.text, /T2 gives way to T1 and is pushed aside \(GM's call\)/);
  const t2 = resolve(movers(), {}, { bystanders, decisions: { "1:2@1,0": 2 } });
  assert.deepEqual(t2.final.get(2), { col: 1, row: 0 });
  assert.deepEqual(t2.final.get(1), { col: 0, row: 0 }, "T1 steps back where it was");
});

test("a condition that stops movement keeps them in place", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(2, 0, 10)])], { 1: fighter({}, { limits: { forbid: { movement: "Grappled" }, autofail: [], spare: [] } }) });
  assert.deepEqual(r.final.get(1), { col: 0, row: 0 });
  assert.match(r.text, /T1 can't move \(Grappled\)/);
});

test("pursue closes to 5 ft of the target and stops there", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("pursue", { target: { id: 2, name: "T2" } })]), mover(2, { col: 5, row: 0 })], {});
  assert.deepEqual(r.final.get(1), { col: 4, row: 0 });
  assert.match(r.text, /T1's pursue ends: within 5 ft of T2/);
});

test("pursue stops early once the next planned action is in range, which then happens straight away", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("pursue", { target: { id: 2, name: "T2" } }), attack(2)]), mover(2, { col: 5, row: 0 })],
    { 1: fighter({ dmg: 7 }), 2: fighter({ hp: 10 }) },
  );
  assert.match(r.text, /T1 stops their pursue: T2 is within range to attack/);
  assert.equal(r.hp.get(2), 3, "the attack lands within the round");
});

test("pursuit after a body that's down ends the chase", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("pursue", { target: { id: 2, name: "T2" } })]), mover(2, { col: 5, row: 0 })], { 1: fighter(), 2: fighter({ hp: 0 }) });
  assert.deepEqual(r.final.get(1), { col: 0, row: 0 }, "no chasing someone already down");
});

test("evade keeps away from the pursuer", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("evade", { target: { id: 2, name: "T2" } })]), mover(2, { col: 3, row: 0 })], {});
  const end = r.final.get(1)!;
  assert.ok(Math.hypot(end.col - 3, end.row) >= 8, `ended at ${end.col},${end.row}`);
});

test("a timed evade ends after its seconds, and moves planned after it are skipped", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("evade", { target: { id: 2, name: "T2" }, seconds: 2 }), move(0, 5, 25)]), mover(2, { col: 3, row: 0 })], {});
  assert.match(r.text, /T1's evade ends after 2 s/);
  assert.match(r.text, /planned move is skipped/);
});

test("gridless maps move smoothly along a straight line", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(3, 4, 25)])], {}, { gridless: true });
  assert.deepEqual(r.final.get(1), { col: 3, row: 4 });
  assert.deepEqual(r.frames[0].pos[1], { col: 0.6, row: 0.8 });
});
