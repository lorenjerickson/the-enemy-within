"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { listEffectDefs, removeConditionDef, saveConditionDef } from "@/lib/db";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";

/** Creates (id null) or saves a catalog condition: the effects it applies, how long it lasts, the save that ends it. */
export async function submitCondition(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const save_attr = text("save_attr") as Attribute | "";
  if (save_attr && !ATTRIBUTES.includes(save_attr)) throw new Error("Invalid save");
  const known = new Set(listEffectDefs().map((e) => e.id));
  const effects = [...new Set(formData.getAll("effect").map(Number))].filter((e) => known.has(e));
  const saved = saveConditionDef(id, {
    name: text("name"),
    description: text("description"),
    effects,
    rounds: Math.max(1, Math.round(Number(formData.get("rounds")) || 1)),
    save_attr,
    save_dc: Math.max(1, Math.round(Number(formData.get("save_dc")) || 12)),
  });
  revalidatePath("/campaign/conditions");
  revalidatePath("/campaign/effects");
  if (id === null) redirect(`/campaign/conditions/${saved}`);
}

export async function deleteCondition(id: number) {
  await requireGm();
  removeConditionDef(Number(id));
  revalidatePath("/campaign/conditions");
  redirect("/campaign/conditions");
}
