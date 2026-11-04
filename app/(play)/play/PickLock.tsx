"use client";

import { useState, useTransition } from "react";
import { pickLock, type PickLockResult } from "./actions";

/** Locked doors within reach of the player's character, each with a Pick lock button. */
export default function PickLock({ doors }: { doors: { id: number; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ door: string; r: PickLockResult } | null>(null);
  return (
    <div className="space-y-2 text-sm" data-pick-lock>
      {doors.length === 0 ? (
        <p className="opacity-60">Nothing to do here. Stand next to a locked door to try its lock.</p>
      ) : (
        <ul className="space-y-1">
          {doors.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="flex-1">{d.name} <span className="opacity-60">(locked)</span></span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => startTransition(async () => setResult({ door: d.name, r: await pickLock(d.id) }))}
              >
                Pick lock
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <p data-pick-result className={result.r.ok && result.r.success ? "text-success" : "text-warning"}>
          {!result.r.ok
            ? result.r.error
            : `${result.door}: rolled ${result.r.roll}${result.r.modifier >= 0 ? "+" : ""}${result.r.modifier} = ${result.r.roll + result.r.modifier} vs ${result.r.dc}. ${result.r.success ? "The lock clicks open." : "It won't give."}`}
        </p>
      )}
    </div>
  );
}
