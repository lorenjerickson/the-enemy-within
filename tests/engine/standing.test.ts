import { test } from "node:test";
import assert from "node:assert/strict";
import { pointAlong, routeTimes, standingRoute, truncateRoute, walkLength } from "@/lib/standing";
import type { Segment } from "@/lib/visibility";

const wall = (x1: number, y1: number, x2: number, y2: number): Segment => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
const end = (r: { x: number; y: number }[]) => r[r.length - 1];

test("follow: toward them, no further than they went, never onto them", () => {
  assert.deepEqual(end(standingRoute("follow", { x: 0, y: 0 }, { x: 7, y: 0 }, 3, [], false)), { x: 3, y: 0 });
  assert.deepEqual(end(standingRoute("follow", { x: 4, y: 0 }, { x: 7, y: 0 }, 5, [], false)), { x: 6, y: 0 }, "stops next to them");
  assert.deepEqual(standingRoute("follow", { x: 0, y: 0 }, { x: 7, y: 0 }, 0, [], false), [{ x: 0, y: 0 }], "they didn't move: nor do you");
});

test("follow goes around a wall by the shortest way", () => {
  const r = standingRoute("follow", { x: 1, y: 3 }, { x: 1, y: -1 }, 2, [wall(0, 2, 3, 2)], false);
  assert.equal(walkLength(r, false), 2);
  assert.notEqual(end(r).x, 1);
  assert.ok(end(r).y >= 2);
});

test("pursue: all the way to next to them", () => {
  assert.deepEqual(end(standingRoute("pursue", { x: 0, y: 0 }, { x: 7, y: 0 }, 1, [], false)), { x: 6, y: 0 });
});

test("evade: as far away as the distance they went allows", () => {
  const r = standingRoute("evade", { x: 3, y: 0 }, { x: 1, y: 0 }, 2, [], false);
  assert.equal(walkLength(r, false), 2);
  assert.equal(end(r).x, 5);
});

test("gridless follow keeps to the distance they went", () => {
  const r = standingRoute("follow", { x: 0, y: 0 }, { x: 10, y: 0 }, 3, [], true);
  assert.ok(Math.abs(end(r).x - 3) < 0.06 && end(r).y === 0, JSON.stringify(end(r)));
});

test("along a route: the square (or point) so far along, a route cut short, and the time at each point", () => {
  const r = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }];
  assert.deepEqual(pointAlong(r, 2, false), { x: 2, y: 0 });
  assert.deepEqual(pointAlong(r, 5, false), { x: 4, y: 1 });
  assert.deepEqual(pointAlong(r, 99, false), { x: 4, y: 2 });
  assert.deepEqual(truncateRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], 2, false), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.deepEqual(truncateRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2.5, true), [{ x: 0, y: 0 }, { x: 2.5, y: 0 }]);
  assert.deepEqual(routeTimes([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }], 10, false), [0, 0.5, 1.5], "10 ft/s: half a second a square");
});
