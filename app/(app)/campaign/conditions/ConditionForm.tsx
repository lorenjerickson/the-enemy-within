import Link from "next/link";
import { ATTRIBUTES } from "@/lib/attributes";
import { describeEffect, type ConditionDef, type EffectDef } from "@/lib/conditions";
import { submitCondition } from "./actions";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A catalog condition: what's put on a creature. It applies effects (the modifiers live there) and owns the lifecycle:
 * how long it lasts and the save that ends it.
 */
export default function ConditionForm({ initial, effects }: { initial?: ConditionDef; effects: EffectDef[] }) {
  return (
    <form action={submitCondition.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-condition-form>
      <input name="name" placeholder="Condition name (e.g. Poisoned, Mesmerized)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it is (e.g. venom in the blood)" defaultValue={initial?.description} className="textarea w-full" />
      <fieldset className="space-y-1 rounded-box border border-base-300 p-2" data-condition-effects>
        <legend className="px-1 text-sm font-semibold">Applies these effects</legend>
        {effects.length ? (
          effects.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="effect" value={e.id} defaultChecked={initial?.effects.includes(e.id)} className="checkbox checkbox-sm mt-0.5" />
              <span><span className="font-medium">{e.name}</span> <span className="opacity-60">{describeEffect(e) || e.description}</span></span>
            </label>
          ))
        ) : (
          <p className="text-xs opacity-60">No effects yet.</p>
        )}
        <Link href="/campaign/effects/new" className="link link-hover text-xs">+ New effect</Link>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm" data-apply-save>
        <span className="font-semibold">Save when applied</span>
        <select name="apply_save_attr" defaultValue={initial?.apply_save_attr ?? ""} className="select select-sm w-auto">
          <option value="">no save</option>
          {ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
        </select>
        DC
        <input name="apply_save_dc" type="number" min="1" defaultValue={initial?.apply_save_dc ?? 12} className="input input-sm w-16" />
        a success
        <select name="apply_save_outcome" defaultValue={initial?.apply_save_outcome ?? "negates"} className="select select-sm w-auto">
          <option value="negates">means it doesn&apos;t take hold</option>
          <option value="halves">halves its rounds</option>
        </select>
        <span className="w-full text-xs opacity-60">Players roll their own (the round waits for them); the server rolls for your creatures.</span>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Lasts</span>
        <input name="rounds" type="number" min="1" defaultValue={initial?.rounds ?? 6} className="input input-sm w-20" />
        rounds
        <span className="text-xs opacity-60">(6 s each; out of an encounter, every 6 s of game time counts as a round)</span>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Ends on a save</span>
        <select name="save_attr" defaultValue={initial?.save_attr ?? ""} className="select select-sm w-auto">
          <option value="">no save</option>
          {ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
        </select>
        DC
        <input name="save_dc" type="number" min="1" defaultValue={initial?.save_dc ?? 12} className="input input-sm w-16" />
        <span className="text-xs opacity-60">rolled at the end of each round; success ends it</span>
      </fieldset>
      <button className="btn btn-primary btn-sm">{initial ? "Save condition" : "Create condition"}</button>
    </form>
  );
}
