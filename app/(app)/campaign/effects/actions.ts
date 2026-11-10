"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { getEffectDef, listConditionDefs, removeEffectDef, saveEffectDef } from "@/lib/db";
import type { Modifier } from "@/lib/conditions";
import { checkRule, compile, type Filled } from "@/lib/effectGrammar";

/**
 * Creates (id null) or saves a catalog effect from its form: its rules arrive as the builder's filled blanks (JSON),
 * each checked against the grammar and compiled to the modifiers the engine reads. A rule the engine can't run yet
 * isn't saved (the builder says so as it's written).
 */
export async function submitEffect(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const was = id === null ? undefined : getEffectDef(id);
  let modifiers: Modifier[] = was?.modifiers ?? [];
  if (!was?.builtin) { // a built-in's rules stay
    let rules: Filled[];
    try { rules = JSON.parse(text("rules") || "[]"); } catch { throw new Error("The rules couldn't be read"); }
    if (!Array.isArray(rules)) throw new Error("The rules couldn't be read");
    const conditions = listConditionDefs(), conditionId = (name: string) => conditions.find((c) => c.name === name)?.id ?? -1;
    modifiers = rules.flatMap((rule, i) => {
      const problem = checkRule(rule);
      if (problem) throw new Error(`Rule ${i + 1} isn't finished: ${problem}`);
      const out = compile(rule, conditionId);
      if (!out.modifiers.length) throw new Error(`Rule ${i + 1} can't be saved yet: ${out.notes.join("; ") || "the engine can't run it"}`);
      if (out.modifiers.some((m) => "condition" in m && m.condition === -1)) throw new Error(`Rule ${i + 1}: that condition isn't in the catalog`);
      return out.modifiers;
    });
  }
  const saved = saveEffectDef(id, { name: text("name"), description: text("description"), modifiers });
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
