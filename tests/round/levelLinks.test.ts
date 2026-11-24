import { test } from "node:test";
import assert from "node:assert/strict";
import { attack, fighter, move, mover, resolve } from "./harness";
import type { LevelLink } from "@/lib/levelLinks";

const stairs: LevelLink = { id: 7, kind: "staircase", x1: 3, y1: 0, x2: 3, y2: 0, target_level_id: 2, target_name: "Cellar" };

test("coming onto a level link stops the mover there and notes where they came from; their actions still happen", () => {
  const r = resolve(
    [mover(1, { col: 0, row: 0 }, [move(4, 0, 20), attack(2)]), mover(2, { col: 4, row: 1 })],
    { 1: fighter({ dmg: 4 }), 2: fighter({ hp: 20 }) },
    { links: [stairs] },
  );
  assert.deepEqual(r.final.get(1), { col: 3, row: 0 });
  assert.deepEqual(r.linksReached, [{ linkId: 7, tokenId: 1, sec: 3, back: { col: 2, row: 0 } }]);
  assert.match(r.at(3), /T1 reaches the way to Cellar and stops there/);
  assert.equal(r.hp.get(2), 16, "T2 is next to the stairs: the planned attack still lands");
});

test("starting on a level link, or not moving onto one, doesn't stop anyone", () => {
  const r = resolve([mover(1, { col: 3, row: 0 }, [move(5, 0, 10)]), mover(2, { col: 0, row: 1 }, [move(5, 1, 25)])], { 1: fighter(), 2: fighter() }, { links: [stairs] });
  assert.deepEqual(r.linksReached, []);
  assert.deepEqual(r.final.get(1), { col: 5, row: 0 });
});
