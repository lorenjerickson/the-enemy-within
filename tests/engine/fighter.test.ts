import { test } from "node:test";
import assert from "node:assert/strict";
import { fighterOf } from "@/lib/fighter";

test("a fighter's defense and damage come from its attributes and the gear it's given, without the database", () => {
  const items = new Map([[1, { id: 1, name: "Plate", defense: "6" }], [2, { id: 2, name: "Club", damage: "4", attack: "" }]]) as never as Map<number, never>;
  const f = fighterOf({ attributes: { agility: 14, might: 12 } as never, equipment: { body: 1, "main hand": 2 } as never }, 20, [], (id) => items.get(id));
  assert.equal(f.defense().total, 18, "10 + 2 agility + 6 armour");
  assert.equal(f.damage().total, 5, "club 4 + 1 might");
  assert.match(f.damage().text, /4 \(Club\)/);
});
