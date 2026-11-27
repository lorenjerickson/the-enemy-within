"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { catalogCopy, getStandingUses, listEffectDefs, setStandingEffects } from "@/lib/db/effects";
import { retune } from "@/lib/effectCopy";
import type { Effect } from "@/lib/conditions";

/**
 * Saves the effects an item gives while equipped, or a creature always has: each its own copy (backlog W), the one it
 * had or the catalog's now; a tuned one sent from the form keeps only what a copy may change (retune).
 */
export async function saveStandingEffects(owner: { item_id: number } | { creature_id: number }, formData: FormData) {
  await requireGm();
  const known = new Set(listEffectDefs().map((e) => e.id)), had = getStandingUses(owner);
  const sent = (() => { try { return JSON.parse(String(formData.get("copies") ?? "{}")) as Record<string, Effect>; } catch { return {}; } })();
  const ids = [...new Set(formData.getAll("effect").map(Number))].filter((id) => known.has(id) || had.some((u) => u.id === id));
  setStandingEffects(owner, ids.map((id) => {
    const base = had.find((u) => u.id === id)?.copy ?? catalogCopy(id);
    return base && sent[id] ? { id, copy: retune(base, sent[id]) } : { id };
  }));
  revalidatePath("item_id" in owner ? `/campaign/items/${owner.item_id}` : `/campaign/creatures/${owner.creature_id}`);
}
