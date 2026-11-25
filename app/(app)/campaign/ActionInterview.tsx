"use client";

import { useMemo, useState } from "react";
import { gearOf, type ActionFields } from "@/lib/actionCard";
import { gearSummary } from "@/lib/actionSummary";
import { answersFromAction, fieldsFromAnswers, questions, type ActionType, type Answers, type Question } from "@/lib/actionWizard";
import type { Condition } from "@/lib/conditions";

const TYPES: [ActionType, string, string][] = [
  ["action", "Action", "The round's one action."],
  ["bonus", "Bonus action", "The round's one bonus action, on top of the action."],
  ["reaction", "Reaction", "The round's one reaction: it readies something on its user."],
  ["free", "Free", "Costs only its time: as many as fit in the round."],
];

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
export default function ActionInterview({ action, initial, conditions }: { action: (f: FormData) => void; initial?: ActionFields; conditions: Condition[] }) {
  const [a, setA] = useState<Answers>(() => answersFromAction(initial));
  const [at, setAt] = useState<Question>("name");
  const set = (p: Partial<Answers>) => setA((x) => ({ ...x, ...p }));
  const qs = questions(a);
  const i = Math.max(0, qs.indexOf(at));
  const fields = fieldsFromAnswers(a);
  const byId = useMemo(() => new Map(conditions.map((c) => [c.id, c])), [conditions]);
  const card = gearSummary(gearOf(fields, (id) => byId.get(id)));
  const last = i === qs.length - 1;
  const ok = at !== "name" || !!a.name.trim();

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
        {at !== "name" && at !== "type" && <p className="text-sm opacity-70">This question isn&apos;t built yet; its answer stays as it was. Use the older form below to change it for now.</p>}
      </div>
      <HiddenFields f={fields} />
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => setAt(qs[i - 1])}>Back</button>
        {!last && <button type="button" className="btn btn-sm" disabled={!ok} onClick={() => setAt(qs[i + 1])}>Next</button>}
        <button className={`btn btn-sm ${last ? "btn-primary" : "btn-ghost"}`} disabled={!a.name.trim()}>Save action</button>
      </div>
    </form>
  );
}
