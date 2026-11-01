"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { saveCreature, CREATURE_TYPES, EQUIP_SLOTS, listItems, type CreatureType, type Equipment } from "@/lib/db";
import { imageFromForm } from "@/lib/images";
import { ATTRIBUTES, MAX_SCORE, MIN_SCORE, POINT_BUY_BUDGET, pointBuySpent, type Attributes } from "@/lib/attributes";

/** Creates the creature when id is null, otherwise updates it. */
export async function submitCreature(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const type = text("type") as CreatureType;
  if (!CREATURE_TYPES.includes(type)) throw new Error("Invalid creature type");

  const attributes = Object.fromEntries(ATTRIBUTES.map((k) => [k, Number(formData.get(k))])) as Attributes;
  for (const k of ATTRIBUTES) {
    const v = attributes[k];
    if (!Number.isInteger(v) || v < MIN_SCORE || v > MAX_SCORE) throw new Error(`Invalid ${k} score`);
  }
  if (text("method") === "pointbuy" && pointBuySpent(attributes) > POINT_BUY_BUDGET) {
    throw new Error("Point buy budget exceeded");
  }

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

  saveCreature(id, {
    name: text("name"),
    description: text("description"),
    image: await imageFromForm(formData),
    type,
    attributes,
    equipment,
  });
  redirect("/campaign/creatures");
}
