"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { removeEffectDef, saveEffectDef } from "@/lib/db";
import { DAMAGE_TYPES, isRollKind, type DamageType } from "@/lib/actions";
import { isModifierTarget } from "@/lib/modifiers";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";
import type { Modifier } from "@/lib/conditions";

/** Creates (id null) or saves a catalog effect (a named set of modifiers) from its form. */
export async function submitEffect(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const modifiers: Modifier[] = [];
  // Damage or healing at the end of each round.
  const periodic = text("periodic_value").toLowerCase().replace(/\s/g, "");
  if (periodic) {
    if (!isDiceFormula(periodic)) throw new Error("Invalid dice for each round");
    const damage_type = text("periodic_type") as DamageType | "";
    if (damage_type && !DAMAGE_TYPES.includes(damage_type)) throw new Error("Invalid damage type");
    modifiers.push({ kind: "periodic", value: periodic, heal: text("periodic_kind") === "healing", damage_type });
  }
  // Boosts (or penalties): a number or dice on something.
  const values = formData.getAll("boost_value").map((v) => String(v).toLowerCase().replace(/\s/g, ""));
  formData.getAll("boost_target").forEach((t, i) => {
    const target = String(t);
    let value = values[i] ?? "";
    if (!target || !value) return;
    if (!isModifierTarget(target) || !isModifierFormula(value)) throw new Error("Invalid boost");
    if (/^\d/.test(value)) value = `+${value}`;
    modifiers.push({ kind: "boost", target, value });
  });
  // Advantage / disadvantage on a kind of roll.
  const modes = formData.getAll("grant_mode").map(String);
  formData.getAll("grant_roll").forEach((r, i) => {
    const roll = String(r), mode = modes[i];
    if (!roll || !mode) return;
    if (!isRollKind(roll) || (mode !== "advantage" && mode !== "disadvantage")) throw new Error("Invalid roll effect");
    modifiers.push({ kind: "roll", roll, mode });
  });
  const saved = saveEffectDef(id, { name: text("name"), description: text("description"), modifiers });
  revalidatePath("/campaign/effects");
  revalidatePath("/campaign/conditions");
  if (id === null) redirect(`/campaign/effects/${saved}`);
}

export async function deleteEffect(id: number) {
  await requireGm();
  removeEffectDef(Number(id));
  revalidatePath("/campaign/effects");
  redirect("/campaign/effects");
}
