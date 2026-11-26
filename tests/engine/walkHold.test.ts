import { test } from "node:test";
import assert from "node:assert/strict";
import { AWAIT_WALK_MS, expired, pageMoved, walksEnded, walksStarted, type At } from "@/lib/walkHold";

const tok = (id: number, col: number, row: number) => ({ id, col, row });

test("the page says a token moved before its walk came in: it's held where it was, then follows the walk", () => {
  let { holds, seen } = pageMoved({}, [tok(1, 0, 0)], new Set(), {}, 0);
  assert.deepEqual(holds, {});
  ({ holds, seen } = pageMoved(seen, [tok(1, 6, 0)], new Set(), holds, 100));
  assert.deepEqual(holds[1], { col: 0, row: 0, until: 100 + AWAIT_WALK_MS, kind: "await" });
  holds = walksStarted(holds, [1]);
  assert.deepEqual(holds, {});
});

test("no walk comes (a GM drag, a teleport): the hold lets go after a moment", () => {
  let { holds, seen } = pageMoved({ 1: { col: 0, row: 0 } }, [tok(1, 6, 0)], new Set(), {}, 0);
  assert.ok(holds[1]);
  ({ holds, seen } = pageMoved(seen, [tok(1, 6, 0)], new Set(), holds, AWAIT_WALK_MS + 1));
  assert.deepEqual(holds, {});
  assert.deepEqual(expired({ 2: { col: 0, row: 0, until: 5, kind: "await" } }, 6), {});
});

test("a token moving while its walk plays isn't held", () => {
  const { holds } = pageMoved({ 1: { col: 0, row: 0 } }, [tok(1, 6, 0)], new Set([1]), {}, 0);
  assert.deepEqual(holds, {});
});

test("a walk ended before the page caught up: the token stays at the end, until the page says so", () => {
  let holds = walksEnded({}, [{ id: 1, at: { col: 6, row: 0 } }], { 1: { col: 0, row: 0 } }, 0);
  assert.equal(holds[1].kind, "arrived");
  let seen: Record<number, At> = { 1: { col: 0, row: 0 } };
  ({ holds, seen } = pageMoved(seen, [tok(1, 0, 0)], new Set(), holds, 500));
  assert.ok(holds[1], "page still behind: kept");
  ({ holds } = pageMoved(seen, [tok(1, 6, 0)], new Set(), holds, 1000));
  assert.deepEqual(holds, {}, "page caught up: let go, and not held again for the move");
  assert.deepEqual(walksEnded({}, [{ id: 1, at: { col: 6, row: 0 } }], { 1: { col: 6, row: 0 } }, 0), {}, "page already there");
});
