import { test } from "node:test";
import assert from "node:assert/strict";
import { clearPath, crosses, pointToSegment, reachableSquares, routeTo, shortestPath, squareKey, squareRoute } from "@/lib/movement";
import { blockingSegments, insidePolygon, movementBlockers, visibilityPolygon, type Segment } from "@/lib/visibility";
import { areaFires, areaPolygon, caughtBy, describeArea, inArea, placeArea } from "@/lib/aoe";

const wall = (x1: number, y1: number, x2: number, y2: number): Segment => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

test("crosses: proper crossings, touching ends, and misses", () => {
  assert.ok(crosses({ x: 0, y: 0 }, { x: 2, y: 2 }, wall(0, 2, 2, 0)));
  assert.ok(crosses({ x: 0, y: 0 }, { x: 1, y: 1 }, wall(1, 1, 2, 0)), "touching a wall's end counts");
  assert.ok(!crosses({ x: 0, y: 0 }, { x: 1, y: 0 }, wall(0, 1, 1, 1)));
});

test("reachableSquares: 8-way steps, diagonals cost one", () => {
  const r = reachableSquares({ col: 0, row: 0 }, 2, []);
  assert.equal(r.size, 25);
  assert.equal(r.get(squareKey(2, 2))?.steps, 2);
  assert.equal(r.get(squareKey(1, 0))?.steps, 1);
  assert.ok(!r.has(squareKey(3, 0)));
});

test("reachableSquares: a wall makes you walk round it", () => {
  // Wall along x = 1 from y = -5 to y = 1.5: the square straight east is behind it.
  const walls = [wall(1, -5, 1, 1.5)];
  const r = reachableSquares({ col: 0, row: 0 }, 6, walls);
  const east = r.get(squareKey(1, 0));
  assert.ok(east, "reachable going round");
  assert.equal(east!.steps, 4, `went round (${east!.steps} steps)`);
  assert.ok(!reachableSquares({ col: 0, row: 0 }, 3, walls).has(squareKey(1, 0)), "too far round");
  assert.ok(true, `went round (${east!.steps} steps)`);
  const route = routeTo(r, squareKey(1, 0));
  assert.deepEqual(route[0], { col: 0, row: 0 });
  assert.deepEqual(route.at(-1), { col: 1, row: 0 });
});

test("squareRoute finds the shortest allowed route, or null", () => {
  const route = squareRoute({ col: 0, row: 0 }, { col: 3, row: 0 }, [], () => true)!;
  assert.equal(route.length, 4);
  const boxed = [wall(-1, -1, 2, -1), wall(2, -1, 2, 2), wall(2, 2, -1, 2), wall(-1, 2, -1, -1)];
  assert.equal(squareRoute({ col: 0, row: 0 }, { col: 5, row: 5 }, boxed, () => true, 500), null);
  assert.equal(squareRoute({ col: 0, row: 0 }, { col: 3, row: 0 }, [], (c) => c < 2), null, "only through allowed squares");
});

test("pointToSegment distances", () => {
  assert.equal(pointToSegment({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }), 1);
  assert.equal(pointToSegment({ x: 3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }), 2);
  assert.equal(pointToSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }), Math.SQRT2);
});

test("clearPath keeps the token's body off walls, but lets it step away from one", () => {
  const w = [wall(0, 1, 10, 1)];
  assert.ok(clearPath({ x: 0, y: 0 }, { x: 5, y: 0 }, w));
  assert.ok(!clearPath({ x: 0, y: 0 }, { x: 0, y: 2 }, w), "crossing");
  assert.ok(!clearPath({ x: 0, y: 0 }, { x: 5, y: 0.8 }, w), "body scraping the wall");
  assert.ok(clearPath({ x: 2, y: 0.8 }, { x: 2, y: 0 }, w), "already close, moving away");
});

test("shortestPath goes round a wall's end", () => {
  const w = [wall(2, -3, 2, 3)];
  const p = shortestPath({ x: 0, y: 0 }, { x: 4, y: 0 }, w, () => true)!;
  assert.ok(p.length > 2);
  for (let i = 1; i < p.length; i++) assert.ok(clearPath(p[i - 1], p[i], w));
  assert.deepEqual(shortestPath({ x: 0, y: 0 }, { x: 4, y: 0 }, [], () => true), [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
});

test("visibility: a wall hides what's behind it", () => {
  const poly = visibilityPolygon({ x: 0, y: 0 }, 10, [wall(2, -1, 2, 1)]);
  assert.ok(insidePolygon({ x: 1, y: 0 }, poly));
  assert.ok(!insidePolygon({ x: 4, y: 0 }, poly));
  assert.ok(insidePolygon({ x: 0, y: 4 }, poly));
  assert.ok(!insidePolygon({ x: 11, y: 0 }, visibilityPolygon({ x: 0, y: 0 }, 10, [])), "beyond the radius");
});

test("which structures block sight versus movement", () => {
  const s = [
    { kind: "wall", x1: 0, y1: 0, x2: 1, y2: 0, open: 0 },
    { kind: "door", x1: 1, y1: 0, x2: 2, y2: 0, open: 0 },
    { kind: "door", x1: 2, y1: 0, x2: 3, y2: 0, open: 1 },
    { kind: "window", x1: 3, y1: 0, x2: 4, y2: 0, open: 0 },
  ];
  assert.equal(blockingSegments(s).length, 2, "wall + closed door");
  assert.equal(movementBlockers(s).length, 3, "wall + closed door + window");
});

test("areas: circle around the aim, cone and line from the actor", () => {
  const circle = placeArea("circle", 10, { x: 0, y: 0 }, { x: 5, y: 5 });
  assert.deepEqual(circle.origin, { x: 5, y: 5 });
  assert.equal(circle.size, 2);
  assert.ok(inArea(circle, { x: 6.5, y: 5 }));
  assert.ok(!inArea(circle, { x: 7.5, y: 5 }));

  const cone = placeArea("cone", 15, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(inArea(cone, { x: 2, y: 0 }));
  assert.ok(inArea(cone, { x: 2.5, y: 1.2 }), "as wide as it is long");
  assert.ok(!inArea(cone, { x: 2, y: 1.5 }));
  assert.ok(!inArea(cone, { x: -1, y: 0 }), "not behind");
  assert.ok(!inArea(cone, { x: 0, y: 0 }), "not the actor");

  const line = placeArea("line", 20, { x: 0, y: 0 }, { x: 0, y: 10 });
  assert.ok(inArea(line, { x: 0.4, y: 3 }));
  assert.ok(!inArea(line, { x: 0.6, y: 3 }), "5 ft wide");
  assert.ok(!inArea(line, { x: 0, y: 4.5 }), "20 ft long");
});

test("caughtBy: walls between the area's start and a creature shelter it", () => {
  const a = placeArea("circle", 15, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.ok(caughtBy(a, { x: 2, y: 0 }, []));
  assert.ok(!caughtBy(a, { x: 2, y: 0 }, [wall(1, -1, 1, 1)]));
});

test("areaPolygon and descriptions", () => {
  assert.equal(areaPolygon(placeArea("circle", 5, { x: 0, y: 0 }, { x: 0, y: 0 })).length, 48);
  assert.equal(areaPolygon(placeArea("line", 5, { x: 0, y: 0 }, { x: 1, y: 0 })).length, 4);
  assert.equal(describeArea({ shape: "circle", ft: 20 }), "20 ft radius");
  assert.equal(describeArea({ shape: "cone", ft: 15 }), "15 ft cone");
  assert.deepEqual(areaFires(null), ["end"]);
  assert.deepEqual(areaFires("enter,bogus,start"), ["enter", "start"]);
});
