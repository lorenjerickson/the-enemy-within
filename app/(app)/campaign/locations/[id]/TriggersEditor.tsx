"use client";

import { useState } from "react";
import { TRAP_OFTEN, TRAP_WHO, describeTrapArea } from "@/lib/traps";
import { OUTCOME_KINDS, describeOutcome, type MapTrigger, type TriggerOutcome } from "@/lib/triggers";
import { rearmTrigger, saveTriggerSettings } from "../actions";
import type { TrapShape } from "./trapDraw";

const SHAPES: [TrapShape, string, string][] = [
  ["rect", "Rectangle", "drag corner to corner"],
  ["circle", "Circle", "drag from its centre"],
  ["line", "Tripwire", "drag end to end, across a corridor"],
];
const WHEN: [MapTrigger["springs"][number], string][] = [["enter", "comes into it"], ["start", "starts a round in it"], ["end", "ends a move in it"]];

/** The things on this level (and the campaign's discoveries) an outcome can name. */
export interface TriggerThings {
  door: { id: number; name: string }[];
  light: { id: number; name: string }[];
  effect: { id: number; name: string }[];
  secret: { id: number; name: string }[];
  trap: { id: number; name: string }[];
  discovery: { id: number; name: string }[];
}
type Pickable = keyof TriggerThings;
const PICKS: Pickable[] = ["door", "light", "effect", "secret", "trap", "discovery"];

/** Adding one outcome: what kind, which thing, and (doors, lights, effects) what happens to it. */
function AddOutcome({ things, onAdd }: { things: TriggerThings; onAdd: (o: TriggerOutcome) => void }) {
  const [kind, setKind] = useState<TriggerOutcome["kind"]>("door");
  const [id, setId] = useState("");
  const [to, setTo] = useState("open");
  const [on, setOn] = useState("on");
  const [script, setScript] = useState("");
  const list = (PICKS as string[]).includes(kind) ? things[kind as Pickable] : [];
  const ready = kind === "stop" || (kind === "script" ? !!script.trim() : !!id);
  const add = () => {
    const n = Number(id);
    const o: TriggerOutcome =
      kind === "door" ? { kind, door: n, to: to as "open" } : kind === "light" ? { kind, light: n, on: on === "on" } : kind === "effect" ? { kind, effect: n, on: on === "on" }
      : kind === "secret" ? { kind, secret: n } : kind === "discovery" ? { kind, discovery: n } : kind === "trap" ? { kind, trap: n } : kind === "stop" ? { kind } : { kind, script };
    onAdd(o);
    setId("");
    setScript("");
  };
  return (
    <div className="space-y-1" data-add-outcome>
      <div className="flex flex-wrap items-center gap-1">
        <select className="select select-xs w-auto" value={kind} onChange={(e) => { setKind(e.target.value as TriggerOutcome["kind"]); setId(""); }}>
          {OUTCOME_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {list.length > 0 && (
          <select className="select select-xs w-auto" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">which…</option>
            {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {(PICKS as string[]).includes(kind) && !list.length && <span className="text-xs opacity-60">none on this level yet</span>}
        {kind === "door" && <select className="select select-xs w-auto" value={to} onChange={(e) => setTo(e.target.value)}>{["open", "close", "lock", "unlock"].map((v) => <option key={v} value={v}>{v}</option>)}</select>}
        {(kind === "light" || kind === "effect") && <select className="select select-xs w-auto" value={on} onChange={(e) => setOn(e.target.value)}><option value="on">on</option><option value="off">off</option></select>}
        <button type="button" className="btn btn-xs" disabled={!ready} onClick={add}>Add</button>
      </div>
      {kind === "script" && <textarea className="textarea textarea-xs w-full font-mono" rows={3} placeholder="game.vars.alarm = true" value={script} onChange={(e) => setScript(e.target.value)} />}
    </div>
  );
}

/** What a trigger does, as a form (saved as a whole). */
function TriggerSettings({ locationId, trigger: t, things }: { locationId: number; trigger: MapTrigger; things: TriggerThings }) {
  const [outcomes, setOutcomes] = useState<TriggerOutcome[]>(t.outcomes);
  const name = (kind: TriggerOutcome["kind"], id: number) => ((PICKS as string[]).includes(kind) ? things[kind as Pickable].find((x) => x.id === id)?.name : undefined) ?? `#${id}`;
  return (
    <form action={saveTriggerSettings.bind(null, locationId, t.id)} className="mt-2 space-y-2 rounded-box border border-base-300 p-2" data-trigger-settings={t.id}>
      <input type="hidden" name="outcomes" value={JSON.stringify(outcomes)} />
      <input name="name" defaultValue={t.name} placeholder="Name (e.g. Pressure plate)" className="input input-xs w-full" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="opacity-70">Fires when someone</span>
        {WHEN.map(([k, label]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name={`springs_${k}`} defaultChecked={t.springs.includes(k)} className="checkbox checkbox-xs" />{label}</label>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">For</span>
        <select name="who" defaultValue={t.who} className="select select-xs w-auto">{TRAP_WHO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="often" defaultValue={t.often} className="select select-xs w-auto">{TRAP_OFTEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="space-y-1">
        <div className="opacity-70">What it does</div>
        {outcomes.length ? (
          <ul className="space-y-0.5">
            {outcomes.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex-1">{describeOutcome(o, name)}{o.kind === "script" ? <code className="ml-1 text-xs opacity-60">{o.script.split("\n")[0].slice(0, 40)}</code> : null}</span>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOutcomes(outcomes.filter((_, j) => j !== i))}>×</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs opacity-60">Nothing yet.</p>}
        <AddOutcome things={things} onAdd={(o) => setOutcomes([...outcomes, o])} />
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary btn-xs">Save trigger</button>
        {t.sprung.length > 0 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => rearmTrigger(locationId, t.id)} data-rearm-trigger>Re-arm ({t.often === "once" ? "spent" : `fired for ${t.sprung.length}`})</button>}
      </div>
    </form>
  );
}

/** Triggers layer editor: pick a shape and drag it out on the map; set what each does; remove. Players never see triggers. */
export default function TriggersEditor({ locationId, shape, onShape, triggers, things, onRemove }: { locationId: number; shape: TrapShape; onShape: (s: TrapShape) => void; triggers: MapTrigger[]; things: TriggerThings; onRemove: (id: number) => void }) {
  return (
    <div className="space-y-3 text-sm" data-triggers-editor>
      <div className="join" role="radiogroup" aria-label="Trigger shape">
        {SHAPES.map(([s, label, hint]) => (
          <button key={s} type="button" role="radio" aria-checked={shape === s} title={hint} className={`btn btn-xs join-item ${shape === s ? "btn-primary" : ""}`} onClick={() => onShape(s)} data-trigger-shape={s}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs opacity-60">{SHAPES.find(([s]) => s === shape)![2]}. When someone comes into it, it opens doors, switches lights, sets off traps, runs a script… Players never see triggers.</p>
      {triggers.length ? (
        <ul className="space-y-1">
          {triggers.map((t) => (
            <li key={`${t.id}:${JSON.stringify(t)}`} data-trigger={t.id}>
              <details>
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="flex-1"><span className="font-medium">{t.name}</span> <span className="opacity-60">{describeTrapArea(t.area)} · {t.outcomes.length ? `${t.outcomes.length} thing${t.outcomes.length === 1 ? "" : "s"}` : "does nothing yet"}{t.sprung.length && t.often === "once" ? " · spent" : ""}</span></span>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={(e) => { e.preventDefault(); onRemove(t.id); }}>Remove</button>
                </summary>
                {t.id > 0 && <TriggerSettings locationId={locationId} trigger={t} things={things} />}
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs opacity-60">No triggers on this level yet.</p>
      )}
    </div>
  );
}
