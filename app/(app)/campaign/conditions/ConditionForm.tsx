import { effectText, lifecycleSentences } from "@/lib/effectGrammar";
import EffectBuilder from "../effects/EffectBuilder";
import Link from "next/link";
import { type ConditionDef, type EffectDef } from "@/lib/conditions";
import { submitCondition } from "./actions";

/**
 * A catalog condition: what's put on a creature. It applies effects (the rules live there) and owns the lifecycle,
 * written as sentences: how long it lasts, its saves, what ends it, what happens if it's applied again.
 */
export default function ConditionForm({ initial, effects }: { initial?: ConditionDef; effects: EffectDef[] }) {
  return (
    <form action={submitCondition.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-condition-form>
      <input name="name" placeholder="Condition name (e.g. Poisoned, Mesmerized)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it is (e.g. venom in the blood)" defaultValue={initial?.description} className="textarea w-full" />
      <fieldset className="space-y-1 rounded-box border border-base-300 p-2" data-condition-effects>
        <legend className="px-1 text-sm font-semibold">Applies these effects{initial?.builtin ? " (built in: fixed)" : ""}</legend>
        {effects.length ? (
          effects.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="effect" value={e.id} defaultChecked={initial?.effects.includes(e.id)} disabled={!!initial?.builtin} className="checkbox checkbox-sm mt-0.5" />
              <span><span className="font-medium">{e.name}</span> <span className="opacity-60">{effectText(e) || e.description}</span></span>
            </label>
          ))
        ) : (
          <p className="text-xs opacity-60">No effects yet.</p>
        )}
        <Link href="/campaign/effects/new" className="link link-hover text-xs">+ New effect</Link>
      </fieldset>
      <EffectBuilder grammar="condition" initial={lifecycleSentences(initial ?? { rounds: 6 })} />
      <button className="btn btn-primary btn-sm">{initial ? "Save condition" : "Create condition"}</button>
    </form>
  );
}
