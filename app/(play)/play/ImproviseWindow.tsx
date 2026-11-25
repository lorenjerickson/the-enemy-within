"use client";

import { useState, useTransition } from "react";
import { ATTRIBUTES, SKILLS_BY_ATTRIBUTE } from "@/lib/attributes";
import { describeOutcome, type TriggerOutcome } from "@/lib/triggers";
import type { Agreed, ImproviseOutcome, ImproviseRoll } from "@/lib/improvise";
import { AddOutcome, type TriggerThings } from "../../(app)/campaign/locations/[id]/TriggersEditor";
import { gmAgreeImprovisation, gmDropImprovisation } from "./gmActions";
import { AREA_FIRES } from "@/lib/aoe";
import { DAMAGE_TYPES } from "@/lib/actions";
import { EFFECT_KINDS, EFFECT_LABELS } from "@/lib/effects";
import type { AreaSettings, Template } from "@/lib/improvise";

export type ImproviseChoices = {
  things: TriggerThings; // what map changes can work on
  scripts: string[]; // library scripts
  effects: { id: number; name: string }[]; // catalogue effects (lasting rounds)
  tokens: { id: number; name: string }[]; // who an effect can go on
};

const KINDS: [ImproviseOutcome["kind"], string][] = [["narrative", "Narrative only (you describe it)"], ["script", "Run a script"], ["map", "Change the map"], ["effect", "Put an effect on someone"], ["area", "Place an area (they place a template)"]];
const SKILLS = [...new Set(Object.values(SKILLS_BY_ATTRIBUTE).flat())].sort();
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const blank = (kind: ImproviseOutcome["kind"]): ImproviseOutcome =>
  kind === "narrative" ? { kind, text: "" } : kind === "script" ? { kind, script: "" } : kind === "map" ? { kind, outcomes: [] } : kind === "effect" ? { kind, effect: 0, on: "self" }
  : { kind: "area", template: { shape: "circle", ft: 10 }, settings: { name: "", look: "fog", damage: null, dc: 12, save: "agility", half: true, fires: ["inside"], minutes: 0, drawn: true } };

/** One outcome: what kind, then its details. */
function OutcomeEditor({ value, onChange, c }: { value: ImproviseOutcome; onChange: (o: ImproviseOutcome) => void; c: ImproviseChoices }) {
  const thingName = (kind: TriggerOutcome["kind"], id: number) => (kind in c.things ? c.things[kind as keyof TriggerThings].find((x) => x.id === id)?.name : undefined) ?? `#${id}`;
  return (
    <div className="space-y-1">
      <select className="select select-xs w-full" value={value.kind} onChange={(e) => onChange(blank(e.target.value as ImproviseOutcome["kind"]))} data-improvise-kind>
        {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {value.kind === "narrative" && <textarea className="textarea textarea-xs w-full" rows={2} placeholder="What they're told happens" value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />}
      {value.kind === "script" && (
        <>
          <textarea className="textarea textarea-xs w-full font-mono" rows={3} placeholder="game.vars.barrel = 'gone'" value={value.script} onChange={(e) => onChange({ ...value, script: e.target.value })} />
          {c.scripts.length > 0 && (
            <select className="select select-xs w-full" value="" onChange={(e) => { const n = e.target.value; if (n) onChange({ ...value, script: `${value.script.trim() ? `${value.script.trimEnd()}\n` : ""}run(${n.includes("'") ? `"${n}"` : `'${n}'`})` }); }}>
              <option value="">Library… (adds run(&apos;…&apos;))</option>
              {c.scripts.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </>
      )}
      {value.kind === "map" && (
        <>
          {value.outcomes.length > 0 && (
            <ul className="space-y-0.5">
              {value.outcomes.map((o, i) => (
                <li key={i} className="flex items-center gap-1">
                  <span className="flex-1">{describeOutcome(o, thingName)}</span>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange({ ...value, outcomes: value.outcomes.filter((_, j) => j !== i) })}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <AddOutcome things={c.things} scripts={c.scripts} onAdd={(o) => onChange({ ...value, outcomes: [...value.outcomes, o] })} />
        </>
      )}
      {value.kind === "area" && <AreaOutcome value={value} onChange={onChange} c={c} />}
      {value.kind === "effect" && (
        <div className="flex flex-wrap items-center gap-1">
          <select className="select select-xs w-auto" value={value.effect || ""} onChange={(e) => onChange({ ...value, effect: Number(e.target.value) })}>
            <option value="">which effect…</option>
            {c.effects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <span className="opacity-70">on</span>
          <select className="select select-xs w-auto" value={value.on === "self" ? "self" : String(value.target ?? "")} onChange={(e) => onChange(e.target.value === "self" ? { ...value, on: "self", target: undefined } : { ...value, on: "target", target: Number(e.target.value) })}>
            <option value="self">themselves</option>
            {c.tokens.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/** Place an area: the template's shape and size, then what the area does (as the Areas layer's settings). */
function AreaOutcome({ value, onChange, c }: { value: Extract<ImproviseOutcome, { kind: "area" }>; onChange: (o: ImproviseOutcome) => void; c: ImproviseChoices }) {
  const t = value.template, s = value.settings;
  const set = (patch: Partial<AreaSettings>) => onChange({ ...value, settings: { ...s, ...patch } });
  const fires = s.fires ?? [];
  return (
    <div className="space-y-1 rounded-box border border-base-300 p-2" data-improvise-area>
      <div className="flex flex-wrap items-center gap-1">
        <span className="opacity-70">Template</span>
        <select className="select select-xs w-auto" value={t.shape} onChange={(e) => onChange({ ...value, template: e.target.value === "rect" ? { shape: "rect", ft: t.ft, ft2: t.ft } : { shape: e.target.value as "circle" | "line", ft: t.ft } })}>
          <option value="circle">circle, radius</option><option value="rect">rectangle</option><option value="line">line from them, length</option>
        </select>
        <input type="number" min={5} step={5} className="input input-xs w-16" value={t.ft} onChange={(e) => onChange({ ...value, template: { ...t, ft: Number(e.target.value) } as Template })} />
        {t.shape === "rect" && <><span>×</span><input type="number" min={5} step={5} className="input input-xs w-16" value={t.ft2} onChange={(e) => onChange({ ...value, template: { ...t, ft2: Number(e.target.value) } })} /></>}
        <span className="opacity-70">ft</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <input className="input input-xs w-36" placeholder="Area name (Oil slick)" value={s.name} onChange={(e) => set({ name: e.target.value })} />
        <select className="select select-xs w-auto" value={s.look} onChange={(e) => set({ look: e.target.value as AreaSettings["look"] })}>{EFFECT_KINDS.map((k) => <option key={k} value={k}>{EFFECT_LABELS[k]}</option>)}</select>
        <select className="select select-xs w-auto" value={s.visibility ?? "shown"} onChange={(e) => set({ visibility: e.target.value as "shown" })}><option value="shown">players see it</option><option value="hidden">once found</option><option value="gm">never</option></select>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="opacity-70">Damage</span>
        <input className="input input-xs w-16" placeholder="1d6" value={s.damage ?? ""} onChange={(e) => set({ damage: e.target.value.trim() || null })} />
        <select className="select select-xs w-auto" value={s.damageType ?? ""} onChange={(e) => set({ damageType: e.target.value || undefined })}><option value="">untyped</option>{DAMAGE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <span className="opacity-70">save</span>
        <select className="select select-xs w-auto" value={s.save} onChange={(e) => set({ save: e.target.value as AreaSettings["save"] })}>{ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}</select>
        <span className="opacity-70">DC</span>
        <input type="number" min={1} max={40} className="input input-xs w-14" value={s.dc} onChange={(e) => set({ dc: Number(e.target.value) })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="opacity-70">Catches whoever</span>
        {AREA_FIRES.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" className="checkbox checkbox-xs" checked={fires.includes(k)} onChange={(e) => set({ fires: e.target.checked ? [...fires, k] : fires.filter((f) => f !== k) })} />{l}</label>)}
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <label className="flex items-center gap-1"><input type="checkbox" className="checkbox checkbox-xs" checked={!!s.lingers} onChange={(e) => set({ lingers: e.target.checked })} />lingers</label>
        <label className="flex items-center gap-1"><input type="checkbox" className="checkbox checkbox-xs" checked={!!s.flammable} onChange={(e) => set({ flammable: e.target.checked })} />flammable</label>
        <span className="opacity-70">lasts</span>
        <input type="number" min={0} step={0.1} className="input input-xs w-16" value={s.minutes || ""} placeholder="until removed" onChange={(e) => set({ minutes: Number(e.target.value) || 0 })} />
        <span className="opacity-70">min</span>
      </div>
      {c.effects.length > 0 && (
        <div className="flex flex-wrap gap-x-3">
          <span className="opacity-70">Puts on whoever fails:</span>
          {c.effects.map((x) => {
            const on = (s.effectIds ?? []).includes(x.id);
            return <label key={x.id} className="flex items-center gap-1"><input type="checkbox" className="checkbox checkbox-xs" checked={on} onChange={(e) => set({ effectIds: e.target.checked ? [...(s.effectIds ?? []), x.id] : (s.effectIds ?? []).filter((y) => y !== x.id) })} />{x.name}</label>;
          })}
        </div>
      )}
    </div>
  );
}

/** The GM's Improvise window: first how it plays out in the rules, then what it costs, the roll, and what failing does. */
export default function ImproviseWindow({ id, who, intent, c, onClose }: { id: number; who: string; intent: string; c: ImproviseChoices; onClose: () => void }) {
  const [name, setName] = useState(intent.length > 40 ? `${intent.slice(0, 40)}…` : intent);
  const [success, setSuccess] = useState<ImproviseOutcome>(blank("narrative"));
  const [cost, setCost] = useState<Agreed["cost"]>("action");
  const [seconds, setSeconds] = useState(2);
  const [rollType, setRollType] = useState<"" | ImproviseRoll["type"]>("");
  const [what, setWhat] = useState("athletics");
  const [dc, setDc] = useState(12);
  const [failure, setFailure] = useState<ImproviseOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const roll: ImproviseRoll | null = !rollType ? null : rollType === "check" ? { type: "check", skill: SKILLS.includes(what) ? what : "athletics", dc } : { type: rollType, attribute: (ATTRIBUTES as readonly string[]).includes(what) ? what : "agility", dc };
  const agree = () => startTransition(async () => {
    const r = await gmAgreeImprovisation(id, { name: name.trim() || "Improvisation", cost, seconds, roll, success, ...(failure ? { failure } : {}) });
    if (r.error) setError(r.error); else onClose();
  });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" data-improvise-window>
      <div className="w-[min(34rem,100%)] space-y-3 rounded-box bg-base-200 p-4 text-sm text-base-content shadow-2xl">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-semibold">💡 {who} improvises</h2>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>Close</button>
        </div>
        <p className="italic opacity-80">“{intent}”</p>
        <section className="space-y-1">
          <div className="font-semibold">How does it play out?</div>
          <OutcomeEditor value={success} onChange={setSuccess} c={c} />
        </section>
        <section className="flex flex-wrap items-center gap-2">
          <span className="opacity-70">Called</span>
          <input className="input input-xs w-48" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="opacity-70">costs</span>
          <select className="select select-xs w-auto" value={cost} onChange={(e) => setCost(e.target.value as Agreed["cost"])}><option value="action">their action</option><option value="bonus">their bonus action</option><option value="free">nothing</option></select>
          <span className="opacity-70">takes</span>
          <input type="number" min={0} max={6} step={0.5} className="input input-xs w-16" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          <span className="opacity-70">s of a round</span>
        </section>
        <section className="flex flex-wrap items-center gap-2">
          <span className="opacity-70">Roll</span>
          <select className="select select-xs w-auto" value={rollType} onChange={(e) => { const t = e.target.value as typeof rollType; setRollType(t); setWhat(t === "check" ? "athletics" : "agility"); }}>
            <option value="">none (it just happens)</option><option value="check">a skill check</option><option value="save">a save</option><option value="ability">an ability roll</option>
          </select>
          {rollType === "check" && <select className="select select-xs w-auto" value={what} onChange={(e) => setWhat(e.target.value)}>{SKILLS.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>}
          {(rollType === "save" || rollType === "ability") && <select className="select select-xs w-auto" value={what} onChange={(e) => setWhat(e.target.value)}>{ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}</select>}
          {rollType && <><span className="opacity-70">DC</span><input type="number" min={1} max={40} className="input input-xs w-16" value={dc} onChange={(e) => setDc(Number(e.target.value))} /></>}
        </section>
        {rollType && (
          <section className="space-y-1">
            <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-xs" checked={!!failure} onChange={(e) => setFailure(e.target.checked ? blank("narrative") : null)} />Something happens on a failure</label>
            {failure && <OutcomeEditor value={failure} onChange={setFailure} c={c} />}
          </section>
        )}
        {error && <p className="text-error">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={agree} data-improvise-agree>Agree</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => startTransition(async () => { await gmDropImprovisation(id); onClose(); })}>Turn it down</button>
        </div>
      </div>
    </div>
  );
}
