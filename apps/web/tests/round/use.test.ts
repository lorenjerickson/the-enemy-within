import { test } from "node:test";
import assert from "node:assert/strict";
import { act, fighter, gear, mover, resolve } from "./harness";

test("an item's action done in the round is reported, to use up a consumable after", () => {
  const bandage = gear({ id: 50, name: "Bind", damage: undefined, attack: undefined, self: true, targets: "self", item: { id: 9, where: "belt", container: 4 } });
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("use", { use: bandage })])], { 1: fighter() });
  assert.deepEqual(r.itemsUsed, [{ tokenId: 1, item: { id: 9, where: "belt", container: 4 } }]);
});

test("an interrupted one isn't", () => {
  const bandage = gear({ id: 50, name: "Bind", seconds: 3, damage: undefined, attack: undefined, self: true, targets: "self", item: { id: 9, where: "belt" } });
  const r = resolve([mover(1, { col: 0, row: 0 }, [act("use", { use: bandage })]), mover(2, { col: 1, row: 0 }, [act("attack", { target: { id: 1, name: "T1" } })])], { 1: fighter({ hp: 20 }), 2: fighter({ hit: 30, dmg: 1 }) });
  assert.deepEqual(r.itemsUsed, []);
});
