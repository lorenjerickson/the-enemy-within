"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { createCreature, CREATURE_TYPES, type CreatureType } from "@/lib/db";
import { imageFromForm } from "@/lib/images";

export async function addCreature(formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const type = text("type") as CreatureType;
  if (!CREATURE_TYPES.includes(type)) throw new Error("Invalid creature type");

  createCreature({
    name: text("name"),
    description: text("description"),
    image: await imageFromForm(formData),
    type,
  });
  redirect("/campaign/creatures");
}
