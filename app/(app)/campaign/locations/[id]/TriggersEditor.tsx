"use client";

import { describeTrapArea } from "@/lib/traps";
import { describeOutcome, type MapTrigger } from "@/lib/triggers";
import type { TrapShape } from "./trapDraw";

const SHAPES: [TrapShape, string, string][] = [
  ["rect", "Rectangle", "drag corner to corner"],
  ["circle", "Circle", "drag from its centre"],
  ["line", "Tripwire", "drag end to end, across a corridor"],
];

/** Triggers layer editor: pick a shape and drag it out on the map; list and remove. Players never see triggers. */
export default function TriggersEditor({ shape, onShape, triggers, onRemove }: { shape: TrapShape; onShape: (s: TrapShape) => void; triggers: MapTrigger[]; onRemove: (id: number) => void }) {
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
            <li key={t.id} className="flex items-center gap-2" data-trigger={t.id}>
              <span className="flex-1"><span className="font-medium">{t.name}</span> <span className="opacity-60">{describeTrapArea(t.area)} · {t.outcomes.length ? t.outcomes.map((o) => describeOutcome(o)).join(", ") : "does nothing yet"}</span></span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => onRemove(t.id)}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs opacity-60">No triggers on this level yet.</p>
      )}
    </div>
  );
}
