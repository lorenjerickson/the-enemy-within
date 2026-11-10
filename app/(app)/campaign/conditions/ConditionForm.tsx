import { effectText } from "@/lib/effectGrammar";
import Link from "next/link";
import { ATTRIBUTES } from "@/lib/attributes";
import { type ConditionDef, type EffectDef } from "@/lib/conditions";
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
        <select name="save_when" defaultValue={initial?.save_when ?? "end"} className="select select-sm w-auto">
          <option value="end">at the end of each round</option>
          <option value="start">at the start of each round</option>
          <option value="damaged">whenever they&apos;re hurt</option>
        </select>
        successes needed
        <input name="saves_needed" type="number" min="1" defaultValue={initial?.saves_needed ?? 1} className="input input-sm w-16" />
        <label className="flex items-center gap-1">
          <input name="save_action" type="checkbox" defaultChecked={!!initial?.save_action} className="checkbox checkbox-sm" />
          they can spend an action (Shake off) to roll it
        </label>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm" data-reapply>
        <span className="font-semibold">Put on again</span>
        <select name="reapply" defaultValue={initial?.reapply ?? "refresh"} className="select select-sm w-auto">
          <option value="refresh">its rounds start over</option>
          <option value="stack">another runs alongside (stacks)</option>
          <option value="ignore">nothing happens</option>
        </select>
        at most
        <input name="stack_limit" type="number" min="0" defaultValue={initial?.stack_limit ?? 0} className="input input-sm w-16" />
        <span className="text-xs opacity-60">at once when stacking (0 = no limit; past it, the one with fewest rounds left starts over)</span>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-3 text-sm" data-ends-on>
        <span className="font-semibold">Also ends</span>
        <label className="flex items-center gap-1">
          <input name="ends_on_damage" type="checkbox" defaultChecked={!!initial?.ends_on_damage} className="checkbox checkbox-sm" />
          when they&apos;re hurt
        </label>
        <label className="flex items-center gap-1">
          <input name="ends_on_attack" type="checkbox" defaultChecked={!!initial?.ends_on_attack} className="checkbox checkbox-sm" />
          when they attack
        </label>
        <label className="flex items-center gap-1">
          <input name="ends_on_trigger" type="checkbox" defaultChecked={!!initial?.ends_on_trigger} className="checkbox checkbox-sm" />
          once its trigger fires
        </label>
        <label className="flex items-center gap-1">
          <input name="concentration" type="checkbox" defaultChecked={!!initial?.concentration} className="checkbox checkbox-sm" />
          if whoever put it on loses concentration (they keep one going at a time; hurt: Fortitude save; down: it ends)
        </label>
      </fieldset>
      <button className="btn btn-primary btn-sm">{initial ? "Save condition" : "Create condition"}</button>
    </form>
  );
}
