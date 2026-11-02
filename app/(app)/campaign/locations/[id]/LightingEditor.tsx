"use client";

import type { LightSource } from "@/lib/db";
import { LIGHT_KINDS, type LightKind } from "@/lib/maps";

/** What a click on the map places as a light source. */
export interface LightTool {
  kind: LightKind;
  radius: number;
  angle: number;
  spread: number;
  flicker: boolean;
}

/** Lighting layer editor: global illumination (previews live, saved on release) and light source placement. */
export default function LightingEditor({
  value,
  onPreview,
  onCommit,
  tool,
  onToolChange,
  lights,
  selectedId,
  onSelect,
  onRemove,
}: {
  value: number;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
  tool: LightTool;
  onToolChange: (t: LightTool) => void;
  lights: LightSource[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const commit = (e: { currentTarget: HTMLInputElement }) => onCommit(Number(e.currentTarget.value));
  const num = (k: "radius" | "angle" | "spread") => (e: React.ChangeEvent<HTMLInputElement>) =>
    onToolChange({ ...tool, [k]: Number(e.target.value) });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm">
        Global illumination
        <span className="text-xs opacity-60">dark</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          aria-label="Global illumination"
          value={value}
          onChange={(e) => onPreview(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="range range-sm w-64"
        />
        <span className="text-xs opacity-60">bright</span>
        <span className="w-10 text-right">{Math.round(value * 100)}%</span>
      </label>

      <div className="space-y-2 border-t border-base-300 pt-3">
        <div className="text-sm font-semibold">Light sources</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="join">
            {LIGHT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={tool.kind === k}
                className={`btn btn-xs join-item ${tool.kind === k ? "btn-primary" : ""}`}
                onClick={() => onToolChange({ ...tool, kind: k })}
              >
                {k === "point" ? "Point" : "Directional"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1">
            Range (cells)
            <input type="number" min="0.5" step="0.5" aria-label="Light range" value={tool.radius} onChange={num("radius")} className="input input-xs w-16" />
          </label>
          {tool.kind === "directional" && (
            <>
              <label className="flex items-center gap-1">
                Direction°
                <input type="number" step="15" aria-label="Light direction" value={tool.angle} onChange={num("angle")} className="input input-xs w-16" />
              </label>
              <label className="flex items-center gap-1">
                Spread°
                <input type="number" min="5" max="360" step="5" aria-label="Light spread" value={tool.spread} onChange={num("spread")} className="input input-xs w-16" />
              </label>
            </>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" aria-label="Flicker" checked={tool.flicker} onChange={(e) => onToolChange({ ...tool, flicker: e.target.checked })} className="checkbox checkbox-xs" />
            Flicker
          </label>
        </div>
        <p className="text-xs opacity-60">
          Click the map to place a light. {tool.kind === "directional" && "Direction: 0° = right, 90° = down."}
        </p>
        {lights.length > 0 && (
          <ul className="rounded-box bg-base-100 text-sm">
            {lights.map((l) => (
              <li key={l.id} className={`flex items-center gap-2 px-2 py-1 ${l.id === selectedId ? "bg-primary/20" : ""}`}>
                <button type="button" data-light={l.id} onClick={() => onSelect(l.id)} className="flex-1 text-left">
                  💡 {l.kind === "point" ? "Point" : "Directional"}{" "}
                  <span className="text-xs opacity-60">
                    at {Math.floor(l.x)}, {Math.floor(l.y)} · range {l.radius}
                    {l.kind === "directional" && ` · ${l.angle}° / ${l.spread}°`}
                    {l.flicker ? " · flickers" : ""}
                  </span>
                </button>
                <button type="button" title="Remove this light" className="btn btn-ghost btn-xs text-error" onClick={() => onRemove(l.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
