"use client";

import { useState } from "react";
import ImproviseWindow, { type ImproviseChoices } from "./ImproviseWindow";
import { setPlaceMode } from "./placeMode";
import { gmGoAheadImprovise } from "./gmActions";
import type { Template } from "@/lib/improvise";

type AgreedRow = { id: number; who: string; name: string; state: string; template: { template: Template; from: { x: number; y: number } } | null };

/** The GM's notice: who wants to improvise, and what; Settle opens the Improvise window. */
export default function ImprovisingCard({ asks, choices, agreed = [] }: { asks: { id: number; intent: string; who: string }[]; choices: ImproviseChoices; agreed?: AgreedRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const settling = asks.find((a) => a.id === open);
  if (!asks.length && !agreed.length) return null;
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
        {agreed.map((a) => (
          <div key={a.id} className="space-y-1 rounded-box bg-base-100/20 p-2" data-agreed-improvisation={a.id}>
            <div><b>{a.who}</b>: {a.name} <span className="text-xs opacity-80">({a.state})</span></div>
            {a.template && (
              <div className="flex gap-2">
                <button type="button" className="btn btn-xs" onClick={() => setPlaceMode({ id: a.id, template: a.template!.template, from: a.template!.from, gm: true })}>Move it</button>
                <button type="button" className="btn btn-xs btn-primary" onClick={() => gmGoAheadImprovise(a.id)}>Go ahead</button>
              </div>
            )}
          </div>
        ))}
        {asks.length > 0 && <p className="text-xs opacity-80">Talk it over; their planning clock waits meanwhile.</p>}
      </div>
      {settling && <ImproviseWindow key={settling.id} id={settling.id} who={settling.who} intent={settling.intent} c={choices} onClose={() => setOpen(null)} />}
    </>
  );
}
