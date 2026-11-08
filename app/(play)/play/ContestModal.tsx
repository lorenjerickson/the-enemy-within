"use client";

import { useTransition } from "react";
import type { Contest } from "@/lib/resolveRound";
import { decideContest, rollOffContest } from "./gmActions";

/** The round stopped on a contested move: the GM says who gets the spot (or leaves it to a roll-off), and the round
 * is worked out again with that call. The map zooms to the spot meanwhile, so the card sits along the bottom. */
export default function ContestModal({ contest }: { contest: Contest }) {
  const [busy, start] = useTransition();
  const { a, b, sec } = contest;
  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none" data-contest-modal>
      <div className="pointer-events-auto card bg-base-200/95 shadow-2xl border border-warning/60 w-[min(34rem,calc(100vw-2rem))]" role="dialog" aria-label="Contested move">
        <div className="card-body p-4 gap-2">
          <h2 className="card-title text-base">Contested move — second {sec}</h2>
          <p className="text-sm">
            <b>{a.name}</b> and <b>{b.name}</b> both end up in the highlighted spot. Who gets it? The other gives way (back where they were, or pushed aside), loses a second of their plan, and the round is worked out again (same dice).
          </p>
          <div className="flex flex-wrap gap-2 justify-end">
            <button className="btn btn-sm btn-warning" disabled={busy} onClick={() => start(() => decideContest(a.id))} data-contest-pick={a.id}>{a.name} takes it</button>
            <button className="btn btn-sm btn-warning" disabled={busy} onClick={() => start(() => decideContest(b.id))} data-contest-pick={b.id}>{b.name} takes it</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => start(() => rollOffContest())} data-contest-rolloff>Roll off (d20 each)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
