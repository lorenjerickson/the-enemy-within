"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { getConditionDef, getEffectDef, removeEffectDef, saveEffectDef } from "@/lib/db";
import { DAMAGE_TYPES, isRollKind, type DamageType } from "@/lib/actions";
import { isModifierTarget } from "@/lib/modifiers";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";
import { FORBIDS, SENSES, type Forbid, type Modifier, type Sense } from "@/lib/conditions";
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
  // Temporary health as it lands; maximum health while it lasts.
  const temphp = text("temphp_value").toLowerCase().replace(/\s/g, "");
  if (temphp) {
    if (!isDiceFormula(temphp)) throw new Error("Invalid temporary health dice");
    modifiers.push({ kind: "temphp", value: temphp });
  }
  const maxhp = Math.round(Number(text("maxhp_value")) || 0);
  if (maxhp) modifiers.push({ kind: "maxhp", value: maxhp });
  // What they can't do, and saves they fail outright.
  for (const w of formData.getAll("forbid").map(String)) if (FORBIDS.some(([f]) => f === w)) modifiers.push({ kind: "forbid", what: w as Forbid });
  for (const s of formData.getAll("sense").map(String)) if (SENSES.some(([k]) => k === s)) modifiers.push({ kind: "sense", sense: s as Sense });
  for (const a of formData.getAll("autofail").map(String)) if ((ATTRIBUTES as readonly string[]).includes(a)) modifiers.push({ kind: "autofail", save: a as Attribute });
  // "Becomes (at least)": a number, maybe plus an attribute's modifier (13 + agility); and multipliers.
  const setValues = formData.getAll("set_value").map((v) => String(v).toLowerCase().replace(/\s/g, ""));
  formData.getAll("set_target").forEach((t, i) => {
    const target = String(t), v = setValues[i] ?? "";
    if (!target || !v) return;
    const m = v.match(/^(\d+)(?:\+([a-z]+))?$/);
    if (!isModifierTarget(target) || !m || (m[2] && !(ATTRIBUTES as readonly string[]).includes(m[2]))) throw new Error("Invalid setting");
    modifiers.push({ kind: "set", target, value: Number(m[1]), ...(m[2] ? { plus: m[2] as Attribute } : {}) });
  });
  const factors = formData.getAll("mul_factor").map(String);
  formData.getAll("mul_target").forEach((t, i) => {
    const target = String(t), f = ({ "×0": 0, "×½": 0.5, "×2": 2 } as Record<string, number>)[factors[i] ?? ""];
    if (!target || f === undefined) return;
    if (!isModifierTarget(target)) throw new Error("Invalid multiplier");
    modifiers.push({ kind: "multiply", target, factor: f });
  });
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
  // An aura: a condition on those within so many feet (allies, enemies or anyone; maybe itself).
  const auraCondition = Number(text("aura_condition")), radius = Math.round(Number(text("aura_radius")) || 0);
  if (auraCondition && radius > 0) {
    if (!getConditionDef(auraCondition)) throw new Error("Unknown condition for the aura");
    const who = text("aura_who");
    modifiers.push({ kind: "aura", condition: auraCondition, radius, who: who === "friendly" || who === "enemy" ? who : "", self: formData.get("aura_self") === "on" });
  }
  // Dice: a wider critical range, criticals against them as normal hits, rerolls and a minimum d20.
  const range = Number(text("crit_range"));
  if (range === 18 || range === 19) modifiers.push({ kind: "crit", range });
  if (formData.get("nocrit") === "on") modifiers.push({ kind: "nocrit" });
  for (const [rollKey, numKey, kind] of [["reroll_roll", "reroll_at", "reroll"], ["minroll_roll", "minroll_min", "minroll"]] as const) {
    const nums = formData.getAll(numKey).map((v) => Math.round(Number(v)));
    formData.getAll(rollKey).forEach((r, i) => {
      const roll = String(r), n = nums[i];
      if (!roll || !n) return;
      if (!isRollKind(roll) || n < 1 || n > 20) throw new Error(`Invalid ${kind === "reroll" ? "reroll" : "minimum"}`);
      modifiers.push(kind === "reroll" ? { kind, roll, at: n } : { kind, roll, min: n });
    });
  }
  // A trigger: when hit / when they hit, damage to the other creature and / or a condition on someone.
  const on = text("trigger_on");
  if (on === "hit" || on === "hitting" || on === "moves" || on === "start") {
    const damage = text("trigger_damage").toLowerCase().replace(/\s/g, ""), damage_type = text("trigger_type") as DamageType | "";
    if (damage && !isDiceFormula(damage)) throw new Error("Invalid trigger damage dice");
    if (damage_type && !DAMAGE_TYPES.includes(damage_type)) throw new Error("Invalid damage type");
    const save_attr = text("trigger_save_attr") as Attribute | "", condition = Number(text("trigger_condition")) || 0;
    if (save_attr && !(ATTRIBUTES as readonly string[]).includes(save_attr)) throw new Error("Invalid save");
    if (condition && !getConditionDef(condition)) throw new Error("Unknown condition for the trigger");
    if (damage || condition) modifiers.push({
      kind: "trigger", on, reach: text("trigger_reach") === "any" ? "any" : "melee", damage, damage_type, save_attr,
      save_dc: Math.max(1, Math.round(Number(text("trigger_save_dc")) || 12)), save_halves: text("trigger_save_halves") !== "negates",
      condition, condition_on: text("trigger_condition_on") === "self" ? "self" : "other",
    });
  }
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
