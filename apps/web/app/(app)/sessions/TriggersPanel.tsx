"use client";

import { useTransition } from "react";
import { removeTrigger } from "./actions";
import { formatGameTime } from "./CalendarPanel";

type Row = { id: number; text: string; fired: number | null; error: string | null };

/** ON triggers made by scripts: watching (each goes off whenever its condition becomes true) or failed. */
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
              ) : (
                <span className="badge badge-info badge-sm">watching</span>
              )}
              {t.fired !== null && <span className="opacity-60">last ran {formatGameTime(t.fired)}</span>}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={pending}
                title={t.error ? "Remove from the list" : "Stop watching"}
                onClick={() => startTransition(() => removeTrigger(t.id))}
              >
                {t.error ? "Clear" : "Cancel"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
