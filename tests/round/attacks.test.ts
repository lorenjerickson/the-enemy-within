import { test } from "node:test";
import assert from "node:assert/strict";
import { act, attack, fighter, gear, mover, resolve } from "./harness";
import { withSeed, rollDice } from "@/lib/dice";

test("a melee attack in reach hits when the roll beats defense, at the second it finishes", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ hit: 15, dmg: 6 }), 2: fighter({ def: 12, hp: 10 }) });
  assert.equal(r.hp.get(2), 4);
  assert.match(r.at(2), /T1 attacks T2: 15 \(fixed\) vs defense 12: hit for 6/);
  assert.equal(r.at(1), "", "nothing yet at 1 s");
  assert.deepEqual(r.frames[1].fx, [{ look: "slash", from: 1, to: 2, outcome: "hit" }]);
});

test("a roll under defense misses", () => {
  const miss = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ hit: 11 }), 2: fighter({ def: 12, hp: 10 }) });
  assert.equal(miss.hp.get(2), 10);
  assert.match(miss.text, /: miss\./);
  assert.deepEqual(miss.frames[1].fx, [{ look: "slash", from: 1, to: 2, outcome: "miss" }]);
});

test("an attack on someone not on the map fails: no target", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)])], { 1: fighter(), 2: fighter({ hp: 10 }) });
  assert.match(r.text, /T1's attack fails: no target/);
});

test("criticals always hit and double the damage, unless the target is immune to them", () => {
  const crit = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ hit: 3, nat: 20, dmg: 4 }), 2: fighter({ def: 18, hp: 20 }) });
  assert.equal(crit.hp.get(2), 12);
  assert.match(crit.text, /critically hit/);
  const immune = fighter({ def: 18, hp: 20 });
  immune.statuses = [{ source: "Adamantine", boosts: [], grants: [], tweaks: [{ kind: "nocrit" }] }];
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ hit: 3, nat: 20, dmg: 4 }), 2: immune });
  assert.equal(r.hp.get(2), 16);
  assert.match(r.text, /immune: a normal hit/);
});

test("a fumble misses even when the total would hit", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter({ hit: 30, nat: 1 }), 2: fighter({ def: 12, hp: 10 }) });
  assert.equal(r.hp.get(2), 10);
  assert.match(r.text, /a natural 1/);
});

test("dropping someone to 0 puts them down, and the down stop acting", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [attack(1, { use: gear({ seconds: 3 }) })])],
    { 1: fighter({ dmg: 10 }), 2: fighter({ hp: 8 }) },
  );
  assert.equal(r.hp.get(2), 0);
  assert.ok(r.frames[1].down.includes(2));
  assert.equal(r.hp.get(1), 20, "T2's slower attack never lands");
  assert.match(r.text, /T2 is down/);
});

test("attacking someone already down fails", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter({ hp: 0 }) });
  assert.match(r.text, /T2 is already down/);
});

test("being hit interrupts an action under way, but blows in the same second both land", () => {
  const slow = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2, { use: gear({ seconds: 3 }) })]), mover(2, { col: 1, row: 0 }, [attack(1)])],
    { 1: fighter(), 2: fighter() },
  );
  assert.match(slow.text, /T1's attack is interrupted: they were hit/);
  assert.equal(slow.hp.get(2), 20);

  const together = resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [attack(1)])],
    { 1: fighter({ dmg: 3 }), 2: fighter({ dmg: 4 }) },
  );
  assert.equal(together.hp.get(1), 16);
  assert.equal(together.hp.get(2), 17);
});

test("an attack out of reach makes them close in first, then strike", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 3, row: 0 })], { 1: fighter({ dmg: 5 }), 2: fighter({ hp: 10 }) });
  assert.match(r.at(1), /T1 closes in on T2 to attack/);
  assert.deepEqual(r.final.get(1), { col: 2, row: 0 });
  assert.match(r.at(4), /hit for 5/, "two seconds closing in, then the two-second attack");
  assert.equal(r.hp.get(2), 5);
  assert.equal(r.story.filter((e) => e.k === "close").length, 1);
});

test("a ranged weapon strikes from where they stand, drawn as a projectile", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)], { attackRange: 6 }), mover(2, { col: 5, row: 0 })], { 1: fighter(), 2: fighter() });
  assert.deepEqual(r.final.get(1), { col: 0, row: 0 });
  assert.equal(r.frames[1].fx?.[0].look, "arrow");
});

test("walls block reach", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2)], { attackRange: 6 }), mover(2, { col: 3, row: 0 })], { 1: fighter(), 2: fighter() }, { walls: [{ a: { x: 2, y: -10 }, b: { x: 2, y: 10 } }] });
  assert.equal(r.hp.get(2), 20);
  assert.match(r.text, /out of reach|runs out of time/);
});

test("resistance halves, vulnerability doubles, immunity ignores typed damage", () => {
  const hit = (resist: any) => resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use: gear({ damageType: "fire" }) })]), mover(2, { col: 1, row: 0 })], { 1: fighter({ dmg: 9 }), 2: fighter({ hp: 30 }, { resist }) }).hp.get(2);
  assert.equal(hit({ fire: ["resistant"] }), 26);
  assert.equal(hit({ fire: ["vulnerable"] }), 12);
  assert.equal(hit({ fire: ["immune"] }), 30);
  assert.equal(hit({ cold: ["immune"] }), 21);
});

test("statuses land on the target on a hit, and on the user hit or miss", () => {
  const use = gear({ statuses: { minutes: 0.1, target: { source: "Dazzle", boosts: [], grants: [{ roll: "attack", mode: "disadvantage" }] }, self: { source: "Focus", boosts: [{ target: "defense", value: "+1" }], grants: [] } } });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use })]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter() });
  assert.deepEqual(r.statuses.map((s) => [s.tokenId, s.status.source]).sort(), [[1, "Focus"], [2, "Dazzle"]]);
  const miss = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use })]), mover(2, { col: 1, row: 0 })], { 1: fighter({ hit: 1 }), 2: fighter() });
  assert.deepEqual(miss.statuses.map((s) => s.status.source), ["Focus"]);
});

test("a health boost heals at once (up to full) and doesn't linger", () => {
  const draught = gear({ name: "Draught", damage: null, self: true, statuses: { minutes: 0.1, self: { source: "Draught", boosts: [{ target: "health", value: "+8" }], grants: [] } } });
  const hurtOne = fighter({ hp: 20 });
  hurtOne.hp = 15;
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("use", { use: draught })])], { 1: hurtOne });
  assert.equal(r.hp.get(1), 20);
  assert.deepEqual(r.statuses, []);
});

test("an ability without damage takes effect on a target in range, and fails out of range", () => {
  const mesmerize = gear({ name: "Mesmerize", damage: null, range: 2, statuses: { minutes: 1, target: { source: "Mesmerized", boosts: [], grants: [{ roll: "attack", mode: "disadvantage" }] } } });
  const caster = fighter();
  const near = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use: mesmerize })]), mover(2, { col: 2, row: 0 })], { 1: caster, 2: fighter() });
  assert.match(near.text, /T1 uses Mesmerize on T2/);
  assert.deepEqual(near.statuses.map((s) => s.tokenId), [2]);
  assert.equal(caster.attacks.length, 0, "no attack roll");
  const far = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { use: mesmerize })], { walking: 0 }), mover(2, { col: 6, row: 0 })], { 1: fighter(), 2: fighter() });
  assert.match(far.text, /fails: out of range/);
  assert.deepEqual(far.statuses, []);
});

test("one roll against every enemy in range for an 'all enemies' action; friends and the far-off are spared", () => {
  const sweep = gear({ name: "Sweep", range: 2, targeting: { who: "enemy", count: "all", n: 0 } });
  const me = fighter({ hit: 15, dmg: 4, side: "party" });
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("attack", { use: sweep })]), mover(2, { col: 1, row: 0 }), mover(3, { col: 2, row: 1 }), mover(4, { col: 0, row: 1 }), mover(5, { col: 5, row: 0 })],
    { 1: me, 2: fighter({ def: 10 }), 3: fighter({ def: 20 }), 4: fighter({ side: "party" }), 5: fighter() },
  );
  assert.match(r.text, /T1 uses Sweep on T2, T3\./);
  assert.equal(r.hp.get(2), 16);
  assert.equal(r.hp.get(3), 20, "same roll, higher defense: a miss");
  assert.equal(r.hp.get(4), 20);
  assert.equal(r.hp.get(5), 20);
  assert.equal(me.attacks.length, 1, "one to-hit roll for everyone");
});

test("dice thrown with the plan are spent on the attack", () => {
  const real = fighter({}, {
    attack: () => { const n = rollDice("1d20"); return { total: n + 2, text: `${n}+2`, natural: n, crit: n === 20, fumble: n === 1 }; },
    damage: () => { const n = rollDice("1d6"); return { total: n, text: `${n}` }; },
  });
  const r = resolve([mover(1, { col: 0, row: 0 }, [attack(2, { dice: { hit: [17, 3], damage: [4] } })]), mover(2, { col: 1, row: 0 })], { 1: real, 2: fighter({ hp: 10 }) });
  assert.match(r.text, /19 \(17\+2\) vs defense 12: hit for 4 \(4\)/);
  assert.equal(r.hp.get(2), 6);
});

test("the same seed resolves a round the same way (so the GM's calls replay identically)", () => {
  const real = () => fighter({}, {
    attack: () => { const n = rollDice("1d20"); return { total: n, text: `${n}`, natural: n }; },
    damage: () => { const n = rollDice("2d6"); return { total: n, text: `${n}` }; },
  });
  const once = () => withSeed(99, () => resolve([mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [attack(1)])], { 1: real(), 2: real() }).log);
  assert.deepEqual(once(), once());
});
