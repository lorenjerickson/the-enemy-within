import { test } from "node:test";
import assert from "node:assert/strict";
import { condition, fighter, move, mover, resolve } from "./harness";
import { SaveNeeded, type RoundTrap } from "@/lib/resolveRound";

const pit = (t: Partial<RoundTrap> = {}): RoundTrap => ({
  id: 1, name: "Spike pit", area: { shape: "rect", x: 2, y: 0, w: 1, h: 1 }, springs: ["enter"], who: "", often: "once", damage: "6", damage_type: "piercing",
  save_attr: "", save_dc: 12, save_half: 1, effects: [], stops: 0, find_dc: 14, found: 0, sprung: [], given: [], ...t,
});

test("walking into a trap mid-round springs it in that second", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter({ hp: 20 }) }, { traps: [pit()] });
  assert.equal(r.hp.get(1), 14);
  assert.match(r.at(2), /T1 sets off Spike pit \(6 piercing damage; 14 left\)/);
  assert.deepEqual(r.trapsSprung, [{ trapId: 1, tokenId: 1 }]);
});

test("once means once: the second creature through walks over a spent trap", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)]), mover(2, { col: 0, row: 1 }, [move(1, 0, 5), move(4, 0, 15)])], { 1: fighter(), 2: fighter() }, { traps: [pit()] });
  assert.equal(r.trapsSprung.length, 1);
  const each = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)]), mover(2, { col: 0, row: 1 }, [move(1, 0, 5), move(4, 0, 15)])], { 1: fighter(), 2: fighter() }, { traps: [pit({ often: "each" })] });
  assert.equal(each.trapsSprung.length, 2);
  const spent = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter() }, { traps: [pit({ sprung: [9] })] });
  assert.equal(spent.trapsSprung.length, 0, "spent before the round");
});

test("who it's for: a party-only trap lets the GM's creatures through", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter({ side: "hostile" }) }, { traps: [pit({ who: "party" })] });
  assert.equal(r.trapsSprung.length, 0);
});

test("a save for half; its effects only on a failed save", () => {
  const slow = condition(5, "Hobbled", [{ kind: "speed", factor: 0.5 }], { rounds: 2 });
  const saved = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter({ hp: 20, save: 15 }) }, { traps: [pit({ save_attr: "agility", given: [slow] })] });
  assert.equal(saved.hp.get(1), 17);
  assert.ok(!saved.afflictions.get(1)?.length);
  const failed = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter({ hp: 20, save: 5 }) }, { traps: [pit({ save_attr: "agility", given: [slow] })] });
  assert.equal(failed.hp.get(1), 14);
  assert.ok(failed.afflictions.get(1)?.some((a) => a.condition.name === "Hobbled"));
});

test("a player's character rolls their own save against a trap: the round waits for it", () => {
  let key = "";
  assert.throws(() => resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter() }, { traps: [pit({ save_attr: "agility" })], rollers: [1] }), (e: unknown) => {
    assert.ok(e instanceof SaveNeeded);
    assert.equal(e.save.condition, "Spike pit");
    key = e.save.key;
    return true;
  });
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter({ hp: 20 }) }, { traps: [pit({ save_attr: "agility" })], rollers: [1], decisions: { [key]: 20 } });
  assert.equal(r.hp.get(1), 17);
});

test("traps that catch whoever starts or ends the round in them", () => {
  const start = resolve([mover(1, { col: 2, row: 0 }, [move(4, 0, 10)])], { 1: fighter({ hp: 20 }) }, { traps: [pit({ springs: ["start"] })] });
  assert.match(start.at(1), /sets off Spike pit/);
  const end = resolve([mover(1, { col: 0, row: 0 }, [move(2, 0, 10)])], { 1: fighter({ hp: 20 }) }, { traps: [pit({ springs: ["end"] })] });
  assert.equal(end.at(2), "", "not on the way in");
  assert.match(end.at(6), /sets off Spike pit/);
});

test("a trap's damage can put someone down", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(4, 0, 20)])], { 1: fighter({ hp: 4 }) }, { traps: [pit()] });
  assert.equal(r.hp.get(1), 0);
  assert.match(r.text, /T1 is down/);
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 }, "the down stop where they fall");
});

test("a trap that stops the mover ends their movement for the round; their actions still happen", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)])], { 1: fighter({ hp: 20 }) }, { traps: [pit({ stops: 1 })] });
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 });
  assert.match(r.at(2), /stopped where they are/);
  const free = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)])], { 1: fighter({ hp: 20 }) }, { traps: [pit({ stops: 0 })] });
  assert.deepEqual(free.final.get(1), { col: 5, row: 0 });
});

test("round stories: whoever set it off learns how bad (and their own damage); the GM gets it all", async () => {
  const { storyFor, gmStory } = await import("@/lib/roundStory");
  const r = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)])], { 1: fighter({ hp: 20 }) }, { traps: [pit({ stops: 1 })] });
  const mine = [...storyFor(r.story, 1, () => "Ann").values()].flat();
  assert.deepEqual(mine, ["You set off a trap (Spike pit): moderate (-6), and it stops you in your tracks."]);
  assert.deepEqual(gmStory(r.story, () => "Ann").flatMap((x) => x.lines), ["Ann sets off Spike pit: moderate damage (6); it stops them."]);
  const saved = resolve([mover(1, { col: 0, row: 0 }, [move(5, 0, 25)])], { 1: fighter({ hp: 20, save: 15 }) }, { traps: [pit({ save_attr: "agility", save_half: 0, stops: 0 })] });
  assert.deepEqual([...storyFor(saved.story, 1, () => "Ann").values()].flat(), ["You set off a trap (Spike pit): you get clear."]);
});
