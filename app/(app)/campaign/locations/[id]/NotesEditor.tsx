"use client";

import type { MapNote } from "@/lib/db";

/** Notes layer editor: write a note, click the map to stick it there; edit or remove placed notes. GM only. */
export default function NotesEditor({
  draft,
  onDraftChange,
  notes,
  selectedId,
  onSelect,
  onEdit,
  onRemove,
}: {
  draft: string;
  onDraftChange: (text: string) => void;
  notes: MapNote[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onEdit: (id: number, text: string) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="space-y-3">
      <textarea
        aria-label="New note"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Write a note, then click the map to stick it there…"
        className="textarea textarea-sm w-full bg-yellow-100 text-neutral-900 placeholder:text-neutral-500"
        rows={3}
      />
      <p className="text-xs opacity-60">Notes are only ever shown to the GM. Drag a note&apos;s folded corner to resize it.</p>
      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={`${n.id}:${n.text}`} className={`flex items-start gap-2 rounded p-1 ${n.id === selectedId ? "bg-primary/20" : ""}`}>
              <button type="button" data-note={n.id} onClick={() => onSelect(n.id)} className="pt-1 text-xs opacity-60">
                {Math.floor(n.x)}, {Math.floor(n.y)}
              </button>
              <textarea
                aria-label="Note text"
                defaultValue={n.text}
                onBlur={(e) => e.target.value !== n.text && onEdit(n.id, e.target.value)}
                className="textarea textarea-xs flex-1 bg-yellow-100 text-neutral-900"
                rows={2}
              />
              <button type="button" title="Remove this note" className="btn btn-ghost btn-xs text-error" onClick={() => onRemove(n.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
