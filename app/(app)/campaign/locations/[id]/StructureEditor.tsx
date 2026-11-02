"use client";

import type { MapStructure } from "@/lib/db";
import { STRUCTURE_KINDS, type StructureKind } from "@/lib/maps";

export interface StructureTool {
  kind: StructureKind;
  targetLevelId: number | null;
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Structure layer editor: pick what to place, and list / delete what's placed. */
export default function StructureEditor({
  tool,
  onToolChange,
  levels,
  pieces,
  selectedId,
  onSelect,
  onDelete,
  onToggleDoor,
}: {
  tool: StructureTool;
  onToolChange: (tool: StructureTool) => void;
  levels: { id: number; name: string }[]; // other levels a staircase can lead to
  pieces: MapStructure[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleDoor: (id: number, open: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="join">
          {STRUCTURE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={tool.kind === k}
              className={`btn btn-sm join-item ${tool.kind === k ? "btn-primary" : ""}`}
              onClick={() => onToolChange({ ...tool, kind: k })}
            >
              {capitalize(k)}
            </button>
          ))}
        </div>
        {tool.kind === "staircase" && (
          <select
            aria-label="Leads to"
            value={tool.targetLevelId ?? ""}
            onChange={(e) => onToolChange({ ...tool, targetLevelId: Number(e.target.value) || null })}
            className="select select-sm w-44"
          >
            <option value="">Leads to level…</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs opacity-60">
        {tool.kind === "staircase"
          ? levels.length === 0
            ? "Add another level first — a staircase leads from this level to another."
            : "Click a grid cell to place a staircase to the chosen level."
          : `Click and drag between grid corners to draw a ${tool.kind}.`}{" "}
        Walls and closed doors block light.
      </p>

      <div className="space-y-1">
        <div className="text-sm font-semibold">Placed structure</div>
        {pieces.length === 0 ? (
          <p className="text-xs opacity-60">None yet.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto rounded-box bg-base-100 text-sm">
            {pieces.map((s) => (
              <li key={s.id} className={`flex items-center gap-2 px-2 py-1 ${s.id === selectedId ? "bg-primary/20" : ""}`}>
                <button type="button" data-structure={s.id} onClick={() => onSelect(s.id)} className="flex flex-1 items-center gap-2 text-left">
                  <span>{capitalize(s.kind)}{s.kind === "door" && (s.open ? " (open)" : " (closed)")}</span>
                  <span className="text-xs opacity-60">
                    {s.kind === "staircase"
                      ? `cell ${s.x1}, ${s.y1} → ${s.target_name ?? "(missing level)"}`
                      : `(${s.x1}, ${s.y1}) – (${s.x2}, ${s.y2})`}
                  </span>
                </button>
                {s.kind === "door" && (
                  <button type="button" className="btn btn-xs" onClick={() => onToggleDoor(s.id, !s.open)}>
                    {s.open ? "Close" : "Open"}
                  </button>
                )}
                {s.id === selectedId && (
                  <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => onDelete(s.id)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
