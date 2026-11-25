"use client";

import { useState } from "react";
import ImproviseWindow, { type ImproviseChoices } from "./ImproviseWindow";

/** The GM's notice: who wants to improvise, and what; Settle opens the Improvise window. */
export default function ImprovisingCard({ asks, choices }: { asks: { id: number; intent: string; who: string }[]; choices: ImproviseChoices }) {
  const [open, setOpen] = useState<number | null>(null);
  const settling = asks.find((a) => a.id === open);
  if (!asks.length) return null;
  return (
    <>
      <div data-improvising-card className="fixed right-4 top-14 z-40 w-80 space-y-2 rounded-box bg-warning/95 p-3 text-sm text-warning-content shadow-xl">
        <div className="font-semibold">💡 Improvising</div>
        {asks.map((a) => (
          <div key={a.id} className="space-y-1 rounded-box bg-base-100/30 p-2">
            <div><b>{a.who}</b>: “{a.intent}”</div>
            <button type="button" className="btn btn-xs" onClick={() => setOpen(a.id)} data-settle-improvisation={a.id}>Settle…</button>
          </div>
        ))}
        <p className="text-xs opacity-80">Talk it over; their planning clock waits meanwhile.</p>
      </div>
      {settling && <ImproviseWindow key={settling.id} id={settling.id} who={settling.who} intent={settling.intent} c={choices} onClose={() => setOpen(null)} />}
    </>
  );
}
