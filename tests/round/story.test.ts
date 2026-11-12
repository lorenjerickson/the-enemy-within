import { test } from "node:test";
import assert from "node:assert/strict";
import { act, attack, fighter, gear, mover, resolve } from "./harness";
import { gmStory, playerStory, severity, storyFor } from "@/lib/roundStory";

const name = (id: number) => `T${id}`;

function brawl() {
  // T1 hits T2; T2 is too slow to hit back; T3 just stands there.
  return resolve(
    [mover(1, { col: 0, row: 0 }, [attack(2)]), mover(2, { col: 1, row: 0 }, [attack(1, { use: gear({ seconds: 3 }) })]), mover(3, { col: 8, row: 8 }, [act("search")])],
    { 1: fighter({ dmg: 6 }), 2: fighter({ hp: 20 }), 3: fighter() },
  );
}

test("severity words by share of full health", () => {
  assert.equal(severity(0.1), "minor");
  assert.equal(severity(0.3), "moderate");
  assert.equal(severity(0.5), "serious");
  assert.equal(severity(0.9), "grievous");
});

test("the attacker's story has no numbers: how bad it looked, not how much", () => {
  const lines = [...storyFor(brawl().story, 1, name).values()].flat();
  assert.ok(lines.length > 0);
  for (const l of lines) assert.doesNotMatch(l, /\d/, l);
  assert.ok(lines.some((l) => /moderate/.test(l)), lines.join(" | "));
});

test("whoever took the hit learns how much", () => {
  const lines = [...storyFor(brawl().story, 2, name).values()].flat();
  assert.ok(lines.some((l) => /\(-6\)/.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /T1/.test(l)));
});

test("nothing about anyone they didn't deal with", () => {
  const lines = [...playerStory(brawl().story, [3], name).values()].flat();
  for (const l of lines) assert.doesNotMatch(l, /T1|T2/, l);
});

test("a player's story across their tokens comes in time order", () => {
  const secs = [...playerStory(brawl().story, [2, 1], name).keys()];
  assert.deepEqual(secs, [...secs].sort((a, b) => a - b));
});

test("the GM's story tells everything with exact damage", () => {
  const all = gmStory(brawl().story, name).flatMap((s) => s.lines).join("\n");
  assert.match(all, /T1 hits T2: moderate damage \(6\)/);
  assert.match(all, /T2 is thrown off by T1's blow/);
  assert.equal(gmStory(undefined, name).length, 0);
});
