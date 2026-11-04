"use client";

import type { MapStructure } from "@/lib/db";
import { STRUCTURE_KINDS, STRUCTURE_LABELS, type StructureKind } from "@/lib/maps";
import NameInput from "./NameInput";

export interface StructureTool {
  kind: StructureKind;
  targetLevelId: number | null;
  /** Line ends snap to grid corners. Off for irregular maps; holding Alt while drawing does the opposite. */
  snap: boolean;
}

/** Structure layer editor: pick what to place, and list / delete what's placed. */
export default function StructureEditor({
  tool,
  onToolChange,
  portrait,
  levels,
  pieces,
  selectedId,
  onSelect,
  onDelete,
  onToggleDoor,
  onRenameDoor,
}: {
  tool: StructureTool;
  onToolChange: (tool: StructureTool) => void;
  portrait: boolean; // side-on map: offers stairs
  levels: { id: number; name: string }[]; // other levels a staircase can lead to
  pieces: MapStructure[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleDoor: (id: number, open: boolean) => void;
  onRenameDoor: (id: number, name: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="join">
          {STRUCTURE_KINDS.filter((k) => portrait || k !== "stairs").map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={tool.kind === k}
              className={`btn btn-sm join-item ${tool.kind === k ? "btn-primary" : ""}`}
              onClick={() => onToolChange({ ...tool, kind: k })}
            >
              {STRUCTURE_LABELS[k]}
            </button>
          ))}
        </div>
        {tool.kind !== "staircase" && (
          <label className="label cursor-pointer gap-2 text-sm">
            <input type="checkbox" className="toggle toggle-sm" checked={tool.snap} onChange={(e) => onToolChange({ ...tool, snap: e.target.checked })} />
            Snap to grid
          </label>
        )}
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
            ? "Add another level first — a level link leads from this level to another."
            : "Click a grid cell to place a level link (stairs to the chosen level)."
          : tool.kind === "stairs"
            ? "Drag from the top step to the bottom step of a flight. Tokens stand on it part way down."
            : tool.snap
              ? `Click and drag between grid corners to draw a ${tool.kind}.`
              : `Click and drag anywhere to draw a ${tool.kind}; ends near another piece's end join it.`}{" "}
        Hold Alt while drawing to {tool.snap ? "draw off the grid" : "snap to the grid"}, Shift to keep it straight across or up and down.{" "}
        Walls and closed doors block light.{portrait && " Horizontal walls, windows and closed doors are floors."}
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
                  <span>{STRUCTURE_LABELS[s.kind]}{s.kind === "door" && (s.open ? " (open)" : " (closed)")}</span>
                  <span className="text-xs opacity-60">
                    {s.kind === "staircase"
                      ? `cell ${s.x1}, ${s.y1} → ${s.target_name ?? "(missing level)"}`
                      : `(${+s.x1.toFixed(2)}, ${+s.y1.toFixed(2)}) – (${+s.x2.toFixed(2)}, ${+s.y2.toFixed(2)})`}
                  </span>
                </button>
                {s.kind === "door" && <NameInput label="Door name" value={s.name ?? `Door ${s.id}`} onRename={(name) => onRenameDoor(s.id, name)} />}
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
