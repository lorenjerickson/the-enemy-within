import type { EffectDef } from "@/lib/conditions";
import { ATTRIBUTES } from "@/lib/attributes";
import { DAMAGE_TYPES, ROLL_KIND_GROUPS } from "@/lib/actions";
import { MODIFIER_TARGET_GROUPS } from "@/lib/modifiers";
import { DICE_PATTERN, MODIFIER_PATTERN } from "@/lib/itemTypes";
import PairListInput from "../PairListInput";
import { submitEffect } from "./actions";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A catalog effect: what it does each round, while it lasts, how long, and the save that ends it. */
export default function EffectForm({ initial }: { initial?: EffectDef }) {
  return (
    <form action={submitEffect.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-effect-form>
      <input name="name" placeholder="Effect name (e.g. Poisoned)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it is (e.g. venom in the blood)" defaultValue={initial?.description} className="textarea w-full" />
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Each round</span>
        <input name="per_round" pattern={DICE_PATTERN} placeholder="dice (e.g. 1d2)" defaultValue={initial?.per_round} className="input input-sm w-28" />
        <select name="per_round_kind" defaultValue={initial?.per_round_kind ?? "damage"} className="select select-sm w-auto">
          <option value="damage">damage</option>
          <option value="healing">healing</option>
        </select>
        <select name="damage_type" defaultValue={initial?.damage_type ?? ""} className="select select-sm w-auto">
          <option value="">type…</option>
          {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
        </select>
        <span className="text-xs opacity-60">at the end of every round (blank = none)</span>
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
      <fieldset className="space-y-2 rounded-box border border-base-300 p-2">
        <legend className="px-1 text-sm font-semibold">While it lasts</legend>
        <PairListInput title="Boosts (or penalties)" addLabel="+ Add boost" firstName="boost_target" firstPlaceholder="Changes…" groups={MODIFIER_TARGET_GROUPS} secondName="boost_value" secondPattern={MODIFIER_PATTERN} secondPlaceholder="+2 or -1d4" initial={(initial?.boosts ?? []).map((b) => [b.target, b.value])} />
        <PairListInput title="Advantage / disadvantage on rolls" addLabel="+ Add roll effect" firstName="grant_roll" firstPlaceholder="Roll…" groups={ROLL_KIND_GROUPS} secondName="grant_mode" secondOptions={["advantage", "disadvantage"]} initial={(initial?.roll_grants ?? []).map((g) => [g.roll, g.mode])} />
      </fieldset>
      <button className="btn btn-primary btn-sm">{initial ? "Save effect" : "Create effect"}</button>
    </form>
  );
}
