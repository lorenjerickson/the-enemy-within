import { test } from "node:test";
import assert from "node:assert/strict";
import { act, condition, fighter, gear, mover, resolve, wall } from "./harness";
import { placeArea, type LastingArea } from "@/lib/aoe";
import { SaveNeeded } from "@/lib/resolveRound";

const fireball = (extra = {}) => gear({ name: "Fireball", range: 20, damage: "8", damageType: "fire", area: { shape: "circle", ft: 10, dc: 13, save: "agility", half: true }, ...extra });
const aimAt = (col: number, row: number) => ({ col: col + 0.5, row: row + 0.5 });

test("an area attack: everyone caught saves, success halves, the attacker and those outside are spared", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("attack", { use: fireball(), aim: aimAt(5, 5) })]), mover(2, { col: 5, row: 5 }), mover(3, { col: 6, row: 5 }), mover(4, { col: 9, row: 5 })],
    { 1: fighter({ dmg: 8 }), 2: fighter({ save: 15 }), 3: fighter({ save: 5 }), 4: fighter({ save: 5 }) },
  );
  assert.equal(r.hp.get(1), 20);
  assert.equal(r.hp.get(2), 16, "saved: half");
  assert.equal(r.hp.get(3), 12, "failed: full");
  assert.equal(r.hp.get(4), 20, "outside");
  const fx = r.frames[1].fx!.find((f) => f.look === "area")!;
  assert.deepEqual("hits" in fx ? fx.hits.map((h) => [h.id, h.outcome]) : [], [[2, "half"], [3, "hit"]]);
});

test("a save that negates leaves nothing; a wall shelters whoever is behind it", () => {
  const spec = fireball({ area: { shape: "circle", ft: 10, dc: 13, save: "agility", half: false } });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("attack", { use: spec, aim: aimAt(5, 5) })]), mover(2, { col: 5, row: 5 }), mover(3, { col: 5, row: 7 })],
    { 1: fighter({ dmg: 8 }), 2: fighter({ save: 15 }), 3: fighter({ save: 5 }) },
    { walls: [wall(3, 7, 8, 7)] },
  );
  assert.equal(r.hp.get(2), 20);
  assert.equal(r.hp.get(3), 20);
});

test("an area for enemies only spares friends; 'up to N' takes the nearest to the aim", () => {
  const selective = fireball({ targeting: { who: "enemy", count: "all", n: 0 } });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("attack", { use: selective, aim: aimAt(5, 5) })]), mover(2, { col: 5, row: 5 }), mover(3, { col: 6, row: 5 })],
    { 1: fighter({ dmg: 8, side: "party" }), 2: fighter({ save: 5 }), 3: fighter({ save: 5, side: "party" }) },
  );
  assert.equal(r.hp.get(2), 12);
  assert.equal(r.hp.get(3), 20);

  const two = fireball({ targeting: { who: "", count: "upto", n: 1 } });
  const r2 = resolve(
    [mover(1, { col: 0, row: 0 }, [act("attack", { use: two, aim: aimAt(5, 5) })]), mover(2, { col: 6, row: 6 }), mover(3, { col: 5, row: 5 })],
    { 1: fighter({ dmg: 8 }), 2: fighter({ save: 5 }), 3: fighter({ save: 5 }) },
  );
  assert.equal(r2.hp.get(3), 12, "nearest the aim");
  assert.equal(r2.hp.get(2), 20);
});

test("cones go from the actor towards the aim", () => {
  const breath = gear({ name: "Breath", damage: "6", area: { shape: "cone", ft: 15, dc: 12, save: "agility", half: true } });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("attack", { use: breath, aim: aimAt(5, 0) })]), mover(2, { col: 2, row: 0 }), mover(3, { col: 0, row: 3 })],
    { 1: fighter({ dmg: 6 }), 2: fighter({ save: 1 }), 3: fighter({ save: 1 }) },
  );
  assert.equal(r.hp.get(2), 14);
  assert.equal(r.hp.get(3), 20);
});

test("an area that stays on the map is handed back as a lasting area", () => {
  const cloud = fireball({ name: "Stinking cloud", area: { shape: "circle", ft: 10, dc: 13, save: "fortitude", half: true, minutes: 1, look: "fog" } });
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("attack", { use: cloud, aim: aimAt(5, 5) })])], { 1: fighter() });
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].name, "Stinking cloud");
  assert.equal(r.created[0].minutes, 1);
  assert.equal(r.created[0].by, 1);
  assert.match(r.text, /Stinking cloud stays for 1 min/);
});

const lastingAt = (col: number, row: number, extra: Partial<LastingArea> = {}): LastingArea => ({
  id: 1, name: "Fire wall", look: "fire", area: placeArea("circle", 5, { x: 0, y: 0 }, { x: col + 0.5, y: row + 0.5 }), damage: "4", dc: 12, save: "agility", half: true, ends: 99, ...extra,
});

test("lasting areas catch whoever is in them at the end of the round", () => {
  const r = resolve([mover(2, { col: 5, row: 5 }), mover(3, { col: 9, row: 9 })], { 2: fighter({ save: 5 }), 3: fighter({ save: 5 }) }, { lasting: [lastingAt(5, 5)] });
  assert.equal(r.hp.get(2), 16);
  assert.equal(r.hp.get(3), 20);
  assert.match(r.at(6), /Fire wall lingers: 4 damage/);
});

test("'as they come into it' areas catch someone walking in, once a round", () => {
  const r = resolve(
    [mover(2, { col: 3, row: 5 }, [{ kind: "move", to: { col: 4, row: 5 }, feet: 5 }])],
    { 2: fighter({ save: 5 }) },
    { lasting: [lastingAt(5, 5, { fires: ["enter"] })] },
  );
  assert.equal(r.hp.get(2), 16);
  assert.match(r.text, /catches T2 coming into it/);
});

test("a lasting area's conditions land on those who fail its save", () => {
  const burning = condition(9, "Burning", [{ kind: "periodic", value: "1", heal: false, damage_type: "fire" }], { rounds: 2 });
  const r = resolve([mover(2, { col: 5, row: 5 })], { 2: fighter({ save: 5 }) }, { lasting: [lastingAt(5, 5, { conditions: [burning] })] });
  assert.ok(r.afflictions.get(2)?.some((a) => a.condition.name === "Burning"));
});

test("a player's character rolls their own area save: the round waits for it, then uses it", () => {
  const movers = () => [mover(1, { col: 0, row: 0 }, [act("attack", { use: fireball(), aim: aimAt(5, 5) })]), mover(2, { col: 5, row: 5 })];
  const fighters = () => ({ 1: fighter({ dmg: 8 }), 2: fighter({ save: 1 }) });
  let key = "";
  assert.throws(() => resolve(movers(), fighters(), { rollers: [2] }), (e: unknown) => {
    assert.ok(e instanceof SaveNeeded);
    assert.equal(e.save.tokenId, 2);
    assert.equal(e.save.attr, "agility");
    assert.equal(e.save.dc, 13);
    key = e.save.key;
    return true;
  });
  const r = resolve(movers(), fighters(), { rollers: [2], decisions: { [key]: 17 } });
  assert.equal(r.hp.get(2), 16, "their 17 saved: half");
});
