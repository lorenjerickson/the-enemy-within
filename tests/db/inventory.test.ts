import { test } from "node:test";
import assert from "node:assert/strict";
import { character, item } from "./seed";
import { addToContainer, characterContainers, getCharacter, takeCarried } from "@/lib/db";
import { changeInventory } from "@/lib/inventory";

const pack = item({ name: "Pack", type: "container", capacity: 2, slots: ["back"] });
const belt = item({ name: "Belt", type: "container", capacity: 1, slots: ["waist"] });
const ammo = item({ name: "Bullets", type: "consumable", max_stack: 10 });
const knife = item({ name: "Knife", type: "weapon", slots: ["main hand", "off hand"], hands: 1, damage: "1d4" });
const rifle = item({ name: "Rifle", type: "weapon", slots: ["main hand"], hands: 2, damage: "2d8" });
const torch = item({ name: "Torch", slots: ["off hand"], hands: 1 });

const kit = (name: string) => character(name, { equipment: { back: pack, waist: belt, "main hand": knife, "off hand": torch } });
const stacks = (id: number, container: number) => characterContainers(id).find((c) => c.container.id === container)!.stacks.map((s) => [s.item.name, s.qty]);

test("stacks fill up to their max, a stack takes one slot, and what doesn't fit comes back", () => {
  const id = kit("Annis");
  assert.equal(addToContainer(id, pack, ammo, 15), 0);
  assert.deepEqual(stacks(id, pack), [["Bullets", 10], ["Bullets", 5]]);
  assert.equal(addToContainer(id, pack, ammo, 7), 2, "5 top up the second stack, 2 left over: no free slot");
  assert.equal(addToContainer(id, pack, pack, 1), 1, "a container can't go inside itself");
});

test("each container's contents are the character's own", () => {
  const a = kit("Bram"), b = kit("Cass");
  addToContainer(a, belt, ammo, 3);
  assert.deepEqual(stacks(b, belt), []);
});

test("stow and equip: what was in the slot goes into the container", () => {
  const id = kit("Dee");
  assert.equal(changeInventory(id, { op: "stow", slot: "main hand", into: pack }), null);
  assert.equal(getCharacter(id)!.equipment["main hand"], null);
  const s = characterContainers(id).find((c) => c.container.id === pack)!.stacks[0];
  assert.equal(changeInventory(id, { op: "equip", stack: s.id, slot: "off hand" }), null);
  assert.equal(getCharacter(id)!.equipment["off hand"], knife);
  assert.deepEqual(stacks(id, pack), [["Torch", 1]]);
});

test("equipping a two-handed item puts away both hands (its own slot frees one up)", () => {
  const id = kit("Eve");
  changeInventory(id, { op: "add", item: rifle, into: pack, qty: 1 });
  const r = characterContainers(id).find((c) => c.container.id === pack)!.stacks[0];
  assert.equal(changeInventory(id, { op: "equip", stack: r.id, slot: "main hand" }), null);
  const eq = getCharacter(id)!.equipment;
  assert.equal(eq["main hand"], rifle);
  assert.equal(eq["off hand"], null);
  assert.deepEqual(stacks(id, pack).map(([n]) => n).sort(), ["Knife", "Torch"]);
});

test("no room for what would be put away: nothing changes", () => {
  const id = kit("Ezra");
  changeInventory(id, { op: "add", item: rifle, into: pack, qty: 1 });
  changeInventory(id, { op: "add", item: ammo, into: pack, qty: 1 }); // pack full: rifle, bullets
  const r = characterContainers(id).find((c) => c.container.id === pack)!.stacks.find((x) => x.item.id === rifle)!;
  assert.match(changeInventory(id, { op: "equip", stack: r.id, slot: "main hand" })!, /No room in Pack/);
  assert.equal(getCharacter(id)!.equipment["main hand"], knife);
});

test("refusals: wrong slot, not worn, full, a full container stowed", () => {
  const id = kit("Finn");
  changeInventory(id, { op: "add", item: torch, into: belt, qty: 1 });
  const t = characterContainers(id).find((c) => c.container.id === belt)!.stacks[0];
  assert.match(changeInventory(id, { op: "equip", stack: t.id, slot: "back" })!, /doesn't go in your back/);
  assert.match(changeInventory(id, { op: "stow", slot: "main hand", into: 9999 })!, /isn't a container you're wearing/);
  assert.match(changeInventory(id, { op: "stow", slot: "main hand", into: belt })!, /No room in Belt/);
  assert.match(changeInventory(id, { op: "stow", slot: "waist", into: pack })!, /Empty Belt first/);
  assert.match(changeInventory(id, { op: "add", item: ammo, into: belt, qty: 5 })!, /5 didn't fit/);
});

test("takeCarried takes one from whichever container has it (a refit's way of drawing gear)", () => {
  const id = kit("Gil");
  addToContainer(id, pack, ammo, 2);
  assert.equal(takeCarried(id, ammo), pack);
  assert.deepEqual(stacks(id, pack), [["Bullets", 1]]);
  assert.equal(takeCarried(id, rifle), null);
});
