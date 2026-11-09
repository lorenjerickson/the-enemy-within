"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { removeEffectDef, saveEffectDef } from "@/lib/db";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import { DAMAGE_TYPES, isRollKind, type Boost, type DamageType, type RollGrant } from "@/lib/actions";
import { isModifierTarget } from "@/lib/modifiers";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";

/** Creates (id null) or saves a catalog effect from its form. */
export async function submitEffect(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const per_round = text("per_round").toLowerCase().replace(/\s/g, "");
  if (per_round && !isDiceFormula(per_round)) throw new Error("Invalid dice for each round");
  const damage_type = text("damage_type") as DamageType | "";
  if (damage_type && !DAMAGE_TYPES.includes(damage_type)) throw new Error("Invalid damage type");
  const save_attr = text("save_attr") as Attribute | "";
  if (save_attr && !ATTRIBUTES.includes(save_attr)) throw new Error("Invalid save");
  const values = formData.getAll("boost_value").map((v) => String(v).toLowerCase().replace(/\s/g, ""));
  const boosts = formData.getAll("boost_target").flatMap((t, i): Boost[] => {
    const target = String(t);
    let value = values[i] ?? "";
    if (!target || !value) return [];
    if (!isModifierTarget(target) || !isModifierFormula(value)) throw new Error("Invalid boost");
    if (/^\d/.test(value)) value = `+${value}`;
    return [{ target, value }];
  });
  const modes = formData.getAll("grant_mode").map(String);
  const roll_grants = formData.getAll("grant_roll").flatMap((r, i): RollGrant[] => {
    const roll = String(r), mode = modes[i];
    if (!roll || !mode) return [];
    if (!isRollKind(roll) || (mode !== "advantage" && mode !== "disadvantage")) throw new Error("Invalid roll effect");
    return [{ roll, mode }];
  });
  const saved = saveEffectDef(id, {
    name: text("name"),
    description: text("description"),
    per_round,
    per_round_kind: text("per_round_kind") === "healing" ? "healing" : "damage",
    damage_type,
    rounds: Math.max(1, Math.round(Number(formData.get("rounds")) || 1)),
    save_attr,
    save_dc: Math.max(1, Math.round(Number(formData.get("save_dc")) || 12)),
    boosts,
    roll_grants,
  });
  revalidatePath("/campaign/effects");
  if (id === null) redirect(`/campaign/effects/${saved}`);
}

export async function deleteEffect(id: number) {
  await requireGm();
  removeEffectDef(Number(id));
  revalidatePath("/campaign/effects");
  redirect("/campaign/effects");
}
