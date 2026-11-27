"use client";

import { useState, useTransition } from "react";
import type { Hazard } from "@/lib/hazards";
import { CATCHES, PRESETS, SET_OFF_BY, answerLine, answersFromHazard, applyPreset, hazardCard, hazardPatch, questions, type Answers, type Question } from "@/lib/hazardWizard";
import { Choices, NumberBox } from "../../interviewParts";
import { saveHazardAnswers } from "../actions";

/**
 * A hazard as an interview (backlog X), part 1: the card on top in plain words, the answers so far (click one to go
 * back), then one question at a time: name, a preset (new ones), activation, how long it stays active, whom it
 * catches, who it's for, how often, whether it stops them. Saves only these; the rest of the hazard is kept.
 */
export default function HazardInterview({ locationId, hazard, isNew }: { locationId: number; hazard: Hazard; isNew: boolean }) {
  const [a, setA] = useState<Answers>(() => answersFromHazard(hazard));
  const [at, go] = useState<Question>("name");
  const [seen, setSeen] = useState<Set<Question>>(() => new Set(isNew ? ["name"] : questions(answersFromHazard(hazard))));
  const [pending, start] = useTransition();
  const setAt = (q: Question) => { go(q); setSeen((x) => new Set(x).add(q)); };
  const set = (p: Partial<Answers>) => setA((x) => ({ ...x, ...p }));
  const qs = questions(a, isNew);
  const i = Math.max(0, qs.indexOf(at));
  const last = i === qs.length - 1;
  const valid = (q: Question) => q === "name" ? !!a.name.trim()
    : q === "activation" ? a.activation === "always" || a.setOffBy.length > 0 || a.byTrigger
    : q === "catches" ? a.fires.length > 0
    : true;
  const ok = valid(at), allOk = qs.every(valid);
  const next = () => { if (ok && !last) setAt(qs[i + 1]); };
  const save = () => start(() => saveHazardAnswers(locationId, hazard.id, JSON.stringify(hazardPatch(a))));
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <div className="mt-2 space-y-3 rounded-box bg-base-200 p-3" data-hazard-interview={hazard.id}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key !== "Enter" || tag === "TEXTAREA" || tag === "BUTTON") return;
        e.preventDefault();
        if (!last) next();
        else if (allOk) save();
      }}>
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm" aria-live="polite">
        <div className="mb-1 text-xs uppercase opacity-60">The card reads</div>
        <p className="font-semibold">{a.name || "This hazard"}</p>
        {hazardCard(a).map((l, k) => <p key={k}>{l}</p>)}
      </div>
      <ol className="space-y-0.5 text-sm">
        {qs.filter((q) => seen.has(q) && q !== at).length > 0 && qs.map((q) => {
          if (!seen.has(q)) return null;
          const [label, value] = answerLine(q, a);
          return (
            <li key={q}>
              <button type="button" onClick={() => setAt(q)} className={`flex w-full gap-2 rounded px-1 text-left hover:bg-base-300 ${q === at ? "bg-base-300 font-semibold" : ""}`}>
                <span className="w-36 shrink-0 opacity-60">{label}</span><span className="truncate">{value}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="text-xs opacity-60">Question {i + 1} of {qs.length}</div>
      <div className="space-y-2 text-sm" data-question={at}>
        {at === "name" && (
          <>
            <label className="block font-semibold">What's it called?</label>
            <input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Spike pit, Burning hallway, Pocket of gas" className="input input-sm w-full" />
          </>
        )}
        {at === "preset" && (
          <>
            <div className="font-semibold">Start from a preset? <span className="font-normal opacity-60">(it only fills in answers; change any of them after)</span></div>
            <div className="grid gap-1 sm:grid-cols-2">
              {PRESETS.map(([p, label, about]) => (
                <button key={p} type="button" className="flex flex-col items-start rounded-box border border-base-300 p-2 text-left hover:border-primary" onClick={() => { setA((x) => applyPreset(x, p)); next(); }}>
                  <span className="font-medium">{label}</span><span className="text-xs opacity-70">{about}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {at === "activation" && (
          <>
            <div className="font-semibold">Is it always active, or does it wait to be set off?</div>
            <Choices value={a.activation} options={[["always", "Always active", "while it's switched on (a fire wall, a cloud)"], ["dormant", "Waits to be set off", "a trap: then it acts"]]} onPick={(activation) => set({ activation, ...(activation === "dormant" && !a.setOffBy.length && !a.byTrigger ? { setOffBy: ["enter"] } : {}) })} />
            {a.activation === "dormant" && (
              <div className="grid gap-1 sm:grid-cols-2">
                {SET_OFF_BY.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.setOffBy.includes(k)} onChange={(e) => set({ setOffBy: toggle(a.setOffBy, k, e.target.checked) })} />when {label}</label>
                ))}
                <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.byTrigger} onChange={(e) => set({ byTrigger: e.target.checked })} />when a map trigger sets it off (a lever, a plate elsewhere)</label>
              </div>
            )}
          </>
        )}
        {at === "activeFor" && (
          <>
            <div className="font-semibold">Once it's set off, how long is it active?</div>
            <Choices value={a.activeFor} options={[["instant", "An instant", "it acts once on whoever is in it (a pit)"], ["time", "A number of rounds", "it becomes a cloud, a fire… for a while"], ["untilOff", "Until it's switched off", ""]]} onPick={(activeFor) => set({ activeFor })} />
            {a.activeFor === "time" && <label className="flex items-center gap-2"><NumberBox min={1} max={600} value={a.activeRounds} onChange={(activeRounds) => set({ activeRounds })} className="input input-sm w-20" /> rounds</label>}
          </>
        )}
        {at === "catches" && (
          <>
            <div className="font-semibold">While it's active, whom does it catch?</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {CATCHES.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.fires.includes(k)} onChange={(e) => set({ fires: toggle(a.fires, k, e.target.checked) })} />whoever {label}</label>
              ))}
            </div>
          </>
        )}
        {at === "who" && (
          <>
            <div className="font-semibold">Who is it for?</div>
            <Choices value={a.who} options={[["", "Anyone"], ["party", "The party"], ["hostile", "The party's enemies"]]} onPick={(who) => set({ who })} />
          </>
        )}
        {at === "often" && (
          <>
            <div className="font-semibold">How often?</div>
            <Choices value={a.often} options={[["once", "Once", "then it's spent and gone from the map"], ["each", "Once for each creature", "it can be re-armed"], ["always", "Every time", ""]]} onPick={(often) => set({ often })} />
          </>
        )}
        {at === "stops" && (
          <>
            <div className="font-semibold">Does it stop whoever sets it off?</div>
            <Choices value={a.stops ? "yes" : "no"} options={[["no", "No", "they carry on"], ["yes", "Yes", "a walk ends there; in a round, no more moving"]]} onPick={(v) => set({ stops: v === "yes" })} />
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {i > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAt(qs[i - 1])}>Back</button>}
        {!last && <button type="button" className="btn btn-sm" disabled={!ok} onClick={next}>Next</button>}
        <button type="button" className="btn btn-primary btn-sm" disabled={!allOk || pending} onClick={save}>Save</button>
        {!allOk && <span className="text-xs text-warning">{!a.name.trim() ? "Give it a name." : "Say what sets it off, or whom it catches."}</span>}
      </div>
    </div>
  );
}
