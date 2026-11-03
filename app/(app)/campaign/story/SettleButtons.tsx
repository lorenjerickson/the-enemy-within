"use client";

import { useState, useTransition } from "react";
import type { ObjectiveStatus } from "@/lib/story";
import { checkObjective, settleObjective } from "./actions";

/** The GM settles an objective: success (reward), failure (penalty), or reopens it. Shows what happened. */
export default function SettleButtons({ objectiveId, status }: { objectiveId: number; status: ObjectiveStatus }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const settle = (s: ObjectiveStatus) => startTransition(async () => setMessage(await settleObjective(objectiveId, s)));
  return (
    <div className="space-y-2 rounded-box bg-base-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold mr-2">Outcome</span>
        <button type="button" className="btn btn-sm btn-success" disabled={pending || status === "succeeded"} onClick={() => settle("succeeded")}>Succeeded</button>
        <button type="button" className="btn btn-sm btn-error" disabled={pending || status === "failed"} onClick={() => settle("failed")}>Failed</button>
        <button type="button" className="btn btn-sm" disabled={pending || status === "open"} onClick={() => settle("open")}>Reopen</button>
        <button type="button" className="btn btn-sm btn-ghost ml-auto" disabled={pending} onClick={() => startTransition(async () => setMessage(await checkObjective(objectiveId)))}>
          Check conditions
        </button>
      </div>
      <p className="text-xs opacity-60">Succeeding runs the reward script and reveals the reward discovery; failing runs the penalty script. Check conditions evaluates the success and failure checks against the game state without changing anything.</p>
      {message && <p data-settle-message className="text-sm">{message}</p>}
    </div>
  );
}
