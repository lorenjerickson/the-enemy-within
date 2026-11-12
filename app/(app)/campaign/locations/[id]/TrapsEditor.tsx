"use client";

import { describeTrapArea, type Trap } from "@/lib/traps";
import type { TrapShape } from "./trapDraw";

const SHAPES: [TrapShape, string, string][] = [
  ["rect", "Rectangle", "drag corner to corner"],
  ["circle", "Circle", "drag from its centre"],
  ["line", "Tripwire", "drag end to end, across a corridor"],
];

/** Traps layer editor: pick a shape and drag it out on the map; list and remove. Hidden from players until found. */
export default function TrapsEditor({ shape, onShape, traps, onRemove }: { shape: TrapShape; onShape: (s: TrapShape) => void; traps: Trap[]; onRemove: (id: number) => void }) {
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
            <li key={t.id} className="flex items-center gap-2" data-trap={t.id}>
              <span className="flex-1"><span className="font-medium">{t.name}</span> <span className="opacity-60">{describeTrapArea(t.area)}{t.found ? " · found" : ""}{t.sprung.length && t.often === "once" ? " · spent" : ""}</span></span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => onRemove(t.id)}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs opacity-60">No traps on this level yet.</p>
      )}
    </div>
  );
}
