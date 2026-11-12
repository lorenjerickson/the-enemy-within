"use client";

import { ATTRIBUTES } from "@/lib/attributes";
import { DAMAGE_TYPES } from "@/lib/actions";
import { TRAP_OFTEN, TRAP_WHO, describeTrapArea, type Trap } from "@/lib/traps";
import { rearmTrap, saveTrapSettings } from "../actions";
import type { TrapShape } from "./trapDraw";

const SHAPES: [TrapShape, string, string][] = [
  ["rect", "Rectangle", "drag corner to corner"],
  ["circle", "Circle", "drag from its centre"],
  ["line", "Tripwire", "drag end to end, across a corridor"],
];
const WHEN: [Trap["springs"][number], string][] = [["enter", "comes into it"], ["start", "starts a round in it"], ["end", "ends a move in it"]];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** What a trap does, as a form (saved as a whole). */
function TrapSettings({ locationId, trap: t, effects }: { locationId: number; trap: Trap; effects: { id: number; name: string }[] }) {
  return (
    <form action={saveTrapSettings.bind(null, locationId, t.id)} className="mt-2 space-y-2 rounded-box border border-base-300 p-2" data-trap-settings={t.id}>
      <input name="name" defaultValue={t.name} placeholder="Name (e.g. Spike pit)" className="input input-xs w-full" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="opacity-70">Springs when someone</span>
        {WHEN.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1"><input type="checkbox" name={`springs_${k}`} defaultChecked={t.springs.includes(k)} className="checkbox checkbox-xs" />{label}</label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">On</span>
        <select name="who" defaultValue={t.who} className="select select-xs w-auto">{TRAP_WHO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="often" defaultValue={t.often} className="select select-xs w-auto">{TRAP_OFTEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">Damage</span>
        <input name="damage" defaultValue={t.damage ?? ""} placeholder="2d6" className="input input-xs w-20" />
        <select name="damage_type" defaultValue={t.damage_type} className="select select-xs w-auto"><option value="">untyped</option>{DAMAGE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">Save</span>
        <select name="save_attr" defaultValue={t.save_attr} className="select select-xs w-auto"><option value="">none (it always lands)</option>{ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}</select>
        <span className="opacity-70">DC</span>
        <input name="save_dc" type="number" min={1} max={40} defaultValue={t.save_dc} className="input input-xs w-16" />
        <label className="flex items-center gap-1"><input type="checkbox" name="save_half" defaultChecked={!!t.save_half} className="checkbox checkbox-xs" />half on a success (else none)</label>
      </div>
      <fieldset className="space-y-1">
        <legend className="opacity-70">Puts on whoever fails the save (or anyone it springs on, with no save)</legend>
        {effects.length ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {effects.map((e) => <label key={e.id} className="flex items-center gap-1"><input type="checkbox" name="effect" value={e.id} defaultChecked={t.effects.includes(e.id)} className="checkbox checkbox-xs" />{e.name}</label>)}
          </div>
        ) : <p className="text-xs opacity-60">No effects that last rounds in the catalog yet.</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1"><input type="checkbox" name="stops" defaultChecked={!!t.stops} className="checkbox checkbox-xs" />stops them where they are</label>
        <span className="opacity-70">Search DC to find</span>
        <input name="find_dc" type="number" min={1} max={40} defaultValue={t.find_dc} className="input input-xs w-16" />
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary btn-xs">Save trap</button>
        {t.sprung.length > 0 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => rearmTrap(locationId, t.id)} data-rearm>Re-arm ({t.often === "once" ? "spent" : `sprung on ${t.sprung.length}`})</button>}
      </div>
    </form>
  );
}

/** Traps layer editor: pick a shape and drag it out on the map; set what each does; remove. Hidden from players until found. */
export default function TrapsEditor({ locationId, shape, onShape, traps, effects, onRemove }: { locationId: number; shape: TrapShape; onShape: (s: TrapShape) => void; traps: Trap[]; effects: { id: number; name: string }[]; onRemove: (id: number) => void }) {
  return (
    <div className="space-y-3 text-sm" data-traps-editor>
      <div className="join" role="radiogroup" aria-label="Trap shape">
        {SHAPES.map(([s, label, hint]) => (
          <button key={s} type="button" role="radio" aria-checked={shape === s} title={hint} className={`btn btn-xs join-item ${shape === s ? "btn-primary" : ""}`} onClick={() => onShape(s)} data-trap-shape={s}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs opacity-60">{SHAPES.find(([s]) => s === shape)![2]}. Players don&apos;t see a trap until they find it (Search) or you reveal it.</p>
      {traps.length ? (
        <ul className="space-y-1">
          {traps.map((t) => (
            <li key={`${t.id}:${JSON.stringify(t)}`} data-trap={t.id}>
              <details>
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="flex-1"><span className="font-medium">{t.name}</span> <span className="opacity-60">{describeTrapArea(t.area)}{t.damage ? ` · ${t.damage} ${t.damage_type}`.trimEnd() : ""}{t.found ? " · found" : ""}{t.sprung.length && t.often === "once" ? " · spent" : ""}</span></span>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={(e) => { e.preventDefault(); onRemove(t.id); }}>Remove</button>
                </summary>
                {t.id > 0 && <TrapSettings locationId={locationId} trap={t} effects={effects} />}
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs opacity-60">No traps on this level yet.</p>
      )}
    </div>
  );
}
