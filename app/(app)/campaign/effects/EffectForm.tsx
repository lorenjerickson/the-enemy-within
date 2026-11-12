import type { Effect } from "@/lib/conditions";
import { effectSentences, lifecycleSentences, sentencesOf } from "@/lib/effectGrammar";
import EffectBuilder from "./EffectBuilder";
import { submitEffect } from "./actions";

/**
 * A catalog effect: a name, a description, its rules as handbook sentences (what changes while it's on, or what
 * happens when), and how long it lasts: so many rounds (with its saves and what ends it), while equipped (for what an
 * item gives), or always (a creature's own). Actions, the GM, items, creatures and professions grant effects.
 */
export default function EffectForm({ initial, effects = [] }: { initial?: Effect; effects?: { id: number; name: string }[] }) {
  const mods = initial?.modifiers ?? [];
  const named = effects.filter((e) => e.id !== initial?.id);
  return (
    <form action={submitEffect.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-effect-form>
      <input name="name" placeholder="Effect name (e.g. Poisoned, Mesmerized, Fire resistance)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it is, in words" defaultValue={initial?.description} className="textarea w-full" />
      {initial?.builtin ? (
        <fieldset className="space-y-1 rounded-box border border-base-300 p-2" data-builtin-modifiers>
          <legend className="px-1 text-sm font-semibold">Rules (built in: they can&apos;t be changed)</legend>
          <ul className="list-inside list-disc text-sm">{effectSentences(mods).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </fieldset>
      ) : (
        <EffectBuilder initial={initial ? sentencesOf(initial.modifiers, (id) => effects.find((e) => e.id === id)?.name ?? `#${id}`) : []} conditions={named} />
      )}
      <EffectBuilder grammar="condition" initial={lifecycleSentences(initial ?? { rounds: 6 })} />
      <p className="text-xs opacity-60">&quot;While equipped&quot; is for effects an item gives; &quot;always&quot; for a creature&apos;s own. Actions and the GM put on effects that last a number of rounds.</p>
      <button className="btn btn-primary btn-sm">{initial ? "Save effect" : "Create effect"}</button>
    </form>
  );
}
