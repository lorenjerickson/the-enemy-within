"use client";

import { useTransition } from "react";
import type { SaveRequest } from "@/lib/resolveRound";
import { gmRollConditionSave } from "./gmActions";

/** The round waits on a player's save against a condition landing on their character; the GM can roll it for them. */
export default function SaveWaitModal({ save, player }: { save: SaveRequest; player: string | null }) {
  const [busy, start] = useTransition();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center" data-save-wait>
      <div className="pointer-events-auto card w-[min(30rem,calc(100vw-2rem))] border border-info/60 bg-base-200/95 shadow-2xl" role="dialog" aria-label="Waiting on a save">
        <div className="card-body gap-2 p-4">
          <h2 className="card-title text-base">Waiting on a save — second {save.sec}</h2>
          <p className="text-sm">
            <b>{save.name}</b> must make a {save.attr} save (DC {save.dc}) against <b>{save.condition}</b>. Waiting on {player ?? "their player"}&apos;s roll; the round carries on once it&apos;s in.
          </p>
          <div className="flex justify-end">
            <button className="btn btn-sm" disabled={busy} onClick={() => start(() => gmRollConditionSave())} data-roll-save-for>Roll for them</button>
          </div>
        </div>
      </div>
    </div>
  );
}
