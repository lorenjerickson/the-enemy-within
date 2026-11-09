"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { listEffectDefs, setStandingEffects } from "@/lib/db";

/** Saves the effects an item gives while equipped, or a creature always has. */
export async function saveStandingEffects(owner: { item_id: number } | { creature_id: number }, formData: FormData) {
  await requireGm();
  const known = new Set(listEffectDefs().map((e) => e.id));
  setStandingEffects(owner, [...new Set(formData.getAll("effect").map(Number))].filter((id) => known.has(id)));
  revalidatePath("item_id" in owner ? `/campaign/items/${owner.item_id}` : `/campaign/creatures/${owner.creature_id}`);
}
