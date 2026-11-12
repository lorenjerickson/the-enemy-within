"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { getEffectDef, listEffectDefs, removeEffectDef, saveEffectDef } from "@/lib/db";
import type { Modifier } from "@/lib/conditions";
import { CONDITION_SENTENCE, MADE_CONDITION, checkRule, compile, compileLifecycle, type Filled } from "@/lib/effectGrammar";

const readJson = (text: string, what: string): Filled[] => {
  let v: unknown;
  try { v = JSON.parse(text || "[]"); } catch { throw new Error(`The ${what} couldn't be read`); }
  if (!Array.isArray(v)) throw new Error(`The ${what} couldn't be read`);
  return v as Filled[];
};

/**
 * Creates (id null) or saves a catalog effect from its form: its rules and its lifecycle arrive as the builders'
 * filled blanks (JSON), each checked against the grammar and compiled to what the engine reads. A rule the engine
 * can't run yet isn't saved (the builder says so as it's written). A built-in's rules stay; its lifecycle is the GM's.
 */
export async function submitEffect(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const was = id === null ? undefined : getEffectDef(id);
  let modifiers: Modifier[] = was?.modifiers ?? [];
  if (!was?.builtin) {
    const effects = listEffectDefs(), effectId = (name: string) => effects.find((e) => e.name === name)?.id ?? -1;
    modifiers = readJson(text("rules"), "rules").flatMap((rule, i) => {
      const problem = checkRule(rule);
      if (problem) throw new Error(`Rule ${i + 1} isn't finished: ${problem}`);
      const out = compile(rule, effectId);
      if (!out.modifiers.length) throw new Error(`Rule ${i + 1} can't be saved yet: ${out.notes.join("; ") || "the engine can't run it"}`);
      // A shortcut ("your defense increases by 1 for 3 rounds") makes its stacking effect (or reuses one of that name).
      if (out.creates) {
        const made = out.creates;
        const madeId = effects.find((e) => e.name === made.name)?.id ?? saveEffectDef(null, { name: made.name, description: "Made by an effect's rule.", modifiers: made.effect, rounds: made.rounds, reapply: made.reapply, stack_limit: made.stack_limit });
        out.modifiers = out.modifiers.map((m) => ("condition" in m && m.condition === MADE_CONDITION ? { ...m, condition: madeId } : m));
      }
      if (out.modifiers.some((m) => "condition" in m && m.condition === -1)) throw new Error(`Rule ${i + 1}: that effect isn't in the catalog`);
      return out.modifiers;
    });
  }
  // How long it lasts: its lifecycle sentences, each checked, then put together (once each).
  const life = readJson(text("lifecycle"), "lifecycle");
  life.forEach((r, i) => { const p = checkRule(r, CONDITION_SENTENCE); if (p) throw new Error(`"How long it lasts" sentence ${i + 1} isn't finished: ${p}`); });
  const { lifecycle, problem } = compileLifecycle(life);
  if (!lifecycle) throw new Error(problem);
  const saved = saveEffectDef(id, { name: text("name"), description: text("description"), modifiers, ...lifecycle });
  revalidatePath("/campaign/effects");
  if (id === null) redirect(`/campaign/effects/${saved}`);
}

export async function deleteEffect(id: number) {
  await requireGm();
  if (getEffectDef(Number(id))?.builtin) throw new Error("Built-in effects can't be deleted");
  removeEffectDef(Number(id));
  revalidatePath("/campaign/effects");
  redirect("/campaign/effects");
}
