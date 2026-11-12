import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { addTrap, deleteTrap, getTrap, listTraps, markTrapSprung, moveTrap, resetTrap, saveTrap, setTrapFound } from "@/lib/db";

const lv = level();

test("a placed trap starts with the defaults and hidden", () => {
  const id = addTrap(lv, { shape: "rect", x: 3, y: 0, w: 1, h: 1 }, "Pit");
  const t = getTrap(id)!;
  assert.equal(t.level_id, lv);
  assert.deepEqual({ name: t.name, springs: t.springs, who: t.who, often: t.often, save: [t.save_attr, t.save_dc, t.save_half], stops: t.stops, find: t.find_dc, found: t.found, sprung: t.sprung },
    { name: "Pit", springs: ["enter"], who: "", often: "once", save: ["agility", 12, 1], stops: 1, find: 14, found: 0, sprung: [] });
});

test("saving what it does, moving it, finding it, springing and re-arming it, removing it", () => {
  const id = addTrap(lv, { shape: "circle", x: 5.5, y: 5.5, r: 1 });
  saveTrap(id, { name: "Gas vent", springs: ["enter", "start"], who: "party", often: "each", damage: "", damage_type: "poison", save_attr: "fortitude", save_dc: 14, save_half: 0, effects: [3], stops: 0, find_dc: 16 });
  moveTrap(id, { shape: "line", x1: 0, y1: 0, x2: 0, y2: 4 });
  setTrapFound(id, true);
  markTrapSprung(id, 7);
  markTrapSprung(id, 7);
  let t = getTrap(id)!;
  assert.equal(t.name, "Gas vent");
  assert.deepEqual(t.springs, ["enter", "start"]);
  assert.equal(t.damage, null, "no dice is no damage");
  assert.deepEqual(t.effects, [3]);
  assert.equal(t.area.shape, "line");
  assert.equal(t.found, 1);
  assert.deepEqual(t.sprung, [7]);
  resetTrap(id);
  t = getTrap(id)!;
  assert.deepEqual(t.sprung, []);
  deleteTrap(id);
  assert.equal(getTrap(id), undefined);
  assert.ok(listTraps(lv).every((x) => x.id !== id));
});

test("a trap with no 'when' ticked springs only when a trigger sets it off", () => {
  const id = addTrap(lv, { shape: "rect", x: 0, y: 0, w: 1, h: 1 });
  saveTrap(id, { name: "Ceiling", springs: [], who: "", often: "once", damage: "4d6", damage_type: "bludgeoning", save_attr: "agility", save_dc: 14, save_half: 1, effects: [], stops: 1, find_dc: 18 });
  assert.deepEqual(getTrap(id)!.springs, []);
});
