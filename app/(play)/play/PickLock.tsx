"use client";

import { useState, useTransition } from "react";
import { pickLock, search } from "./actions";
import { PLAYER_ACTIONS } from "@/lib/playerActions";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";

/** The player's Actions panel: the standard actions, then anything they can do right here (picking a nearby lock). */
export default function PickLock({ doors, onMap }: { doors: { id: number; name: string }[]; onMap: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <ul className="grid grid-cols-3 gap-2" data-player-actions>
        {PLAYER_ACTIONS.map((a) => (
          <li key={a.id}>
            {/* Actions switch on as they're built; the rest are shown but can't be taken yet. */}
            <button
              type="button"
              data-action={a.id}
              disabled={a.id !== "search" || !onMap || pending}
              onClick={a.id === "search" ? () => startTransition(async () => setError((await search()).error ?? null)) : undefined}
              title={a.id === "search" ? (onMap ? "Search: Investigation check (DC 14) for anything hidden within 10 ft" : "You're not on the map yet") : `${a.label}${"hint" in a ? ` (${a.hint})` : ""}: not available yet`}
              className="btn h-auto w-full flex-col gap-1 py-2 disabled:bg-base-100/60 disabled:text-base-content/80"
            >
              <GameIcon name={a.icon} className="size-7" />
              <span className="text-xs leading-tight">
                {a.label}
                {"hint" in a && <span className="block opacity-60">{a.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {doors.length > 0 && (
        <ul className="space-y-1" data-pick-lock>
          {doors.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="flex-1">{d.name} <span className="opacity-60">(locked)</span></span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => startTransition(async () => setError((await pickLock(d.id)).error ?? null))}
              >
                Pick lock
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-warning">{error}</p>}
    </div>
  );
}
