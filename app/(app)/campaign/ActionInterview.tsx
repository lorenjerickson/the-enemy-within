"use client";

import { useMemo, useState } from "react";
import { gearOf, type ActionFields } from "@/lib/actionCard";
import { gearSummary } from "@/lib/actionSummary";
import { answersFromAction, fieldsFromAnswers, questions, type ActionType, type Answers, type Question } from "@/lib/actionWizard";
import type { Condition } from "@/lib/conditions";
import { DAMAGE_TYPES } from "@/lib/actions";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";
import { AFFECTS, type Affect } from "@/lib/actionWizard";

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

const num = (v: string, min: number, d: number) => Math.max(min, Number(v) || d);

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
export default function ActionInterview({ action, initial, conditions, itemOwned }: { action: (f: FormData) => void; initial?: ActionFields; conditions: Condition[]; itemOwned?: boolean }) {
  const [a, setA] = useState<Answers>(() => answersFromAction(initial));
  const [at, setAt] = useState<Question>("name");
  const set = (p: Partial<Answers>) => setA((x) => ({ ...x, ...p }));
  const qs = questions(a);
  const i = Math.max(0, qs.indexOf(at));
  const fields = fieldsFromAnswers(a);
  const byId = useMemo(() => new Map(conditions.map((c) => [c.id, c])), [conditions]);
  const card = gearSummary(gearOf(fields, (id) => byId.get(id)));
  const last = i === qs.length - 1;
  const compact = (v: string) => v.toLowerCase().replace(/\s/g, "");
  const ok = at === "name" ? !!a.name.trim()
    : at === "affects" ? a.affects.length > 0
    : at === "damage" ? isDiceFormula(compact(a.damage))
    : at === "toHit" ? !a.attackBonus || isModifierFormula(compact(a.attackBonus))
    : true;

  return (
    <form action={action} className="mt-2 space-y-3 rounded-box bg-base-200 p-3" data-action-interview>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm" aria-live="polite">
        <div className="mb-1 text-xs uppercase opacity-60">The card reads</div>
        <p className="font-semibold">{a.name || "This action"}</p>
        {card.map((l, k) => <p key={k}>{l}</p>)}
      </div>
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
              <input type="number" min="0.5" max="6" step="0.5" value={a.seconds} onChange={(e) => set({ seconds: Math.min(6, Math.max(0.5, Number(e.target.value) || 2)) })} className="input input-sm w-20" />
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
              <input type="number" min="2" value={a.n} onChange={(e) => set({ n: Math.round(num(e.target.value, 2, 2)) })} className="input input-sm w-20" />
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
                  <input type="number" min="5" step="5" value={a.rangeFt || 5} onChange={(e) => set({ rangeFt: num(e.target.value, 5, 5) })} className="input input-sm w-24" /> feet
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
              <input type="number" min="5" step="5" value={a.areaFt} onChange={(e) => set({ areaFt: num(e.target.value, 5, 10) })} className="input input-sm w-24" />
              feet {a.shape === "circle" ? "radius" : "long"}
              {a.shape === "circle" && (
                <>
                  <span className="ml-2">aimed up to</span>
                  <input type="number" min="0" step="5" value={a.rangeFt} onChange={(e) => set({ rangeFt: num(e.target.value, 0, 0) })} className="input input-sm w-24" /> feet away
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
              {AFFECTS.map((x) => (
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
        {!["name", "type", "who", "targetWho", "count", "range", "shape", "areaSize", "lasts", "affects", "damage", "toHit"].includes(at) && <p className="text-sm opacity-70">This question isn&apos;t built yet; its answer stays as it was. Use the older form below to change it for now.</p>}
      </div>
      <HiddenFields f={fields} />
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => setAt(qs[i - 1])}>Back</button>
        {!last && <button type="button" className="btn btn-sm" disabled={!ok} onClick={() => setAt(qs[i + 1])}>Next</button>}
        <button className={`btn btn-sm ${last ? "btn-primary" : "btn-ghost"}`} disabled={!a.name.trim() || !ok}>Save action</button>
      </div>
    </form>
  );
}
