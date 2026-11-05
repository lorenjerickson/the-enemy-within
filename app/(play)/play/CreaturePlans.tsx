"use client";

import { useState, useTransition } from "react";
import { PLAYER_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ACTION_SECONDS } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import { gmPlanStep, gmSetReady, gmUndoStep } from "./gmActions";
import { setGmPlanToken, useGmPlanToken } from "./gmPlanner";
import RoundPlanView, { type TimedStep } from "./RoundPlanView";

export interface CreaturePlan {
  tokenId: number;
  name: string;
  plan: { steps: TimedStep[]; used: number; ready: boolean };
}

/** The GM plans each creature's round: pick one, add actions here and moves on the map, then mark it ready. */
export default function CreaturePlans({ creatures }: { creatures: CreaturePlan[] }) {
  const selected = useGmPlanToken();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (f: () => Promise<{ error?: string } | void>) => startTransition(async () => setError((await f())?.error ?? null));
  const label = (id: PlayerActionId) => PLAYER_ACTIONS.find((a) => a.id === id)?.label ?? id;
  const current = creatures.find((c) => c.tokenId === selected);
  const allReady = creatures.length > 0 && creatures.every((c) => c.plan.ready);
  if (!creatures.length) return null;
  return (
    <div className="space-y-2" data-creature-plans>
      <div className="font-semibold">Your creatures {allReady && <span className="badge badge-success badge-sm">all ready</span>}</div>
      <ul className="flex flex-wrap gap-1">
        {creatures.map((c) => (
          <li key={c.tokenId}>
            <button
              type="button"
              data-plan-creature={c.tokenId}
              className={`btn btn-xs ${selected === c.tokenId ? "btn-primary" : c.plan.ready ? "btn-success btn-outline" : ""}`}
              onClick={() => setGmPlanToken(selected === c.tokenId ? null : c.tokenId)}
            >
              {c.name} {c.plan.ready ? "✓" : ""}
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="space-y-2">
          <RoundPlanView
            title={`${current.name}'s round`}
            plan={current.plan}
            pending={pending}
            label={label}
            onUndo={() => run(() => gmUndoStep(current.tokenId))}
            onReady={() => run(() => gmSetReady(current.tokenId, !current.plan.ready))}
          />
          <p className="text-xs opacity-60">Click the map to plan a move (the reach is drawn from where its plan leaves it).</p>
          <div className="grid grid-cols-5 gap-1">
            {PLAYER_ACTIONS.filter((a) => ACTION_SECONDS[a.id]).map((a) => (
              <button
                key={a.id}
                type="button"
                title={`${a.label} (${ACTION_SECONDS[a.id]} s)`}
                data-gm-action={a.id}
                disabled={pending || current.plan.ready}
                className="btn btn-xs h-auto flex-col py-1"
                onClick={() => run(() => gmPlanStep(current.tokenId, { kind: "action", action: a.id }))}
              >
                <GameIcon name={a.icon} className="size-4" />
                <span className="text-[10px]">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs opacity-60">Pick a creature to plan its round.</p>
      )}
      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  );
}
