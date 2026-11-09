"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { getEffectDef, removeEffectDef, saveEffectDef } from "@/lib/db";
import { DAMAGE_TYPES, isRollKind, type DamageType } from "@/lib/actions";
import { isModifierTarget } from "@/lib/modifiers";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";
import { FORBIDS, type Forbid, type Modifier } from "@/lib/conditions";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";

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
  // Damage or healing once, as the condition lands.
  const instant = text("instant_value").toLowerCase().replace(/\s/g, "");
  if (instant) {
    if (!isDiceFormula(instant)) throw new Error("Invalid dice for at once");
    const damage_type = text("instant_type") as DamageType | "";
    if (damage_type && !DAMAGE_TYPES.includes(damage_type)) throw new Error("Invalid damage type");
    modifiers.push({ kind: "instant", value: instant, heal: text("instant_kind") !== "damage", damage_type });
  }
  // Extra damage on a hit: on their hits, or on hits against them (by whoever put it on them).
  const extra = text("extra_value").toLowerCase().replace(/\s/g, "");
  if (extra) {
    if (!isDiceFormula(extra)) throw new Error("Invalid extra damage dice");
    const damage_type = text("extra_type") as DamageType | "";
    if (damage_type && !DAMAGE_TYPES.includes(damage_type)) throw new Error("Invalid damage type");
    modifiers.push({ kind: "extra", value: extra, damage_type, when: text("extra_when") === "taking" ? "taking" : "dealing" });
  }
  // What they can't do, and saves they fail outright.
  for (const w of formData.getAll("forbid").map(String)) if (FORBIDS.some(([f]) => f === w)) modifiers.push({ kind: "forbid", what: w as Forbid });
  for (const a of formData.getAll("autofail").map(String)) if ((ATTRIBUTES as readonly string[]).includes(a)) modifiers.push({ kind: "autofail", save: a as Attribute });
  // Speed multiplied (half, double).
  const factor = Number(text("speed_factor"));
  if ([0.5, 2].includes(factor)) modifiers.push({ kind: "speed", factor });
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
  // Resistant, vulnerable or immune to a damage type.
  const levels = formData.getAll("resist_level").map(String);
  formData.getAll("resist_type").forEach((t, i) => {
    const damage_type = String(t) as DamageType, level = levels[i];
    if (!damage_type || !level) return;
    if (!DAMAGE_TYPES.includes(damage_type) || !["resistant", "vulnerable", "immune"].includes(level)) throw new Error("Invalid resistance");
    modifiers.push({ kind: "resist", damage_type, level: level as "resistant" | "vulnerable" | "immune" });
  });
  const was = id === null ? undefined : getEffectDef(id);
  const saved = saveEffectDef(id, { name: text("name"), description: text("description"), modifiers: was?.builtin ? was.modifiers : modifiers }); // a built-in's rules stay
  revalidatePath("/campaign/effects");
  revalidatePath("/campaign/conditions");
  if (id === null) redirect(`/campaign/effects/${saved}`);
}

export async function deleteEffect(id: number) {
  await requireGm();
  if (getEffectDef(Number(id))?.builtin) throw new Error("Built-in effects can't be deleted");
  removeEffectDef(Number(id));
  revalidatePath("/campaign/effects");
  redirect("/campaign/effects");
}
