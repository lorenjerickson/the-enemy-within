import { test } from "node:test";
import assert from "node:assert/strict";
import { act, attack, fighter, mover, resolve } from "./harness";
import { playerStory } from "@/lib/roundStory";

const assist = (id: number) => act("assist", { target: { id, name: `T${id}` } });

test("Assist gives the one helped advantage on their next attack, then it's spent", () => {
  // T1 helps T2 (1 s); T2 attacks T3 later in the round.
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [assist(2)]), mover(2, { col: 1, row: 0 }, [act("dodge"), attack(3)]), mover(3, { col: 2, row: 0 })],
    { 1: fighter(), 2: fighter({ dmg: 1 }), 3: fighter({ hp: 20 }) },
  );
  assert.match(r.text, /T1 helps T2/);
  assert.deepEqual(r.assistsLeft, [], "used on the attack");
  assert.match([...playerStory(r.story, [2], (id) => `T${id}`).values()].flat().join(" "), /T1 helps you/);
});

test("help not used this round carries on", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [assist(2)]), mover(2, { col: 1, row: 0 })], { 1: fighter(), 2: fighter() });
  assert.deepEqual(r.assistsLeft, [{ tokenId: 2, by: 1, name: "T1" }]);
});

test("help from before the round counts on their first attack", () => {
  const r = resolve([mover(2, { col: 1, row: 0 }, [attack(3)]), mover(3, { col: 2, row: 0 })], { 2: fighter({ dmg: 1 }), 3: fighter({ hp: 20 }) }, { assists: new Map([[2, { by: 1, name: "T1" }]]) });
  assert.deepEqual(r.assistsLeft, []);
});

test("help goes to their next d20 roll whatever it is: here Dodge's check (only once)", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [assist(2)]), mover(2, { col: 1, row: 0 }, [act("ready"), act("dodge")])], // the Dodge comes after the help (2nd second)
    { 1: fighter(), 2: fighter({ save: 10 }) },
  );
  assert.match(r.text, /T2 is ready to dodge \(110 vs DC 12\)/, "advantage (the fake shows it as +100)");
  assert.deepEqual(r.assistsLeft, []);
});

test("unhelped, the same check fails", () => {
  const r = resolve([mover(2, { col: 1, row: 0 }, [act("ready"), act("dodge")])], { 2: fighter({ save: 10 }) });
  assert.match(r.text, /isn't quick enough/);
});
