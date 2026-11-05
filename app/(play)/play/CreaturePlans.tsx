"use client";

import { useState, useTransition } from "react";
import { PLAYER_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ACTION_SECONDS } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import { gmPlanStep, gmSetReady, gmUndoStep } from "./gmActions";
import { setGmPlanToken, useGmPlanToken } from "./gmPlanner";
import { setMoveMode, useMoveMode } from "./moveMode";
import RoundPlanView, { type TimedStep } from "./RoundPlanView";
import TargetPicker from "./TargetPicker";

export interface CreaturePlan {
  tokenId: number;
  name: string;
  plan: { steps: TimedStep[]; used: number; ready: boolean };
}

/** The GM plans each creature's round: pick one, add actions here and moves on the map, then mark it ready. */
export default function CreaturePlans({ creatures, targets }: { creatures: CreaturePlan[]; targets: { id: number; name: string }[] }) {
  const [choosing, setChoosing] = useState(false); // picking who to attack
  const selected = useGmPlanToken();
  const moving = useMoveMode();
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
              onClick={() => {
                setMoveMode(false); // a newly picked creature starts with no move being planned
                setGmPlanToken(selected === c.tokenId ? null : c.tokenId);
              }}
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
          {choosing && (
            <TargetPicker
              targets={targets.filter((t) => t.id !== current.tokenId)}
              onCancel={() => setChoosing(false)}
              onPick={(target) => {
                setChoosing(false);
                run(() => gmPlanStep(current.tokenId, { kind: "action", action: "attack", target }));
              }}
            />
          )}
          {/* The same actions players have: Move draws its reach so a map click plans the move; Dash isn't in yet. */}
          <div className="grid grid-cols-4 gap-1">
            {PLAYER_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.id === "move" ? "Plan a move: click where to go on the map" : a.id === "dash" ? "Dash: not yet" : `${a.label} (${ACTION_SECONDS[a.id]} s)`}
                data-gm-action={a.id}
                aria-pressed={a.id === "move" ? moving : undefined}
                disabled={pending || current.plan.ready || a.id === "dash"}
                className={`btn btn-xs h-auto flex-col py-1 ${a.id === "move" && moving ? "btn-primary" : ""}`}
                onClick={() =>
                  a.id === "move" ? setMoveMode(!moving)
                  : a.id === "attack" ? setChoosing(true)
                  : run(() => gmPlanStep(current.tokenId, { kind: "action", action: a.id }))
                }
              >
                <GameIcon name={a.icon} className="size-4" />
                <span className="text-[10px] leading-tight">
                  {a.label}
                  <span className="block opacity-60">{ACTION_SECONDS[a.id] ? `${ACTION_SECONDS[a.id]} s` : "hint" in a ? a.hint : ""}</span>
                </span>
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
