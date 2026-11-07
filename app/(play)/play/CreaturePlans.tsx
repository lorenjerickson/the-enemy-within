"use client";

import { useState, useTransition } from "react";
import { ACTION_GROUPS, CHASE_ACTIONS, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ACTION_SECONDS } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import { gmPlanStep, gmSetReady, gmUndoStep } from "./gmActions";
import { useGmPlanToken } from "./gmPlanner";
import { setMoveMode, useMoveMode } from "./moveMode";
import RoundPlanView, { type TimedStep } from "./RoundPlanView";
import TargetPicker from "./TargetPicker";
import GearActions, { gearTargetMode } from "./GearActions";
import { setTargetMode, useTargetMode } from "./targetMode";

export interface CreaturePlan {
  tokenId: number;
  name: string;
  player: string | null; // a player's character the GM is planning for (absent or AFK)
  plan: { steps: TimedStep[]; used: number; ready: boolean };
  gear: { id: number; name: string; source: string; seconds: number; range: number }[]; // its own and its weapons' actions
}

/** The GM plans a round for whoever they picked in the initiative order: their creatures, or a player's character. */
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
  if (!creatures.length) return null;
  return (
    <div className="space-y-2" data-creature-plans>
      {current ? (
        <div className="space-y-2">
          <RoundPlanView
            title={`${current.name}'s round${current.player ? ` (planning for ${current.player})` : ""}`}
            plan={current.plan}
            pending={pending}
            label={label}
            onUndo={() => run(() => gmUndoStep(current.tokenId))}
            onReady={() => run(() => gmSetReady(current.tokenId, !current.plan.ready))}
          />
          {choosing && (
            <TargetPicker
              title={target?.area ? `${target.label}: click where to aim it on the map` : target?.label ? `${target.label}: click the target on the map, or pick:` : `Click who to ${label(choosing!).toLowerCase()} on the map, or pick:`}
          aiming={!!target?.area}
          duration={CHASE_ACTIONS.includes(choosing) ? { left: 6 - current.plan.used, seconds: target?.seconds, onChange: (seconds) => setTargetMode(target ? { ...target, seconds } : null) } : undefined}
              targets={targets.filter((t) => t.id !== current.tokenId)}
              onCancel={() => setChoosing(null)}
              onPick={(picked) => {
                const action = choosing, use = target?.use, seconds = target?.seconds;
                setChoosing(null);
                run(() => gmPlanStep(current.tokenId, { kind: "action", action, target: picked, ...(use !== undefined ? { use } : {}), ...(seconds ? { seconds } : {}) }));
              }}
            />
          )}
          {/* The same actions players have, grouped by kind: Move draws its reach so a map click plans the move; Dash isn't in yet. */}
          {ACTION_GROUPS.map(([kind, title]) => {
            const group = PLAYER_ACTIONS.filter((a) => a.kind === kind);
            if (!group.length && !(kind === "action" && current.gear.length)) return null;
            return (
              <section key={kind} className="space-y-1" data-action-group={kind}>
                <div className="text-xs font-semibold opacity-80">{title}</div>
              <div className="grid grid-cols-4 gap-1">
            {group.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.id === "move" ? "Plan a move: click where to go on the map" : a.id === "dash" ? "Dash: not yet" : CHASE_ACTIONS.includes(a.id) ? `${a.label} someone (until within 5 ft, or within range of what comes next)` : `${a.label} (${ACTION_SECONDS[a.id]} s)`}
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
                  <span className="block opacity-60">{ACTION_SECONDS[a.id] ? `${ACTION_SECONDS[a.id]} s` : CHASE_ACTIONS.includes(a.id) ? "follows them" : "hint" in a ? a.hint : ""}</span>
                </span>
              </button>
            ))}
          </div>
                {kind === "action" && <GearActions gear={current.gear} enabled={!current.plan.ready} onUse={(g) => setTargetMode(gearTargetMode(g, current.tokenId))} />}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="text-xs opacity-60">Click someone in the initiative order to plan their round.</p>
      )}
      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  );
}
