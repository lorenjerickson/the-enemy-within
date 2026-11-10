import type { EffectDef } from "@/lib/conditions";
import { effectSentences, sentencesOf } from "@/lib/effectGrammar";
import EffectBuilder from "./EffectBuilder";
import { submitEffect } from "./actions";

/**
 * A catalog effect: a name, a description, and its rules as handbook sentences (what changes while it's active, or
 * what happens when). How long it lasts and what ends it belong to the conditions that apply it.
 */
export default function EffectForm({ initial, conditions = [] }: { initial?: EffectDef; conditions?: { id: number; name: string }[] }) {
  const mods = initial?.modifiers ?? [];
  return (
    <form action={submitEffect.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-effect-form>
      <input name="name" placeholder="Effect name (e.g. Incapacitated, Venom)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it does, in words" defaultValue={initial?.description} className="textarea w-full" />
      {initial?.builtin ? (
        <fieldset className="space-y-1 rounded-box border border-base-300 p-2" data-builtin-modifiers>
          <legend className="px-1 text-sm font-semibold">Rules (built in: they can&apos;t be changed)</legend>
          <ul className="list-inside list-disc text-sm">{effectSentences(mods).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </fieldset>
      ) : (
        <EffectBuilder initial={initial ? sentencesOf(initial.modifiers, (id) => conditions.find((c) => c.id === id)?.name ?? `#${id}`) : []} conditions={conditions} />
      )}
      <button className="btn btn-primary btn-sm">{initial ? "Save effect" : "Create effect"}</button>
    </form>
  );
}
