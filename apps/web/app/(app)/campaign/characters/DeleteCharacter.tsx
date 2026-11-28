"use client";

import { useState, useTransition } from "react";
import { removeCharacter } from "./actions";

/** Delete with a confirmation step (no browser dialog): Delete → "Delete {name} for good?" Yes / Cancel. */
export default function DeleteCharacter({ id, name, player }: { id: number; name: string; player: string | null }) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!asking) {
    return (
      <button type="button" className="btn btn-sm btn-outline btn-error" onClick={() => setAsking(true)} data-delete-character>
        Delete character
      </button>
    );
  }
  return (
    <div role="alert" className="alert alert-error max-w-xl" data-confirm-delete>
      <span>
        Delete {name} for good?{player ? ` ${player} plays this character.` : ""} Its tokens, journal and professions go too. This can&apos;t be undone.
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setAsking(false)}>Cancel</button>
        <button type="button" className="btn btn-sm btn-error" disabled={pending} onClick={() => startTransition(() => removeCharacter(id))}>
          Yes, delete
        </button>
      </div>
    </div>
  );
}
