import { FORBIDS, describeModifier, type EffectDef } from "@/lib/conditions";
import { ATTRIBUTES } from "@/lib/attributes";
import { DAMAGE_TYPES, ROLL_KIND_GROUPS } from "@/lib/actions";
import { MODIFIER_TARGET_GROUPS } from "@/lib/modifiers";
import { DICE_PATTERN, MODIFIER_PATTERN } from "@/lib/itemTypes";
import PairListInput from "../PairListInput";
import { submitEffect } from "./actions";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** What can be set or multiplied: attributes, defense, damage, speeds. */
const SET_TARGETS = MODIFIER_TARGET_GROUPS.filter(([g]) => g !== "Skills" && g !== "Rolls").map(([g, opts]) => [g, opts.filter(([t]) => t !== "health" && t !== "attack")] as [string, [string, string][]]);
const SET_PATTERN = `\\d+(\\s*\\+\\s*(${ATTRIBUTES.join("|")}))?`;

/**
 * A catalog effect: a named set of modifiers (what changes while it's active). How long it lasts and what ends it
 * belong to the conditions that apply it.
 */
export default function EffectForm({ initial }: { initial?: EffectDef }) {
  const mods = initial?.modifiers ?? [];
  const speed = mods.find((m) => m.kind === "speed");
  const periodic = mods.find((m) => m.kind === "periodic"), instant = mods.find((m) => m.kind === "instant"), extra = mods.find((m) => m.kind === "extra");
  return (
    <form action={submitEffect.bind(null, initial?.id ?? null)} className="max-w-2xl space-y-3" data-effect-form>
      <input name="name" placeholder="Effect name (e.g. Incapacitated, Venom)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="What it does, in words" defaultValue={initial?.description} className="textarea w-full" />
      {initial?.builtin ? (
        <fieldset className="space-y-1 rounded-box border border-base-300 p-2" data-builtin-modifiers>
          <legend className="px-1 text-sm font-semibold">Modifiers (built in: the rules can&apos;t be changed)</legend>
          <ul className="list-inside list-disc text-sm">{mods.map((m, i) => <li key={i}>{describeModifier(m)}</li>)}</ul>
        </fieldset>
      ) : (
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
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">At once</span>
            <input name="instant_value" pattern={DICE_PATTERN} placeholder="dice (e.g. 1d10)" defaultValue={instant?.kind === "instant" ? instant.value : ""} className="input input-sm w-28" />
            <select name="instant_kind" defaultValue={instant?.kind === "instant" && !instant.heal ? "damage" : "healing"} className="select select-sm w-auto">
              <option value="healing">healing</option>
              <option value="damage">damage</option>
            </select>
            <select name="instant_type" defaultValue={instant?.kind === "instant" ? instant.damage_type : ""} className="select select-sm w-auto">
              <option value="">type…</option>
              {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <span className="text-xs opacity-60">once, as the condition lands (a healing draught)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">On a hit</span>
            <input name="extra_value" pattern={DICE_PATTERN} placeholder="extra dice (e.g. 1d6)" defaultValue={extra?.kind === "extra" ? extra.value : ""} className="input input-sm w-32" />
            <select name="extra_type" defaultValue={extra?.kind === "extra" ? extra.damage_type : ""} className="select select-sm w-auto">
              <option value="">type…</option>
              {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <select name="extra_when" defaultValue={extra?.kind === "extra" ? extra.when : "dealing"} className="select select-sm w-auto">
              <option value="dealing">on their hits</option>
              <option value="taking">on hits against them (by its source)</option>
            </select>
            <span className="text-xs opacity-60">a flaming weapon; a hex</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-forbid>
          <span className="font-semibold">Can&apos;t</span>
          {FORBIDS.map(([what, label]) => (
            <label key={what} className="flex items-center gap-1">
              <input type="checkbox" name="forbid" value={what} defaultChecked={mods.some((m) => m.kind === "forbid" && m.what === what)} className="checkbox checkbox-xs" />
              {label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-autofail>
          <span className="font-semibold">Fails saves</span>
          {ATTRIBUTES.map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input type="checkbox" name="autofail" value={a} defaultChecked={mods.some((m) => m.kind === "autofail" && m.save === a)} className="checkbox checkbox-xs" />
              {cap(a)}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Speed</span>
          <select name="speed_factor" defaultValue={speed?.kind === "speed" ? String(speed.factor) : ""} className="select select-sm w-auto">
            <option value="">unchanged</option>
            <option value="0.5">half speed</option>
            <option value="2">double speed</option>
          </select>
          <span className="text-xs opacity-60">(to stop them moving at all, use a can&apos;t-move effect)</span>
        </div>
        <PairListInput title="Boosts (or penalties)" addLabel="+ Add boost" firstName="boost_target" firstPlaceholder="Changes…" groups={MODIFIER_TARGET_GROUPS} secondName="boost_value" secondPattern={MODIFIER_PATTERN} secondPlaceholder="+2 or -1d4" initial={mods.flatMap((m) => (m.kind === "boost" ? [[m.target, m.value] as [string, string]] : []))} />
          <PairListInput title="Resistances" addLabel="+ Add resistance" firstName="resist_type" firstPlaceholder="Damage type…" groups={[["Damage types", DAMAGE_TYPES.map((t) => [t, cap(t)] as [string, string])]]} secondName="resist_level" secondOptions={["resistant", "vulnerable", "immune"]} initial={mods.flatMap((m) => (m.kind === "resist" ? [[m.damage_type, m.level] as [string, string]] : []))} />
          <PairListInput title="Becomes (at least)" addLabel="+ Add setting" firstName="set_target" firstPlaceholder="Sets…" groups={SET_TARGETS} secondName="set_value" secondPattern={SET_PATTERN} secondPlaceholder="19, or 13+agility" initial={mods.flatMap((m) => (m.kind === "set" ? [[m.target, `${m.value}${m.plus ? `+${m.plus}` : ""}`] as [string, string]] : []))} />
        <PairListInput title="Multiplied" addLabel="+ Add multiplier" firstName="mul_target" firstPlaceholder="Multiplies…" groups={SET_TARGETS} secondName="mul_factor" secondOptions={["×0", "×½", "×2"]} initial={mods.flatMap((m) => (m.kind === "multiply" ? [[m.target, m.factor === 0.5 ? "×½" : `×${m.factor}`] as [string, string]] : []))} />
        <PairListInput title="Advantage / disadvantage on rolls" addLabel="+ Add roll effect" firstName="grant_roll" firstPlaceholder="Roll…" groups={ROLL_KIND_GROUPS} secondName="grant_mode" secondOptions={["advantage", "disadvantage"]} initial={mods.flatMap((m) => (m.kind === "roll" ? [[m.roll, m.mode] as [string, string]] : []))} />
        </fieldset>
      )}
      <button className="btn btn-primary btn-sm">{initial ? "Save effect" : "Create effect"}</button>
    </form>
  );
}
