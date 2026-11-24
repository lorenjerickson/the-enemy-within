import { test } from "node:test";
import assert from "node:assert/strict";
import { act, fighter, mover, resolve } from "./harness";
import { gmStory, playerStory } from "@/lib/roundStory";

const door = { id: 7, name: "the cellar door", open: false };

test("interacting with a door is noted, to open it after the round, with a story line", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("interact", { door })])], { 1: fighter() });
  assert.deepEqual(r.doorsWorked, [{ tokenId: 1, doorId: 7, sec: 1 }]);
  assert.match(playerStory(r.story, [1], (id) => `T${id}`).get(1)!.join(" "), /You open the cellar door/);
  assert.match(gmStory(r.story, (id) => `T${id}`).flatMap((s) => s.lines).join(" "), /T1 opens the cellar door/);
});

test("a 1 s Interact is done before a 2 s attack can interrupt it", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [act("interact", { door: { ...door, open: true } })], { initiative: 1 }), mover(2, { col: 1, row: 0 }, [act("attack", { target: { id: 1, name: "T1" } })])],
    { 1: fighter({ hp: 20 }), 2: fighter({ hit: 30, dmg: 1 }) },
  );
  assert.equal(r.doorsWorked.length, 1);
});

test("working a lever is noted, to fire its trigger after the round, with a story line", () => {
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("interact", { thing: { id: 3, name: "the signal lever" } })])], { 1: fighter() });
  assert.deepEqual(r.thingsWorked, [{ tokenId: 1, triggerId: 3, sec: 1 }]);
  assert.match(playerStory(r.story, [1], (id) => `T${id}`).get(1)!.join(" "), /You work the signal lever/);
});
