"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { getConditionDef, listEffectDefs, removeConditionDef, saveConditionDef } from "@/lib/db";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";

/** Creates (id null) or saves a catalog condition: the effects it applies, how long it lasts, the save that ends it. */
export async function submitCondition(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const save_attr = text("save_attr") as Attribute | "";
  if (save_attr && !ATTRIBUTES.includes(save_attr)) throw new Error("Invalid save");
  const known = new Set(listEffectDefs().map((e) => e.id));
  const was = id === null ? undefined : getConditionDef(id);
  const effects = was?.builtin ? was.effects : [...new Set(formData.getAll("effect").map(Number))].filter((e) => known.has(e)); // a built-in's effects stay
  const saved = saveConditionDef(id, {
    name: text("name"),
    description: text("description"),
    effects,
    rounds: Math.max(1, Math.round(Number(formData.get("rounds")) || 1)),
    save_attr,
    save_dc: Math.max(1, Math.round(Number(formData.get("save_dc")) || 12)),
    apply_save_attr: (ATTRIBUTES as readonly string[]).includes(text("apply_save_attr")) ? (text("apply_save_attr") as Attribute) : "",
    apply_save_dc: Math.max(1, Math.round(Number(formData.get("apply_save_dc")) || 12)),
    apply_save_outcome: text("apply_save_outcome") === "halves" ? "halves" : "negates",
    save_when: text("save_when") === "start" ? "start" : text("save_when") === "damaged" ? "damaged" : "end",
    save_action: formData.get("save_action") === "on" ? 1 : 0,
    saves_needed: Math.max(1, Math.round(Number(formData.get("saves_needed")) || 1)),
    ends_on_damage: formData.get("ends_on_damage") === "on" ? 1 : 0,
    ends_on_attack: formData.get("ends_on_attack") === "on" ? 1 : 0,
    concentration: formData.get("concentration") === "on" ? 1 : 0,
  });
  revalidatePath("/campaign/conditions");
  revalidatePath("/campaign/effects");
  if (id === null) redirect(`/campaign/conditions/${saved}`);
}

export async function deleteCondition(id: number) {
  await requireGm();
  if (getConditionDef(Number(id))?.builtin) throw new Error("Built-in conditions can't be deleted");
  removeConditionDef(Number(id));
  revalidatePath("/campaign/conditions");
  redirect("/campaign/conditions");
}
