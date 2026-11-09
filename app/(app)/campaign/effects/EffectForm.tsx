import type { EffectDef } from "@/lib/conditions";
import { DAMAGE_TYPES, ROLL_KIND_GROUPS } from "@/lib/actions";
import { MODIFIER_TARGET_GROUPS } from "@/lib/modifiers";
import { DICE_PATTERN, MODIFIER_PATTERN } from "@/lib/itemTypes";
import PairListInput from "../PairListInput";
import { submitEffect } from "./actions";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A catalog effect: a named set of modifiers (what changes while it's active). How long it lasts and what ends it
 * belong to the conditions that apply it.
 */
export default function EffectForm({ initial }: { initial?: EffectDef }) {
  const mods = initial?.modifiers ?? [];
  const periodic = mods.find((m) => m.kind === "periodic");
  return (
    <form action={submitEffect.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-effect-form>
      <input name="name" placeholder="Effect name (e.g. Incapacitated, Venom)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it does, in words" defaultValue={initial?.description} className="textarea w-full" />
      <fieldset className="space-y-2 rounded-box border border-base-300 p-2">
        <legend className="px-1 text-sm font-semibold">Modifiers</legend>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Each round</span>
          <input name="periodic_value" pattern={DICE_PATTERN} placeholder="dice (e.g. 1d2)" defaultValue={periodic?.kind === "periodic" ? periodic.value : ""} className="input input-sm w-28" />
          <select name="periodic_kind" defaultValue={periodic?.kind === "periodic" && periodic.heal ? "healing" : "damage"} className="select select-sm w-auto">
            <option value="damage">damage</option>
            <option value="healing">healing</option>
          </select>
          <select name="periodic_type" defaultValue={periodic?.kind === "periodic" ? periodic.damage_type : ""} className="select select-sm w-auto">
            <option value="">type…</option>
            {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
          </select>
          <span className="text-xs opacity-60">at the end of every round (blank = none)</span>
        </div>
        <PairListInput title="Boosts (or penalties)" addLabel="+ Add boost" firstName="boost_target" firstPlaceholder="Changes…" groups={MODIFIER_TARGET_GROUPS} secondName="boost_value" secondPattern={MODIFIER_PATTERN} secondPlaceholder="+2 or -1d4" initial={mods.flatMap((m) => (m.kind === "boost" ? [[m.target, m.value] as [string, string]] : []))} />
        <PairListInput title="Advantage / disadvantage on rolls" addLabel="+ Add roll effect" firstName="grant_roll" firstPlaceholder="Roll…" groups={ROLL_KIND_GROUPS} secondName="grant_mode" secondOptions={["advantage", "disadvantage"]} initial={mods.flatMap((m) => (m.kind === "roll" ? [[m.roll, m.mode] as [string, string]] : []))} />
      </fieldset>
      <button className="btn btn-primary btn-sm">{initial ? "Save effect" : "Create effect"}</button>
    </form>
  );
}
