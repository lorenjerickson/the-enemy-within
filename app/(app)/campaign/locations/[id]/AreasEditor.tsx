"use client";

import { ATTRIBUTES } from "@/lib/attributes";
import { DAMAGE_TYPES } from "@/lib/actions";
import { NO_SAVE_DC, UNTIL_REMOVED, type LastingArea } from "@/lib/aoe";
import { EFFECT_KINDS, EFFECT_LABELS } from "@/lib/effects";
import { rearmHazard, removeArea, saveAreaSettings, setAreaAlight, switchArea } from "../actions";
import type { Hazard } from "@/lib/hazards";
import HazardInterview from "./HazardInterview";
import type { TrapShape } from "./trapDraw";

const SHAPES: [TrapShape, string, string][] = [
  ["rect", "Rectangle", "drag corner to corner"],
  ["circle", "Circle", "drag from its centre"],
  ["line", "Line", "drag end to end (5 ft wide)"],
];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** What an area does, as a form (saved as a whole). */
function AreaSettings({ locationId, area: a, effects, now, sounds }: { locationId: number; area: LastingArea; effects: { id: number; name: string }[]; now: number; sounds: { id: number; name: string }[] }) {
  const left = a.ends >= UNTIL_REMOVED ? "" : String(Math.max(0, Math.round((a.ends - now) * 10) / 10));
  const has = new Set((a.conditions ?? []).map((c) => c.id));
  return (
    <form action={saveAreaSettings.bind(null, locationId, a.id)} className="mt-2 space-y-2 rounded-box border border-base-300 p-2" data-area-settings={a.id}>
      <div className="text-xs uppercase opacity-60">What it does (asked in the interview soon)</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">Damage</span>
        <input name="damage" defaultValue={a.damage ?? ""} placeholder="2d6" className="input input-xs w-20" />
        <select name="damage_type" defaultValue={a.damageType ?? ""} className="select select-xs w-auto"><option value="">untyped</option>{DAMAGE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <span className="opacity-70">Look</span>
        <select name="look" defaultValue={a.drawn && !a.damageType ? a.look : ""} className="select select-xs w-auto"><option value="">from the damage type</option>{EFFECT_KINDS.map((k) => <option key={k} value={k}>{EFFECT_LABELS[k]}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">Save against its damage</span>
        <select name="save" defaultValue={a.dc >= NO_SAVE_DC ? "" : a.save} className="select select-xs w-auto"><option value="">none (the damage always lands)</option>{ATTRIBUTES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>
        <span className="opacity-70">DC</span>
        <input name="dc" type="number" min={1} max={40} defaultValue={a.dc >= NO_SAVE_DC ? 12 : a.dc} className="input input-xs w-16" />
        <label className="flex items-center gap-1"><input type="checkbox" name="half" defaultChecked={a.half} className="checkbox checkbox-xs" />half on a success (else none)</label>
      </div>
      <fieldset className="space-y-1">
        <legend className="opacity-70">Puts on: with damage and a save against it, when the damage lands (full or half); otherwise each effect rolls its own save</legend>
        {effects.length ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {effects.map((e) => <label key={e.id} className="flex items-center gap-1"><input type="checkbox" name="effect" value={e.id} defaultChecked={has.has(e.id)} className="checkbox checkbox-xs" />{e.name}</label>)}
          </div>
        ) : <p className="text-xs opacity-60">No effects that last rounds in the catalog yet.</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2" data-area-visibility>
        <span className="opacity-70">Players</span>
        <select name="visibility" defaultValue={a.visibility ?? "shown"} className="select select-xs w-auto">
          <option value="shown">see it</option>
          <option value="hidden">see it once found{a.found ? " (found)" : ""}</option>
          <option value="gm">never see it (only what it does)</option>
        </select>
        <span className="opacity-70">Search DC to find</span>
        <input name="find_dc" type="number" min={1} max={40} defaultValue={a.findDc ?? 14} className="input input-xs w-16" />
        <span className="opacity-70">Sound</span>
        <select name="sound" defaultValue={a.sound ?? ""} className="select select-xs w-auto"><option value="">none</option>{sounds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-area-flammable>
        <label className="flex items-center gap-1"><input type="checkbox" name="flammable" defaultChecked={!!a.flammable} className="checkbox checkbox-xs" />flammable</label>
        <span className="text-xs opacity-60">(fire touching it, or fire damage landing in it, sets it burning for 3 rounds; then it&apos;s spent)</span>
        {a.flammable && <button type="button" className="btn btn-warning btn-xs" onClick={() => setAreaAlight(locationId, a.id)} data-set-alight={a.id}>Set alight</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-area-lingers>
        <label className="flex items-center gap-1"><input type="checkbox" name="lingers" defaultChecked={!!a.lingers} className="checkbox checkbox-xs" />lingers</label>
        <span className="opacity-70">+</span><input name="build_up" type="number" min={0} max={20} defaultValue={a.buildUp ?? 1} className="input input-xs w-14" />
        <span className="text-xs opacity-60">damage each round inside;</span>
        <span className="opacity-70">−</span><input name="decay" type="number" min={1} max={20} defaultValue={a.decay ?? 2} className="input input-xs w-14" />
        <span className="text-xs opacity-60">each round after leaving, until it&apos;s gone</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-70">Lasts</span>
        <input name="minutes" type="number" min={0} step={0.1} defaultValue={left} placeholder="until removed" className="input input-xs w-28" />
        <span className="text-xs opacity-60">minutes of game time (a round is 0.1)</span>
      </div>
      <button className="btn btn-primary btn-xs">Save hazard</button>
    </form>
  );
}

/** Hazards layer editor: drag a hazard out on the map (a pit, a burning hallway, a pocket of gas); set what it does; switch it on or off, re-arm it, remove it. */
export default function AreasEditor({ locationId, shape, onShape, areas, effects, now, sounds = [] }: { locationId: number; shape: TrapShape; onShape: (s: TrapShape) => void; areas: Hazard[]; effects: { id: number; name: string }[]; now: number; sounds?: { id: number; name: string }[] }) {
  return (
    <div className="space-y-3 text-sm" data-areas-editor>
      <div className="join" role="radiogroup" aria-label="Hazard shape">
        {SHAPES.map(([s, label, hint]) => (
          <button key={s} type="button" role="radio" aria-checked={shape === s} title={hint} className={`btn btn-xs join-item ${shape === s ? "btn-primary" : ""}`} onClick={() => onShape(s)} data-area-shape={s}>{label}</button>
        ))}
      </div>
      <p className="text-xs opacity-60">{SHAPES.find(([s]) => s === shape)![2]}. A new hazard does nothing until you save what it does.</p>
      {areas.length ? (
        <ul className="space-y-1">
          {areas.map((a) => (
            <li key={`${a.id}:${JSON.stringify(a)}`} data-area={a.id}>
              <details>
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="flex-1"><span className="font-medium">{a.name}</span> <span className="opacity-60">{a.damage ? `${a.damage} ${a.damageType ?? ""}`.trimEnd() : "no damage"}{a.ends >= UNTIL_REMOVED ? "" : " · runs out"}{a.visibility === "gm" ? " · GM only" : a.visibility === "hidden" ? (a.found ? " · found" : " · hidden") : ""}{a.sound ? " · ♪" : ""}{a.off ? " · off" : ""}{a.drawn ? "" : " · from an action"}{a.activation === "dormant" ? (a.spent ? " · spent" : ` · waits to be set off${a.sprung?.length ? `, gone off ${a.sprung.length}×` : ""}`) : ""}</span></span>
                  {a.activation === "dormant" && !a.spent && !!a.sprung?.length && <button type="button" className="btn btn-ghost btn-xs" onClick={(e) => { e.preventDefault(); rearmHazard(locationId, a.id); }} data-rearm-hazard={a.id}>Re-arm</button>}
                  <button type="button" className="btn btn-ghost btn-xs" onClick={(e) => { e.preventDefault(); switchArea(locationId, a.id, !!a.off); }} data-switch-area={a.id}>{a.off ? "Switch on" : "Switch off"}</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={(e) => { e.preventDefault(); removeArea(locationId, a.id); }} data-remove-area={a.id}>Remove</button>
                </summary>
                <HazardInterview locationId={locationId} hazard={a} isNew={(a.name === "Hazard" || a.name === "Area") && !a.damage && !a.conditions?.length} />
                <AreaSettings locationId={locationId} area={a} effects={effects} now={now} sounds={sounds} />
              </details>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs opacity-60">No areas on this level yet.</p>}
    </div>
  );
}
