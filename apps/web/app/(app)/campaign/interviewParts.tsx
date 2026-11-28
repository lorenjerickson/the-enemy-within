"use client";

import { useState } from "react";

/* The parts both interviews (actions, effects) ask with. */

/** A row of choices, one picked (radio cards). */
export function Choices<T extends string>({ value, options, onPick }: { value: T; options: [T, string, string?][]; onPick: (v: T) => void }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {options.map(([v, label, about]) => (
        <label key={v} className={`flex cursor-pointer gap-2 rounded-box border p-2 text-sm ${value === v ? "border-primary" : "border-base-300"}`}>
          <input type="radio" className="radio radio-sm" checked={value === v} onChange={() => onPick(v)} />
          <span><span className="font-medium">{label}</span>{about && <span className="block text-xs opacity-70">{about}</span>}</span>
        </label>
      ))}
    </div>
  );
}

/** A number box that lets you type freely (30 goes through 3): it takes the number once it's at least `min`, and
 * puts back the last good one when you leave it. */
export function NumberBox({ value, min, max, step, onChange, className }: { value: number; min: number; max?: number; step?: number; onChange: (n: number) => void; className: string }) {
  const [text, setText] = useState(String(value));
  const good = (t: string) => t.trim() !== "" && Number.isFinite(Number(t)) && Number(t) >= min && (max === undefined || Number(t) <= max);
  return (
    <input type="number" min={min} max={max} step={step} value={text} className={`${className} ${good(text) ? "" : "input-error"}`}
      onChange={(e) => { setText(e.target.value); if (good(e.target.value)) onChange(Number(e.target.value)); }}
      onBlur={() => { if (!good(text)) setText(String(value)); }} />
  );
}
