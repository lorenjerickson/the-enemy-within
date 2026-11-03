"use client";

import { useTransition } from "react";
import { removeTrigger } from "./actions";
import { formatGameTime } from "./CalendarPanel";

type Row = { id: number; text: string; fired: number | null; error: string | null };

/** ON triggers made by scripts: waiting ones (cancellable), failed ones, and the last few that ran. */
export function TriggersPanel({ triggers }: { triggers: Row[] }) {
  const [pending, startTransition] = useTransition();
  if (!triggers.length) return null;
  return (
    <div className="rounded-box bg-base-200 p-3 space-y-2 max-w-3xl">
      <h3 className="font-semibold">Triggers</h3>
      <ul className="space-y-2">
        {triggers.map((t) => (
          <li key={t.id} className="flex items-start gap-2" data-trigger={t.id}>
            <div className="min-w-0 flex-1 space-y-1">
              <pre className="overflow-x-auto rounded bg-base-100 p-2 text-xs">{t.text}</pre>
              {t.error && <p className="text-xs text-error">{t.error}</p>}
            </div>
            <div className="flex w-36 shrink-0 flex-col items-end gap-1 text-xs">
              {t.error ? (
                <span className="badge badge-error badge-sm">failed</span>
              ) : t.fired !== null ? (
                <span className="opacity-60">ran {formatGameTime(t.fired)}</span>
              ) : (
                <span className="badge badge-info badge-sm">waiting</span>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={pending}
                title={t.fired === null && !t.error ? "Cancel this trigger" : "Remove from the list"}
                onClick={() => startTransition(() => removeTrigger(t.id))}
              >
                {t.fired === null && !t.error ? "Cancel" : "Clear"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
