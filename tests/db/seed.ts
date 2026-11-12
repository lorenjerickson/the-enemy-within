// Builders for database tests: each test file has its own empty database (see tests/register.mjs).
import { db, saveCharacter, saveCreature, saveItem, saveLocation, addLevel, type Item } from "@/lib/db";
import { defaultAttributes } from "@/lib/attributes";
import { MOVEMENT_TYPES } from "@/lib/creatureTypes";

const lastId = (table: string) => (db.prepare(`SELECT max(id) AS id FROM "${table}"`).get() as { id: number }).id;

export function item(o: Partial<Omit<Item, "id">> & { name: string }): number {
  saveItem(null, { description: "", image: null, type: "utility", weight: 1, value: 1, rarity: "common", durability: 100, defense: null, damage: null, attack: null, max_stack: 1, capacity: null, slots: [], range_ft: 5, hands: 0, ...o });
  return lastId("items");
}

const body = (name: string, o: { attributes?: Partial<ReturnType<typeof defaultAttributes>>; equipment?: Record<string, number | null>; health?: string } = {}) => ({
  name, description: "", image: null, token_overhead: null, token_side: null, height: 1.8, type: "humanoid" as const,
  attributes: { ...defaultAttributes(10), ...o.attributes }, equipment: o.equipment ?? {}, health: o.health ?? "20",
  movement: Object.fromEntries(MOVEMENT_TYPES.map((m) => [m, m === "walking" ? 9 : 0])) as never,
});

export const character = (name: string, o: Parameters<typeof body>[1] = {}) => saveCharacter(null, null, body(name, o));
export function creature(name: string, o: Parameters<typeof body>[1] = {}): number {
  saveCreature(null, body(name, o));
  return lastId("creatures");
}
export function level(name = "Ground"): number {
  saveLocation(null, { parent_id: null, name: `Place ${name}`, description: "" });
  return addLevel(lastId("locations"), name);
}
