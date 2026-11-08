import { addToContainer, characterContainers, db, getCharacter, getItem, saveCharacter, takeFromStack, type Equipment } from "@/lib/db";
import type { EquipSlot } from "@/lib/itemTypes";

/**
 * Moving a character's things between their equipment and their worn containers (a belt, a pack): stow something
 * equipped, equip something carried (what was in the slot goes into that container), move between containers, and
 * (the GM) add from the catalogue or take out. Each returns an error to show, or null.
 */
export type InventoryOp =
  | { op: "stow"; slot: EquipSlot; into: number }
  | { op: "equip"; stack: number; slot: EquipSlot }
  | { op: "move"; stack: number; to: number }
  | { op: "add"; item: number; into: number; qty: number } // GM only
  | { op: "remove"; stack: number }; // GM only

const HANDS: EquipSlot[] = ["main hand", "off hand"];

function saveEquipment(characterId: number, equipment: Equipment) {
  const c = getCharacter(characterId);
  if (!c) return;
  const { id: _id, creature_id, template_name: _t, ...rest } = c;
  saveCharacter(c.id, creature_id, { ...rest, equipment });
}

export function changeInventory(characterId: number, o: InventoryOp): string | null {
  const c = getCharacter(characterId);
  if (!c) return "No such character";
  const equipment: Equipment = { ...(c.equipment ?? {}) };
  const containers = characterContainers(characterId);
  const container = (id: number) => containers.find((x) => x.container.id === id);
  const stackOf = (id: number) => containers.flatMap((x) => x.stacks.map((s) => ({ ...s, in: x }))).find((s) => s.id === id);
  const room = (id: number) => { const x = container(id); return !!x && x.stacks.length < (x.container.capacity ?? 0); };

  if (o.op === "stow") {
    const id = equipment[o.slot];
    const item = id ? getItem(id) : undefined;
    if (!item) return "Nothing's there";
    if (!container(o.into)) return "That isn't a container you're wearing";
    if (item.id === o.into) return "It can't go inside itself";
    if (container(item.id)?.stacks.length) return `Empty ${item.name} first`;
    if (addToContainer(characterId, o.into, item.id, 1) > 0) return `No room in ${getItem(o.into)?.name}`;
    equipment[o.slot] = null;
    saveEquipment(characterId, equipment);
    return null;
  }
  if (o.op === "equip") {
    const s = stackOf(o.stack);
    if (!s) return "That isn't in your containers";
    if (!(o.slot in equipment)) return "You don't have that slot";
    if (!s.item.slots.includes(o.slot)) return `${s.item.name} doesn't go in your ${o.slot}`;
    // Out of the container; whatever was in the slot (and, for something held in both hands, the other hand) goes in.
    const outgoing = [equipment[o.slot], ...(s.item.hands === 2 && HANDS.includes(o.slot) ? [equipment[HANDS.find((h) => h !== o.slot)!]] : [])].filter((x): x is number => !!x);
    const other = HANDS.includes(o.slot) ? equipment[HANDS.find((h) => h !== o.slot)!] : null;
    if (other && getItem(other)?.hands === 2 && !outgoing.includes(other)) outgoing.push(other); // a two-handed item in the other hand has to go too
    const freed = s.qty === 1 ? 1 : 0;
    if (s.in.stacks.length - freed + outgoing.length > (s.in.container.capacity ?? 0)) return `No room in ${s.in.container.name} for what you'd put away`;
    takeFromStack(s.id);
    for (const id of outgoing) addToContainer(characterId, s.in.container.id, id, 1);
    equipment[o.slot] = s.item.id;
    for (const h of HANDS) if (h !== o.slot && outgoing.includes(equipment[h] ?? -1)) equipment[h] = null;
    saveEquipment(characterId, equipment);
    return null;
  }
  if (o.op === "move") {
    const s = stackOf(o.stack);
    if (!s) return "That isn't in your containers";
    if (!container(o.to)) return "That isn't a container you're wearing";
    if (s.in.container.id === o.to) return null;
    if (s.item.id === o.to) return "It can't go inside itself";
    if (addToContainer(characterId, o.to, s.item.id, 1) > 0) return `No room in ${getItem(o.to)?.name}`;
    takeFromStack(s.id);
    return null;
  }
  if (o.op === "add") {
    if (!container(o.into)) return "That isn't a container they're wearing";
    const left = addToContainer(characterId, o.into, o.item, Math.max(1, Math.floor(o.qty)));
    return left > 0 ? `${left} didn't fit` : null;
  }
  if (o.op === "remove") {
    if (!stackOf(o.stack)) return "That isn't in their containers";
    takeFromStack(o.stack);
    return null;
  }
  return "Unknown change";
}

/** Whether a character is in a running encounter (players then swap gear with Refit, not here). */
export const inEncounter = (characterId: number) =>
  !!db.prepare<[number], { n: number }>("SELECT 1 AS n FROM map_tokens t JOIN encounters e ON e.level_id = t.level_id WHERE t.character_id = ?").get(characterId);
