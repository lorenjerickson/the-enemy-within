"use client";

import { useMemo, useState } from "react";
import { gearOf, type ActionFields } from "@/lib/actionCard";
import { gearSummary } from "@/lib/actionSummary";
import { answersFromAction, fieldsFromAnswers, questions, type ActionType, type Answers, type Question } from "@/lib/actionWizard";
import type { Condition } from "@/lib/conditions";
import { DAMAGE_TYPES, DURATION_UNITS } from "@/lib/actions";
import { MODIFIER_TARGET_GROUPS, type ModifierTarget } from "@/lib/modifiers";

// What Aid can raise: attributes, skills, rolls, and to-hit or damage (health and defense have their own questions).
const AID_GROUPS = MODIFIER_TARGET_GROUPS.filter(([g]) => g !== "Movement").map(([g, opts]) => [g, opts.filter(([t]) => t !== "health" && t !== "defense")] as const);
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";
import { AFFECTS, affectsFor, answerLine, type Affect } from "@/lib/actionWizard";
import { NO_SAVE_DC } from "@/lib/aoe";
import EffectChips, { type EffectOption } from "./EffectChips";

const AFFECT_LABELS: Record<Affect, [string, string]> = {
  attack: ["Attack", "Deals damage"],
  defend: ["Defend", "Raises their defense for a while"],
  heal: ["Heal", "Gives back health"],
  aid: ["Aid", "A bonus to a skill, attribute or roll for a while"],
  effect: ["Apply an effect", "Poisoned, Bleeding, Shielded… from the catalog"],
};

const TYPES: [ActionType, string, string][] = [
  ["action", "Action", "The round's one action."],
  ["bonus", "Bonus action", "The round's one bonus action, on top of the action."],
  ["reaction", "Reaction", "The round's one reaction: it readies something on its user."],
  ["free", "Free", "Costs only its time: as many as fit in the round."],
];

const WHO: [Answers["who"], string, string][] = [
  ["self", "Yourself", "Only whoever uses it."],
  ["one", "One creature", "Picked on the map."],
  ["several", "Several creatures", "A number of them, each picked."],
  ["area", "Everyone in an area", "A shape on the map: whoever is in it."],
];

/** A row of choices, one picked (radio cards). */
function Choices<T extends string>({ value, options, onPick }: { value: T; options: [T, string, string?][]; onPick: (v: T) => void }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {options.map(([v, label, about]) => (
        <label key={v} className={`flex cursor-pointer gap-2 rounded-box border p-2 text-sm ${value === v ? "border-primary" : "border-base-300"}`}>
          <input type="radio" className="radio radio-sm" checked={value === v} onChange={() => onPick(v)} />
          <span><span className="font-medium">{label}</span>{about && <span className="block text-xs opacity-70">{about}</span>}</span>
        </label>
      ))}
    </div>
  );
}

/** A number box that lets you type freely (30 goes through 3): it takes the number once it's at least `min`, and
 * puts back the last good one when you leave it. */
function NumberBox({ value, min, max, step, onChange, className }: { value: number; min: number; max?: number; step?: number; onChange: (n: number) => void; className: string }) {
  const [text, setText] = useState(String(value));
  const good = (t: string) => t.trim() !== "" && Number.isFinite(Number(t)) && Number(t) >= min && (max === undefined || Number(t) <= max);
  return (
    <input type="number" min={min} max={max} step={step} value={text} className={`${className} ${good(text) ? "" : "input-error"}`}
      onChange={(e) => { setText(e.target.value); if (good(e.target.value)) onChange(Number(e.target.value)); }}
      onBlur={() => { if (!good(text)) setText(String(value)); }} />
  );
}

/** The saved fields as the form posts them (the server action reads these names). */
function HiddenFields({ f }: { f: ActionFields }) {
  const plain: [string, string | number | null | undefined][] = [
    ["name", f.name], ["description", f.description], ["kind", f.kind], ["seconds", f.seconds], ["roll", f.roll],
    ["attack", f.attack], ["damage", f.damage], ["damage_type", f.damage_type], ["range_ft", f.range_ft], ["targets", f.targets],
    ["target_who", f.target_who], ["target_count", f.target_count], ["target_n", f.target_n],
    ["area_shape", f.area_shape], ["area_ft", f.area_ft], ["save_attr", f.save_attr], ["save_dc", f.save_dc],
    ["duration_amount", f.duration_amount], ["duration_unit", f.duration_unit],
  ];
  const pre = (on?: string) => (on === "target" ? "target_" : "");
  return (
    <>
      {plain.map(([k, v]) => <input key={k} type="hidden" name={k} value={v ?? ""} />)}
      {f.save_half ? <input type="hidden" name="save_half" value="on" /> : null}
      {f.area_lasts ? <input type="hidden" name="area_lasts" value="on" /> : null}
      {f.area_fires.split(",").filter(Boolean).map((x) => <input key={`fires${x}`} type="hidden" name="area_fires" value={x} />)}
      {f.boosts.map((b, i) => <span key={`b${i}`}><input type="hidden" name={`${pre(b.on)}boost_target`} value={b.target} /><input type="hidden" name={`${pre(b.on)}boost_value`} value={b.value} /></span>)}
      {f.roll_grants.map((g, i) => <span key={`g${i}`}><input type="hidden" name={`${pre(g.on)}grant_roll`} value={g.roll} /><input type="hidden" name={`${pre(g.on)}grant_mode`} value={g.mode} /></span>)}
      {f.conditions.map((c, i) => <input key={`c${i}`} type="hidden" name={`condition_${c.on}`} value={c.id} />)}
    </>
  );
}

/** One question at a time, the player's card on top filling in as it's answered; Save at the end. */
export default function ActionInterview({ action, initial, conditions, effectOptions, itemOwned }: { action: (f: FormData) => void; initial?: ActionFields; conditions: Condition[]; effectOptions: EffectOption[]; itemOwned?: boolean }) {
  const [a, setA] = useState<Answers>(() => answersFromAction(initial));
  const [at, go] = useState<Question>("name");
  // Answered so far: everything for a saved action; for a new one, each question once it's been reached.
  const [seen, setSeen] = useState<Set<Question>>(() => new Set(initial ? questions(answersFromAction(initial)) : ["name"]));
  const setAt = (q: Question) => { go(q); setSeen((x) => new Set(x).add(q)); };
  const set = (p: Partial<Answers>) => setA((x) => ({ ...x, ...p }));
  const qs = questions(a);
  const i = Math.max(0, qs.indexOf(at));
  const fields = fieldsFromAnswers(a);
  const byId = useMemo(() => new Map(conditions.map((c) => [c.id, c])), [conditions]);
  const card = gearSummary(gearOf(fields, (id) => byId.get(id)));
  const nameOf = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const last = i === qs.length - 1;
  const compact = (v: string) => v.toLowerCase().replace(/\s/g, "");
  const valid = (q: Question) => q === "name" ? !!a.name.trim()
    : q === "affects" ? a.affects.some((x) => affectsFor(a).includes(x))
    : q === "damage" ? isDiceFormula(compact(a.damage))
    : q === "toHit" ? !a.attackBonus || isModifierFormula(compact(a.attackBonus))
    : q === "defend" ? isModifierFormula(compact(a.defend))
    : q === "heal" ? isModifierFormula(compact(a.heal))
    : q === "aid" ? !!a.aidTarget && isModifierFormula(compact(a.aid))
    : q === "effects" ? a.effects.length > 0
    : true;
  const ok = valid(at);
  const allOk = qs.every(valid);
  const next = () => { if (ok && !last) setAt(qs[i + 1]); };
  // An older area with its own save loses it on saving: saves belong to the effects an area applies.
  const loses = !!initial?.area_shape && (initial.area_ft ?? 0) > 0 && initial.save_dc < NO_SAVE_DC && a.who === "area" && a.type !== "reaction";

  return (
    <form action={action} className="mt-2 space-y-3 rounded-box bg-base-200 p-3" data-action-interview
      onKeyDown={(e) => {
        // Enter goes on to the next question; it saves only at the last one, with every answer good.
        if (e.key !== "Enter" || e.defaultPrevented || (e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "BUTTON") return;
        e.preventDefault();
        if (!last) next();
        else if (allOk) e.currentTarget.requestSubmit();
      }}>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm" aria-live="polite">
        <div className="mb-1 text-xs uppercase opacity-60">The card reads</div>
        <p className="font-semibold">{a.name || "This action"}</p>
        {card.map((l, k) => <p key={k}>{l}</p>)}
      </div>
      <ol className="space-y-0.5 text-sm" data-answers>
        {qs.filter((q) => seen.has(q) && q !== at).length > 0 && qs.map((q) => {
          if (!seen.has(q)) return null;
          const [label, value] = answerLine(q, a, nameOf);
          return (
            <li key={q}>
              <button type="button" onClick={() => setAt(q)} className={`flex w-full gap-2 rounded px-1 text-left hover:bg-base-300 ${q === at ? "bg-base-300 font-semibold" : ""}`}>
                <span className="w-40 shrink-0 opacity-60">{label}</span><span className="truncate">{value}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="text-xs opacity-60">Question {i + 1} of {qs.length}</div>
      <div className="space-y-2" data-question={at}>
        {at === "name" && (
          <>
            <label className="block text-sm font-semibold">What's it called, and what is it, in your words?</label>
            <input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name (e.g. Circle of Flames)" className="input input-sm w-full" />
            <textarea value={a.description} onChange={(e) => set({ description: e.target.value })} placeholder="Description (optional): how it looks and feels" className="textarea textarea-sm w-full" />
          </>
        )}
        {at === "type" && (
          <>
            <div className="text-sm font-semibold">What kind of action is it, and how long does it take?</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {TYPES.map(([t, label, about]) => (
                <label key={t} className={`flex cursor-pointer gap-2 rounded-box border p-2 text-sm ${a.type === t ? "border-primary" : "border-base-300"}`}>
                  <input type="radio" className="radio radio-sm" checked={a.type === t} onChange={() => set({ type: t })} />
                  <span><span className="font-medium">{label}</span><span className="block text-xs opacity-70">{about}</span></span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              Takes
              <NumberBox min={0.5} max={6} step={0.5} value={a.seconds} onChange={(seconds) => set({ seconds })} className="input input-sm w-20" />
              seconds of the six-second round
            </label>
          </>
        )}
        {at === "who" && (
          <>
            <div className="text-sm font-semibold">Who does it apply to?</div>
            <Choices value={a.who} options={WHO} onPick={(who) => set({ who })} />
          </>
        )}
        {at === "targetWho" && (
          <>
            <div className="text-sm font-semibold">Which creatures can be picked?</div>
            <Choices value={a.targetWho} options={[["", "Anyone"], ["enemy", "Enemies"], ["friendly", "Friends"]]} onPick={(targetWho) => set({ targetWho })} />
          </>
        )}
        {at === "count" && (
          <>
            <div className="text-sm font-semibold">How many?</div>
            <div className="flex items-center gap-2 text-sm">
              <select value={a.count} onChange={(e) => set({ count: e.target.value as Answers["count"] })} className="select select-sm w-auto">
                <option value="exactly">Exactly</option>
                <option value="upto">Up to</option>
              </select>
              <NumberBox min={2} value={a.n} onChange={(n) => set({ n: Math.round(n) })} className="input input-sm w-20" />
              creatures
            </div>
          </>
        )}
        {at === "range" && (
          <>
            <div className="text-sm font-semibold">How far away can they be?</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {itemOwned && (
                <label className="flex items-center gap-1"><input type="checkbox" className="checkbox checkbox-sm" checked={a.rangeFt === 0} onChange={(e) => set({ rangeFt: e.target.checked ? 0 : 5 })} /> As far as the item reaches</label>
              )}
              {!(itemOwned && a.rangeFt === 0) && (
                <>
                  <NumberBox min={5} step={5} value={a.rangeFt || 5} onChange={(rangeFt) => set({ rangeFt })} className="input input-sm w-24" /> feet
                  <span className="text-xs opacity-60">(5 = within reach)</span>
                </>
              )}
            </div>
          </>
        )}
        {at === "shape" && (
          <>
            <div className="text-sm font-semibold">What shape is the area?</div>
            <Choices value={a.shape} options={[["circle", "Circle", "Aimed at a spot"], ["cone", "Cone", "Spreading out from you"], ["line", "Line", "Straight out from you"]]} onPick={(shape) => set({ shape })} />
          </>
        )}
        {at === "areaSize" && (
          <>
            <div className="text-sm font-semibold">How big is it{a.shape === "circle" ? ", and how far away can it be aimed" : ""}?</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <NumberBox min={5} step={5} value={a.areaFt} onChange={(areaFt) => set({ areaFt })} className="input input-sm w-24" />
              feet {a.shape === "circle" ? "radius" : "long"}
              {a.shape === "circle" && (
                <>
                  <span className="ml-2">aimed up to</span>
                  <NumberBox min={0} step={5} value={a.rangeFt} onChange={(rangeFt) => set({ rangeFt })} className="input input-sm w-24" /> feet away
                </>
              )}
            </div>
          </>
        )}
        {at === "lasts" && (
          <>
            <div className="text-sm font-semibold">Does the area stay on the map after this round?</div>
            <Choices value={a.lasts ? "yes" : "no"} options={[["no", "No", "It happens once."], ["yes", "Yes", "It lingers, catching whoever is in it each round (you'll say how long)."]]} onPick={(v) => set({ lasts: v === "yes" })} />
          </>
        )}
        {at === "affects" && (
          <>
            <div className="text-sm font-semibold">How does it affect {a.who === "self" || a.type === "reaction" ? "you" : "them"}? (pick any)</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {affectsFor(a).map((x) => (
                <label key={x} className={`flex cursor-pointer gap-2 rounded-box border p-2 text-sm ${a.affects.includes(x) ? "border-primary" : "border-base-300"}`}>
                  <input type="checkbox" className="checkbox checkbox-sm" checked={a.affects.includes(x)} onChange={(e) => set({ affects: AFFECTS.filter((y) => (y === x ? e.target.checked : a.affects.includes(y))) })} />
                  <span><span className="font-medium">{AFFECT_LABELS[x][0]}</span><span className="block text-xs opacity-70">{AFFECT_LABELS[x][1]}</span></span>
                </label>
              ))}
            </div>
          </>
        )}
        {at === "damage" && (
          <>
            <div className="text-sm font-semibold">How much damage, and of what type?</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input autoFocus value={a.damage} onChange={(e) => set({ damage: e.target.value })} placeholder="e.g. 1d8 or 2d6+1" className={`input input-sm w-32 ${a.damage && !ok ? "input-error" : ""}`} />
              <select value={a.damageType} onChange={(e) => set({ damageType: e.target.value as Answers["damageType"] })} className="select select-sm w-auto">
                <option value="">no type</option>
                {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {a.who === "area" && <p className="text-xs opacity-60">Everyone caught takes it: an area has no save. A save belongs to an effect it applies (pick one under Apply an effect).</p>}
          </>
        )}
        {at === "toHit" && (
          <>
            <div className="text-sm font-semibold">It needs a successful attack roll. Any bonus to hit?</div>
            <input autoFocus value={a.attackBonus} onChange={(e) => set({ attackBonus: e.target.value })} placeholder="none, or e.g. +2 or 1d4" className={`input input-sm w-40 ${!ok ? "input-error" : ""}`} />
          </>
        )}
        {at === "defend" && (
          <>
            <div className="text-sm font-semibold">How much does it raise {a.who === "self" || a.type === "reaction" ? "your" : "their"} defense?</div>
            <div className="flex items-center gap-2 text-sm">+<input autoFocus value={a.defend} onChange={(e) => set({ defend: e.target.value })} placeholder="e.g. 2" className={`input input-sm w-24 ${a.defend && !ok ? "input-error" : ""}`} /> defense</div>
          </>
        )}
        {at === "heal" && (
          <>
            <div className="text-sm font-semibold">How much does it heal?</div>
            <input autoFocus value={a.heal} onChange={(e) => set({ heal: e.target.value })} placeholder="e.g. 2d4+2" className={`input input-sm w-32 ${a.heal && !ok ? "input-error" : ""}`} />
          </>
        )}
        {at === "aid" && (
          <>
            <div className="text-sm font-semibold">Which skill, ability or roll does it help, and by how much?</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={a.aidTarget} onChange={(e) => set({ aidTarget: e.target.value as ModifierTarget | "" })} className="select select-sm w-auto">
                <option value="">Pick one…</option>
                {AID_GROUPS.map(([g, opts]) => (
                  <optgroup key={g} label={g}>{opts.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</optgroup>
                ))}
              </select>
              +<input value={a.aid} onChange={(e) => set({ aid: e.target.value })} placeholder="e.g. 1d4" className={`input input-sm w-24 ${a.aid && !ok ? "input-error" : ""}`} />
            </div>
          </>
        )}
        {at === "duration" && (
          <>
            <div className="text-sm font-semibold">How long does it last?</div>
            <div className="flex items-center gap-2 text-sm">
              <NumberBox min={1} value={a.durationAmount} onChange={(n) => set({ durationAmount: Math.round(n) })} className="input input-sm w-20" />
              <select value={a.durationUnit} onChange={(e) => set({ durationUnit: e.target.value as Answers["durationUnit"] })} className="select select-sm w-auto">
                {DURATION_UNITS.filter(Boolean).map((u) => <option key={u} value={u}>{u}{a.durationAmount > 1 && !u.endsWith("rest") ? "s" : ""}</option>)}
              </select>
            </div>
            <p className="text-xs opacity-60">For {[a.affects.includes("defend") && "the defense", a.affects.includes("aid") && "the aid", a.who === "area" && a.lasts && "the area"].filter(Boolean).join(", ")}. Effects last as the catalog says.</p>
          </>
        )}
        {at === "effects" && (
          <>
            <div className="text-sm font-semibold">Which effects does it apply{a.affects.includes("attack") ? (a.who === "area" ? " to everyone caught" : " on a hit") : ""}?</div>
            <EffectChips name="" options={effectOptions} initial={a.effects} onChange={(effects) => set({ effects })} />
            <p className="text-xs opacity-60">Each lasts, and is resisted, as the catalog says: its rounds, and any save as it lands. Change those in the effect itself.</p>
          </>
        )}
      </div>
      <HiddenFields f={fields} />
      {loses && <p className="text-xs text-warning">This area had its own save. Saves now belong to the effects it applies, so saving removes it (the card shows the result).</p>}
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => setAt(qs[i - 1])}>Back</button>
        {!last && <button type="button" className="btn btn-sm" disabled={!ok} onClick={next}>Next</button>}
        <button className={`btn btn-sm ${last ? "btn-primary" : "btn-ghost"}`} disabled={!allOk} title={allOk ? undefined : "Some answers still need filling in"}>Save action</button>
      </div>
    </form>
  );
}
