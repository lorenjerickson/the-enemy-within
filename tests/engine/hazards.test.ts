import { test } from "node:test";
import assert from "node:assert/strict";
import { UNTIL_REMOVED } from "@/lib/aoe";
import { catchesWhen, heardBy, isActive, mayCatch, rearm, seenBy, setsOff, spring, type Hazard } from "@/lib/hazards";

const base = (h: Partial<Hazard> = {}): Hazard => ({ id: 1, name: "Hazard", look: "fog", area: { shape: "circle", centre: { x: 2, y: 2 }, radius: 1 } as never, damage: "2d6", dc: 12, save: "agility", half: true, ends: UNTIL_REMOVED, ...h });
const now = 100;

test("an area as it was is an always-active hazard: active until it ends or is switched off", () => {
  const wall = base({ name: "Fire wall", ends: now + 1, fires: ["enter", "end"] });
  assert.ok(isActive(wall, now));
  assert.ok(catchesWhen(wall, now, "enter") && !catchesWhen(wall, now, "start"));
  assert.ok(!isActive(wall, now + 1), "burnt out");
  assert.ok(!isActive({ ...wall, off: true }, now));
  assert.ok(!setsOff(wall, "enter"), "nothing to set off");
});

test("a spike pit: dormant, set off by coming in, an instant, once per creature; re-armed", () => {
  const pit = base({ name: "Spike pit", activation: "dormant", setOffBy: ["enter"], activeFor: "instant", often: "each", stops: true, visibility: "hidden" });
  assert.ok(setsOff(pit, "enter") && !setsOff(pit, "start"));
  assert.ok(!isActive(pit, now), "dormant");
  const sprung = spring(pit, [7], now);
  assert.deepEqual(sprung.sprung, [7]);
  assert.ok(!isActive(sprung, now), "an instant: back to waiting");
  assert.ok(!mayCatch(sprung, 7, "party") && mayCatch(sprung, 8, "party"), "once per creature");
  assert.ok(seenBy({ ...sprung, seenBy: [7] }, 7) && !seenBy(sprung, 9), "seen by whoever saw it go off");
  assert.deepEqual(rearm(sprung).sprung, []);
});

test("a collapsing floor: once; spent once it has gone off, gone from the map, never re-armed", () => {
  const floor = spring(base({ activation: "dormant", setOffBy: ["enter"], often: "once", visibility: "shown" }), [3], now);
  assert.equal(floor.spent, true);
  assert.ok(!setsOff(floor, "enter") && !seenBy(floor, 3) && !isActive(floor, now));
  assert.equal(rearm(floor), floor);
});

test("a gas trap: set off by a map trigger (no one in it) or stepping in, then a cloud for 10 rounds; its hiss heard while hidden", () => {
  const gas = base({ name: "Gas trap", activation: "dormant", setOffBy: ["enter"], byTrigger: true, activeFor: "time", activeMinutes: 1, fires: ["start"], visibility: "hidden", sound: 5, soundHidden: true });
  assert.ok(heardBy(gas, 4, now), "a hiss before anyone finds it");
  const cloud = spring(gas, [], now);
  assert.deepEqual(cloud.sprung, [0], "went off on no one");
  assert.ok(isActive(cloud, now + 0.5) && catchesWhen(cloud, now + 0.5, "start"));
  assert.ok(!isActive(cloud, now + 1), "10 rounds later it's dormant again");
  assert.ok(!heardBy({ ...gas, soundHidden: false }, 4, now), "without the option: heard only once seen");
});

test("a ward: for the party's enemies only, never seen by players", () => {
  const ward = base({ who: "hostile", visibility: "gm", damage: null });
  assert.ok(mayCatch(ward, 1, "hostile") && !mayCatch(ward, 2, "party"));
  assert.ok(!seenBy(ward, 2));
});

test("triggered until switched off: stays active once set off", () => {
  const h = spring(base({ activation: "dormant", setOffBy: ["start"], activeFor: "untilOff" }), [2], now);
  assert.ok(isActive(h, now + 50));
});
