import { test } from "node:test";
import assert from "node:assert/strict";
import { character, item, level } from "./seed";
import { addToContainer, characterContainers, getCharacter, saveAction } from "@/lib/db/catalog";
import { placeCharacterToken } from "@/lib/db/tokens";
import { gearActions, useUpItem } from "@/lib/combat";

const act = (name: string) => ({ name, description: "", roll: "normal", attack: null, damage: null, damage_type: "", radius: 0, split: 0, boosts: [], roll_grants: [], duration_amount: 1, duration_unit: "", seconds: 2, range_ft: 5, area_shape: "", area_ft: 0, save_dc: 12, save_attr: "agility", save_half: 1, area_lasts: 0, area_fires: "end", targets: "anyone", target_who: "", target_count: "one", target_n: 1, conditions: [], kind: "action" }) as never;

const pack = item({ name: "Pack", type: "container", capacity: 4, slots: ["back"] });
const belt = item({ name: "Belt", type: "container", capacity: 4, slots: ["waist"] });
const bandage = item({ name: "Bandage", type: "consumable", max_stack: 10 });
const salts = item({ name: "Salts", type: "consumable", max_stack: 5 });
const lamp = item({ name: "Lamp", slots: ["off hand"], hands: 1 });
const mask = item({ name: "Mask", type: "armor", slots: ["head"] });
saveAction(null, { item_id: bandage }, act("Bind"));
saveAction(null, { item_id: salts }, act("Revive"));
saveAction(null, { item_id: lamp }, act("Shine"));
saveAction(null, { item_id: mask }, act("Breathe"));

test("items' actions say where the item is; a pack's count only when packs are allowed (out of encounters)", () => {
  const id = character("Hale", { equipment: { back: pack, waist: belt, "off hand": lamp, head: mask } });
  addToContainer(id, belt, bandage, 3);
  addToContainer(id, pack, salts, 2);
  const tok = placeCharacterToken(level(), id, 0, 0);
  const where = (packs: boolean) => Object.fromEntries(gearActions(tok, undefined, { packs }).map((g) => [g.name, g.item?.where]));
  assert.deepEqual(where(false), { Shine: "hand", Breathe: "worn", Bind: "belt" }, "in a round: no pack items");
  assert.deepEqual(where(true), { Shine: "hand", Breathe: "worn", Bind: "belt", Revive: "pack" });
  assert.equal(gearActions(tok).find((g) => g.name === "Bind")?.item?.container, belt);
});

test("a consumable's use takes one from where it was; in a hand, the hand empties; anything else is kept", () => {
  const id = character("Ives", { equipment: { back: pack, waist: belt, "main hand": bandage, "off hand": lamp } });
  addToContainer(id, belt, bandage, 2);
  addToContainer(id, pack, salts, 1);
  const tok = placeCharacterToken(level(), id, 0, 0);
  const qty = (c: number, it: number) => characterContainers(id).find((x) => x.container.id === c)!.stacks.filter((s) => s.item.id === it).reduce((n, s) => n + s.qty, 0);
  assert.equal(useUpItem(tok, { id: bandage, where: "belt", container: belt }), true);
  assert.equal(qty(belt, bandage), 1);
  assert.equal(useUpItem(tok, { id: salts, where: "pack", container: pack }), true);
  assert.equal(qty(pack, salts), 0, "the last one leaves the pack");
  assert.equal(useUpItem(tok, { id: bandage, where: "hand" }), true);
  assert.equal(getCharacter(id)!.equipment["main hand"] ?? null, null, "the hand is empty");
  assert.equal(useUpItem(tok, { id: lamp, where: "hand" }), false, "not a consumable: kept");
  assert.equal(getCharacter(id)!.equipment["off hand"], lamp);
});
