"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { createCreature, CREATURE_TYPES, type CreatureType } from "@/lib/db";
import { imageFromForm } from "@/lib/images";
import { ATTRIBUTES, MAX_SCORE, MIN_SCORE, POINT_BUY_BUDGET, pointBuySpent, type Attributes } from "@/lib/attributes";

export async function addCreature(formData: FormData) {
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

  createCreature({
    name: text("name"),
    description: text("description"),
    image: await imageFromForm(formData),
    type,
    attributes,
  });
  redirect("/campaign/creatures");
}
