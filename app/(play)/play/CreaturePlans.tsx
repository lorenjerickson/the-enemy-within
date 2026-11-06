"use client";

import { useState, useTransition } from "react";
import { CHASE_ACTIONS, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ACTION_SECONDS } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import { gmPlanStep, gmSetReady, gmUndoStep } from "./gmActions";
import { setGmPlanToken, useGmPlanToken } from "./gmPlanner";
import { setMoveMode, useMoveMode } from "./moveMode";
import RoundPlanView, { type TimedStep } from "./RoundPlanView";
import TargetPicker from "./TargetPicker";
import GearActions from "./GearActions";
import { setTargetMode, useTargetMode } from "./targetMode";

export interface CreaturePlan {
  tokenId: number;
  name: string;
  plan: { steps: TimedStep[]; used: number; ready: boolean };
  gear: { id: number; name: string; source: string; seconds: number; range: number }[]; // its own and its weapons' actions
}

/** The GM plans each creature's round: pick one, add actions here and moves on the map, then mark it ready. */
export default function CreaturePlans({ creatures, targets }: { creatures: CreaturePlan[]; targets: { id: number; name: string }[] }) {
  const selected = useGmPlanToken();
  // Picking a target: on the map (click a token) or from the list. Shared with the map through a small store.
  const target = useTargetMode();
  const choosing = target && target.tokenId === (selected) ? target.action : null;
  const setChoosing = (action: PlayerActionId | null) => setTargetMode(action ? { action, tokenId: selected } : null);
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
              title={target?.label ? `${target.label}: click the target on the map, or pick:` : `Click who to ${label(choosing!).toLowerCase()} on the map, or pick:`}
              targets={targets.filter((t) => t.id !== current.tokenId)}
              onCancel={() => setChoosing(null)}
              onPick={(picked) => {
                const action = choosing, use = target?.use;
                setChoosing(null);
                run(() => gmPlanStep(current.tokenId, { kind: "action", action, target: picked, ...(use !== undefined ? { use } : {}) }));
              }}
            />
          )}
          <GearActions gear={current.gear} enabled={!current.plan.ready} onUse={(g) => setTargetMode({ action: "attack", tokenId: current.tokenId, use: g.id, label: g.name })} />
          {/* The same actions players have: Move draws its reach so a map click plans the move; Dash isn't in yet. */}
          <div className="grid grid-cols-4 gap-1">
            {PLAYER_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.id === "move" ? "Plan a move: click where to go on the map" : a.id === "dash" ? "Dash: not yet" : CHASE_ACTIONS.includes(a.id) ? `${a.label} someone for the rest of the round (until within 5 ft)` : `${a.label} (${ACTION_SECONDS[a.id]} s)`}
                data-gm-action={a.id}
                aria-pressed={a.id === "move" ? moving : undefined}
                disabled={pending || current.plan.ready || a.id === "dash"}
                className={`btn btn-xs h-auto flex-col py-1 ${a.id === "move" && moving ? "btn-primary" : ""}`}
                onClick={() =>
                  a.id === "move" ? setMoveMode(!moving)
                  : TARGETED_ACTIONS.includes(a.id) ? setChoosing(a.id)
                  : run(() => gmPlanStep(current.tokenId, { kind: "action", action: a.id }))
                }
              >
                <GameIcon name={a.icon} className="size-4" />
                <span className="text-[10px] leading-tight">
                  {a.label}
                  <span className="block opacity-60">{ACTION_SECONDS[a.id] ? `${ACTION_SECONDS[a.id]} s` : CHASE_ACTIONS.includes(a.id) ? "rest" : "hint" in a ? a.hint : ""}</span>
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
