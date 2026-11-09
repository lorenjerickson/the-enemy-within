import { FORBIDS, TRIGGER_EVENTS, describeModifier, type EffectDef } from "@/lib/conditions";
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
export default function EffectForm({ initial, conditions = [] }: { initial?: EffectDef; conditions?: { id: number; name: string }[] }) {
  const mods = initial?.modifiers ?? [];
  const aura = mods.find((m) => m.kind === "aura");
  const tr = mods.find((m) => m.kind === "trigger");
  const trig = tr?.kind === "trigger" ? tr : undefined;
  const speed = mods.find((m) => m.kind === "speed"), temphp = mods.find((m) => m.kind === "temphp"), maxhp = mods.find((m) => m.kind === "maxhp");
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
          <div className="flex flex-wrap items-center gap-2 text-sm" data-health-mods>
          <span className="font-semibold">Temporary health</span>
          <input name="temphp_value" pattern={DICE_PATTERN} placeholder="e.g. 1d4+4" defaultValue={temphp?.kind === "temphp" ? temphp.value : ""} className="input input-sm w-28" />
          <span className="font-semibold">Maximum health</span>
          <input name="maxhp_value" type="number" placeholder="+5 or -3" defaultValue={maxhp?.kind === "maxhp" ? maxhp.value : ""} className="input input-sm w-24" />
          <span className="text-xs opacity-60">temporary health as it lands (the highest counts); maximum while it lasts</span>
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
        <div className="space-y-1 text-sm" data-trigger>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Trigger</span>
            <select name="trigger_on" defaultValue={trig?.on ?? ""} className="select select-sm w-auto">
              <option value="">none</option>
              {TRIGGER_EVENTS.map(([e, label]) => <option key={e} value={e}>{label}</option>)}
            </select>
            <select name="trigger_reach" defaultValue={trig?.reach ?? "melee"} className="select select-sm w-auto">
              <option value="melee">in melee</option>
              <option value="any">by any attack</option>
            </select>
            <span className="text-xs opacity-60">the other creature: the attacker (when hit), whoever they hit, or themselves (moving, start of the round); &quot;in melee&quot; only matters for hits</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-4">
            deals
            <input name="trigger_damage" pattern={DICE_PATTERN} placeholder="dice (e.g. 2d8)" defaultValue={trig?.damage ?? ""} className="input input-sm w-28" />
            <select name="trigger_type" defaultValue={trig?.damage_type ?? ""} className="select select-sm w-auto">
              <option value="">type…</option>
              {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            to the other;
            <select name="trigger_save_attr" defaultValue={trig?.save_attr ?? ""} className="select select-sm w-auto">
              <option value="">no save</option>
              {ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)} save</option>)}
            </select>
            DC
            <input name="trigger_save_dc" type="number" min="1" defaultValue={trig?.save_dc ?? 12} className="input input-sm w-16" />
            <select name="trigger_save_halves" defaultValue={trig && !trig.save_halves ? "negates" : "halves"} className="select select-sm w-auto">
              <option value="halves">halves it</option>
              <option value="negates">negates it</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-4">
            puts
            <select name="trigger_condition" defaultValue={trig?.condition ? String(trig.condition) : ""} className="select select-sm w-auto">
              <option value="">no condition</option>
              {conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            on
            <select name="trigger_condition_on" defaultValue={trig?.condition_on ?? "other"} className="select select-sm w-auto">
              <option value="other">the other creature</option>
              <option value="self">themselves</option>
            </select>
            <span className="text-xs opacity-60">(to end the condition once it fires, tick &quot;once its trigger fires&quot; on the condition)</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-aura>
          <span className="font-semibold">Aura</span>
          <select name="aura_condition" defaultValue={aura?.kind === "aura" ? String(aura.condition) : ""} className="select select-sm w-auto">
            <option value="">none</option>
            {conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          on
          <select name="aura_who" defaultValue={aura?.kind === "aura" ? aura.who : "enemy"} className="select select-sm w-auto">
            <option value="enemy">enemies</option>
            <option value="friendly">allies</option>
            <option value="">everyone</option>
          </select>
          within
          <input name="aura_radius" type="number" min="5" step="5" defaultValue={aura?.kind === "aura" ? aura.radius : 10} className="input input-sm w-20" />
          ft
          <label className="flex items-center gap-1"><input type="checkbox" name="aura_self" defaultChecked={aura?.kind === "aura" && aura.self} className="checkbox checkbox-xs" /> itself too</label>
          <span className="text-xs opacity-60">while they&apos;re within it (a save as it lands is rolled on entering; passing keeps them safe until they leave)</span>
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
