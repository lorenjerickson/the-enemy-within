"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { getConditionDef, listEffectDefs, removeConditionDef, saveConditionDef } from "@/lib/db";
import { CONDITION_SENTENCE, checkRule, compileLifecycle, type Filled } from "@/lib/effectGrammar";

/** Creates (id null) or saves a catalog condition: the effects it applies, how long it lasts, the save that ends it. */
export async function submitCondition(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const known = new Set(listEffectDefs().map((e) => e.id));
  const was = id === null ? undefined : getConditionDef(id);
  const effects = was?.builtin ? was.effects : [...new Set(formData.getAll("effect").map(Number))].filter((e) => known.has(e)); // a built-in's effects stay
  // How it works: its lifecycle sentences, each checked against the grammar, then put together (once each).
  let rules: Filled[];
  try { rules = JSON.parse(text("lifecycle") || "[]"); } catch { throw new Error("The lifecycle couldn't be read"); }
  if (!Array.isArray(rules)) throw new Error("The lifecycle couldn't be read");
  rules.forEach((r, i) => { const p = checkRule(r, CONDITION_SENTENCE); if (p) throw new Error(`Sentence ${i + 1} isn't finished: ${p}`); });
  const { lifecycle, problem } = compileLifecycle(rules);
  if (!lifecycle) throw new Error(problem);
  const saved = saveConditionDef(id, { name: text("name"), description: text("description"), effects, ...lifecycle });
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
