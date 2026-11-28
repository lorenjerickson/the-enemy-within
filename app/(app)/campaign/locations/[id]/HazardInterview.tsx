"use client";

import { useState, useTransition } from "react";
import { TRAITS, type Hazard } from "@/lib/hazards";
import { CATCHES, PRESETS, SET_OFF_BY, answerLine, answersFromHazard, applyPreset, hazardCard, hazardExtras, hazardPatch, questions, type Answers, type Question } from "@/lib/hazardWizard";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import { DAMAGE_TYPES } from "@/lib/actions";
import { EFFECT_KINDS, EFFECT_LABELS, type EffectKind } from "@/lib/effects";
import { isDiceFormula } from "@/lib/itemTypes";
import { Choices, NumberBox } from "../../interviewParts";
import { saveHazardAnswers } from "../actions";
import TuneEffect from "../../TuneEffect";
import type { Effect } from "@/lib/conditions";

/**
 * A hazard as an interview (backlog X), part 1: the card on top in plain words, the answers so far (click one to go
 * back), then one question at a time: name, a preset (new ones), activation, how long it stays active, whom it
 * catches, who it's for, how often, whether it stops them. Saves only these; the rest of the hazard is kept.
 */
export default function HazardInterview({ locationId, hazard, isNew, effects, sounds, now }: { locationId: number; hazard: Hazard; isNew: boolean; effects: Effect[]; sounds: { id: number; name: string }[]; now: number }) {
  const [a, setA] = useState<Answers>(() => answersFromHazard(hazard, now));
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
    : q === "damage" ? !a.damage.trim() || isDiceFormula(a.damage.toLowerCase().replace(/\s/g, "")) || /^\d+$/.test(a.damage.trim())
    : true;
  const ok = valid(at), allOk = qs.every(valid);
  const next = () => { if (ok && !last) setAt(qs[i + 1]); };
  const save = () => start(() => saveHazardAnswers(locationId, hazard.id, JSON.stringify({ ...hazardPatch(a), ...hazardExtras(a) })));
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
        {at === "visible" && (
          <>
            <div className="font-semibold">When do players see it?</div>
            <Choices value={a.visibility} options={[["shown", "Always", "a fire wall, a cloud"], ["hidden", "Once it goes off, or it's found", "a trap: those who see it go off, or a Search"], ["gm", "Never", "only the GM sees it (a ward)"]]} onPick={(visibility) => set({ visibility })} />
            {a.visibility === "hidden" && <label className="flex items-center gap-2">a Search finds it with <NumberBox min={1} max={40} value={a.findDc} onChange={(findDc) => set({ findDc })} className="input input-sm w-20" /> or more (within 10 feet)</label>}
          </>
        )}
        {at === "look" && (
          <>
            <div className="font-semibold">How does it look and sound on the map?</div>
            <label className="flex flex-wrap items-center gap-2">Look
              <select value={a.look} onChange={(e) => set({ look: e.target.value as EffectKind | "none" })} className="select select-sm w-auto">
                <option value="none">an outline only (a pit, a tripwire)</option>
                {EFFECT_KINDS.map((k) => <option key={k} value={k}>{EFFECT_LABELS[k]}</option>)}
              </select>
            </label>
            <label className="flex flex-wrap items-center gap-2">Sound
              <select value={a.sound ?? ""} onChange={(e) => set({ sound: Number(e.target.value) || null })} className="select select-sm w-auto"><option value="">none</option>{sounds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.obscures} onChange={(e) => set({ obscures: e.target.checked })} data-obscures />obscures sight (fog, smoke): no one sees further than 15 ft into it</label>
            {a.sound !== null && <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.soundHidden} onChange={(e) => set({ soundHidden: e.target.checked })} />play the sound while it's hidden (a cue that something is there)</label>}
          </>
        )}
        {at === "damage" && (
          <>
            <div className="font-semibold">Does it deal damage?</div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={a.damage} onChange={(e) => set({ damage: e.target.value })} placeholder="none, or e.g. 2d6" className={`input input-sm w-28 ${ok ? "" : "input-error"}`} />
              <select value={a.damageType} onChange={(e) => set({ damageType: e.target.value })} className="select select-sm w-auto"><option value="">no type</option>{DAMAGE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            </div>
            {a.damage.trim() && (
              <>
                <Choices value={a.damageSave ? "yes" : "no"} options={[["no", "No save", "it always lands"], ["yes", "A save against it", "half or none on a success"]]} onPick={(v) => set({ damageSave: v === "yes" })} />
                {a.damageSave && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={a.saveAttr} onChange={(e) => set({ saveAttr: e.target.value as Attribute })} className="select select-sm w-auto">{ATTRIBUTES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select>
                    save, DC <NumberBox min={1} max={40} value={a.saveDc} onChange={(saveDc) => set({ saveDc })} className="input input-sm w-20" />
                    <select value={a.half ? "half" : "none"} onChange={(e) => set({ half: e.target.value === "half" })} className="select select-sm w-auto"><option value="half">half damage on a success</option><option value="none">no damage on a success</option></select>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {at === "effects" && (
          <>
            <div className="font-semibold">Does it put any effects on whoever it catches?</div>
            <div className="flex max-h-48 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
              {effects.map((e) => <label key={e.id} className="flex items-center gap-1"><input type="checkbox" className="checkbox checkbox-xs" checked={a.effectIds.includes(e.id)} onChange={(ev) => set({ effectIds: toggle(a.effectIds, e.id, ev.target.checked) })} />{e.name}</label>)}
            </div>
            {a.effectIds.map((id) => {
              const from = effects.find((e) => e.id === id), copy = a.effectCopies[id] ?? from;
              return copy ? (
                <details key={id}>
                  <summary className="cursor-pointer">Tune {copy.name} for this hazard</summary>
                  <TuneEffect copy={copy} catalog={from} onChange={(c) => set({ effectCopies: { ...a.effectCopies, [id]: c } })} />
                </details>
              ) : null;
            })}
            <p className="text-xs opacity-60">With a save against its damage, they land when the damage does (full or half); otherwise each rolls its own save as it lands.</p>
          </>
        )}
        {at === "lingers" && (
          <>
            <div className="font-semibold">Does its harm linger, and does fire set it burning?</div>
            <label className="flex flex-wrap items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.lingers} onChange={(e) => set({ lingers: e.target.checked })} />its harm lingers</label>
            {a.lingers && <div className="flex flex-wrap items-center gap-2 pl-6">+<NumberBox min={0} max={20} value={a.buildUp} onChange={(buildUp) => set({ buildUp })} className="input input-sm w-16" /> each round inside, −<NumberBox min={1} max={20} value={a.decay} onChange={(decay) => set({ decay })} className="input input-sm w-16" /> each round after leaving</div>}
            <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.flammable} onChange={(e) => set({ flammable: e.target.checked })} />flammable: fire touching it sets it burning for 3 rounds, then it's spent</label>
          </>
        )}
        {at === "traits" && (
          <>
            <div className="font-semibold">What does the place itself do to moving through it? <span className="font-normal opacity-60">(none: nothing special)</span></div>
            {TRAITS.map(([t, label]) => (
              <label key={t} className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.traits.includes(t)} onChange={(e) => set({ traits: e.target.checked ? [...a.traits, t] : a.traits.filter((x) => x !== t) })} data-trait={t} />{label}</label>
            ))}
          </>
        )}
        {at === "when" && (
          <>
            <div className="font-semibold">Does a script condition activate or deactivate it? <span className="font-normal opacity-60">(optional; checked whenever the game changes, acting as it becomes true)</span></div>
            <label className="block">Activates when… <input value={a.activatesWhen} onChange={(e) => set({ activatesWhen: e.target.value })} placeholder="e.g. game.vars.alarmRaised" className="input input-sm w-full font-mono" data-activates-when /></label>
            <label className="block">Deactivates when… <input value={a.deactivatesWhen} onChange={(e) => set({ deactivatesWhen: e.target.value })} placeholder="e.g. game.vars.sluiceOpen" className="input input-sm w-full font-mono" data-deactivates-when /></label>
          </>
        )}
        {at === "lasts" && (
          <>
            <div className="font-semibold">How long does it stay on the map?</div>
            <Choices value={a.lasts > 0 ? "time" : "removed"} options={[["removed", "Until removed", ""], ["time", "A while", "in game minutes (a round is 0.1)"]]} onPick={(v) => set({ lasts: v === "time" ? a.lasts || 1 : 0 })} />
            {a.lasts > 0 && <label className="flex items-center gap-2"><NumberBox min={0.1} max={100000} step={0.1} value={a.lasts} onChange={(lasts) => set({ lasts })} className="input input-sm w-24" /> minutes from now</label>}
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
