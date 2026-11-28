"use client";

import { useState } from "react";
import Link from "next/link";
import type { Effect } from "@/lib/conditions";
import { effectText } from "@/lib/effectGrammar";
import TuneEffect from "./TuneEffect";

/**
 * Picking an item's (while equipped) or a creature's (always) effects, each its own copy tuned in place (backlog W):
 * "+1 defense" on this ring can be +2 without touching the catalog's. Posts the ids and the tuned copies.
 */
export default function StandingEffectsForm({ action, effects, uses, kind }: { action: (f: FormData) => void; effects: Effect[]; uses: { id: number; copy?: Effect }[]; kind: "item" | "creature" }) {
  const [on, setOn] = useState<number[]>(uses.map((u) => u.id));
  const [copies, setCopies] = useState<Record<number, Effect>>(Object.fromEntries(uses.filter((u) => u.copy).map((u) => [u.id, u.copy!])));
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="copies" value={JSON.stringify(Object.fromEntries(on.filter((id) => copies[id]).map((id) => [id, copies[id]])))} />
      {effects.length ? (
        effects.map((e) => {
          const ticked = on.includes(e.id), copy = copies[e.id] ?? e;
          return (
            <div key={e.id} className="text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" name="effect" value={e.id} checked={ticked} onChange={(ev) => setOn((xs) => (ev.target.checked ? [...xs, e.id] : xs.filter((x) => x !== e.id)))} className="checkbox checkbox-sm mt-0.5" />
                <span><span className="font-medium">{copy.name}</span> <span className="opacity-60">{effectText(copy) || copy.description}</span></span>
              </label>
              {ticked && (
                <details className="ml-7">
                  <summary className="cursor-pointer text-xs">Tune it for this {kind}</summary>
                  <TuneEffect copy={copy} catalog={e} onChange={(c) => setCopies((x) => ({ ...x, [e.id]: c }))} />
                </details>
              )}
            </div>
          );
        })
      ) : (
        <p className="text-sm opacity-60">No effects that last {kind === "item" ? "while equipped" : "always"} yet.</p>
      )}
      <div className="flex items-center gap-3">
        {effects.length > 0 && <button className="btn btn-primary btn-xs">Save effects</button>}
        <Link href="/campaign/effects/new" className="link link-hover text-xs">+ New effect</Link>
      </div>
    </form>
  );
}
