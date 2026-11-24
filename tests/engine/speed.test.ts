import { test } from "node:test";
import assert from "node:assert/strict";
import { asSpeed, convertSpeed, feetPerSecond, formatSpeed } from "@/lib/speed";

test("old plain numbers are feet per round: 30 is 5 ft/s, 60 is 10 ft/s", () => {
  assert.equal(feetPerSecond(asSpeed(30)), 5);
  assert.equal(feetPerSecond(asSpeed(60)), 10);
});

test("any distance over any time comes out in feet per second", () => {
  assert.ok(Math.abs(feetPerSecond({ value: 70, dist: "mi", per: "h" }) - 102.667) < 0.01, "a zombie cheetah's 70 mph");
  assert.equal(feetPerSecond({ value: 60, dist: "ft", per: "round" }), 10);
  assert.ok(Math.abs(feetPerSecond({ value: 3, dist: "m", per: "s" }) - 9.84) < 0.01);
  assert.equal(feetPerSecond({ value: 120, dist: "yd", per: "min" }), 6);
});

test("converting and showing speeds", () => {
  assert.deepEqual(convertSpeed(asSpeed(30), "ft", "s"), { value: 5, dist: "ft", per: "s" });
  assert.equal(formatSpeed({ value: 70, dist: "mi", per: "h" }), "70 mph");
  assert.equal(formatSpeed({ value: 5, dist: "ft", per: "s" }), "5 ft/s");
  assert.deepEqual(asSpeed({ value: "x", dist: "furlong" }), { value: 0, dist: "ft", per: "s" }, "junk: 0 ft/s");
});
