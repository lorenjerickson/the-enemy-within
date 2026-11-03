"use client";

import { useState } from "react";
import type { MapEffect } from "@/lib/db";
import { EFFECT_KINDS, EFFECT_LABELS, type EffectKind } from "@/lib/effects";

const round = (n: number) => Math.round(n * 10) / 10;

/** What the next effect will be: its kind, strength, and whether it covers the whole map or a placed circle. */
export interface EffectTool {
  kind: EffectKind;
  intensity: number;
  wholeMap: boolean;
}

/** Effects layer editor: add built-in animated effects (whole map, or drag out an area), adjust strength, remove. */
export default function EffectsEditor({
  tool,
  onToolChange,
  effects,
  onAddToMap,
  onIntensity,
  onRemove,
}: {
  tool: EffectTool;
  onToolChange: (t: EffectTool) => void;
  effects: MapEffect[];
  onAddToMap: () => void;
  onIntensity: (id: number, intensity: number) => void;
  onRemove: (id: number) => void;
}) {
  // Intensities being dragged, saved on release.
  const [dragging, setDragging] = useState<Record<number, number>>({});
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {EFFECT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={tool.kind === k}
              className={`btn btn-xs ${tool.kind === k ? "btn-primary" : ""}`}
              onClick={() => onToolChange({ ...tool, kind: k })}
            >
              {EFFECT_LABELS[k]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Intensity
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            aria-label="New effect intensity"
            value={tool.intensity}
            onChange={(e) => onToolChange({ ...tool, intensity: Number(e.target.value) })}
            className="range range-xs flex-1"
          />
          <span className="w-10 text-right text-xs">{Math.round(tool.intensity * 100)}%</span>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="join">
            <button type="button" className={`btn btn-xs join-item ${tool.wholeMap ? "btn-primary" : ""}`} onClick={() => onToolChange({ ...tool, wholeMap: true })}>
              Whole map
            </button>
            <button type="button" className={`btn btn-xs join-item ${!tool.wholeMap ? "btn-primary" : ""}`} onClick={() => onToolChange({ ...tool, wholeMap: false })}>
              Placed area
            </button>
          </div>
          {tool.wholeMap ? (
            <button type="button" className="btn btn-sm" onClick={onAddToMap}>Add {EFFECT_LABELS[tool.kind].toLowerCase()} to the map</button>
          ) : (
            <span className="text-xs opacity-70">Drag on the map to mark its area.</span>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-sm font-semibold">Effects (drawn in this order, last on top)</div>
        {effects.length === 0 ? (
          <p className="text-xs opacity-60">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {effects.map((e) => (
              <li key={e.id} data-effect={e.kind} className="space-y-1 rounded bg-base-100 px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate">
                    {EFFECT_LABELS[e.kind]}{" "}
                    <span className="text-xs opacity-60">{e.x === null ? "whole map" : `at ${Math.floor(e.x)}, ${Math.floor(e.y!)} · ${round(e.w!)} × ${round(e.h!)} cells`}</span>
                  </span>
                  <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => onRemove(e.id)}>Remove</button>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  intensity
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    aria-label={`${e.kind} intensity`}
                    value={dragging[e.id] ?? e.intensity}
                    onChange={(ev) => setDragging({ ...dragging, [e.id]: Number(ev.target.value) })}
                    onPointerUp={(ev) => onIntensity(e.id, Number(ev.currentTarget.value))}
                    onKeyUp={(ev) => onIntensity(e.id, Number(ev.currentTarget.value))}
                    className="range range-xs flex-1"
                  />
                  <span className="w-10 text-right">{Math.round((dragging[e.id] ?? e.intensity) * 100)}%</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
