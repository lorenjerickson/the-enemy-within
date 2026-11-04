"use client";

import { useState, useTransition } from "react";
import { saveNotes } from "./actions";

/** The player's notes on one journal entry, saved with the button (or Cmd/Ctrl+Enter). */
export default function NotesForm({ entryId, initial }: { entryId: number; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      await saveNotes(entryId, notes);
      setSaved(notes);
    });
  return (
    <div className="space-y-1">
      <textarea
        aria-label="Your notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && save()}
        placeholder="Your notes…"
        className="textarea textarea-sm w-full min-h-20"
      />
      <div className="flex items-center gap-2 text-xs">
        <button type="button" className="btn btn-sm" disabled={pending || notes === saved} onClick={save}>
          Save notes
        </button>
        <span className="opacity-60">{pending ? "Saving…" : notes === saved ? (saved ? "Saved" : "") : "Unsaved changes"}</span>
      </div>
    </div>
  );
}
