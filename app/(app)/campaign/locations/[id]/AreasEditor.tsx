"use client";

import { UNTIL_REMOVED } from "@/lib/aoe";

import { rearmHazard, removeArea, setAreaAlight, switchArea } from "../actions";
import type { Hazard } from "@/lib/hazards";
import HazardInterview from "./HazardInterview";
import type { TrapShape } from "./trapDraw";

const SHAPES: [TrapShape, string, string][] = [
  ["rect", "Rectangle", "drag corner to corner"],
  ["circle", "Circle", "drag from its centre"],
  ["line", "Line", "drag end to end (5 ft wide)"],
];

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
                  {a.flammable && <button type="button" className="btn btn-warning btn-xs" onClick={(e) => { e.preventDefault(); setAreaAlight(locationId, a.id); }} data-set-alight={a.id}>Set alight</button>}
                  <button type="button" className="btn btn-ghost btn-xs" onClick={(e) => { e.preventDefault(); removeArea(locationId, a.id); }} data-remove-area={a.id}>Remove</button>
                </summary>
                <HazardInterview locationId={locationId} hazard={a} isNew={(a.name === "Hazard" || a.name === "Area") && !a.damage && !a.conditions?.length} effects={effects} sounds={sounds} now={now} />
              </details>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs opacity-60">No areas on this level yet.</p>}
    </div>
  );
}
