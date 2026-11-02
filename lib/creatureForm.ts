import { CREATURE_TYPES, EQUIP_SLOTS, listItems, type Creature, type CreatureType, type Equipment } from "@/lib/db";
import { imageFromForm } from "@/lib/images";
import { isDiceFormula } from "@/lib/itemTypes";
import { MOVEMENT_TYPES, type Movement } from "@/lib/creatureTypes";
import { ATTRIBUTES, MAX_SCORE, MIN_SCORE, POINT_BUY_BUDGET, pointBuySpent, type Attributes } from "@/lib/attributes";

/** Reads and validates CreatureForm fields (shared by creatures and characters). */
export async function parseCreatureForm(formData: FormData): Promise<Omit<Creature, "id">> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const type = text("type") as CreatureType;
  if (!CREATURE_TYPES.includes(type)) throw new Error("Invalid creature type");
  const health = text("health").toLowerCase().replace(/\s/g, "");
  if (!isDiceFormula(health)) throw new Error("Invalid health dice formula");

  const attributes = Object.fromEntries(ATTRIBUTES.map((k) => [k, Number(formData.get(k))])) as Attributes;
  for (const k of ATTRIBUTES) {
    const v = attributes[k];
    if (!Number.isInteger(v) || v < MIN_SCORE || v > MAX_SCORE) throw new Error(`Invalid ${k} score`);
  }
  if (text("method") === "pointbuy" && pointBuySpent(attributes) > POINT_BUY_BUDGET) {
    throw new Error("Point buy budget exceeded");
  }

  const movement = Object.fromEntries(
    MOVEMENT_TYPES.map((m) => [m, Math.max(0, Number(formData.get(`move:${m}`)) || 0)])
  ) as Movement;

  const items = new Map(listItems().map((i) => [i.id, i]));
  const equipment: Equipment = {};
  for (const slot of EQUIP_SLOTS) {
    if (formData.get(`slot:${slot}`) !== "on") continue;
    const itemId = Number(formData.get(`item:${slot}`)) || null;
    if (itemId !== null && !items.get(itemId)?.slots.includes(slot)) {
      throw new Error(`Item ${itemId} cannot be equipped in ${slot}`);
    }
    equipment[slot] = itemId;
  }

  return {
    name: text("name"),
    description: text("description"),
    image: await imageFromForm(formData, "creature", text("name")),
    token_overhead: await imageFromForm(formData, "token", `${text("name")} (overhead token)`, "tokenOverhead"),
    token_side: await imageFromForm(formData, "token", `${text("name")} (side token)`, "tokenSide"),
    type,
    attributes,
    equipment,
    health,
    movement,
  };
}
