"use client";

import { useState, useTransition } from "react";
import { pickLock, planStep, search, setPlanReady, undoStep } from "./actions";
import { setMoveMode, useMoveMode } from "./moveMode";
import { CHASE_ACTIONS, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ACTION_SECONDS } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import RoundPlanView from "./RoundPlanView";
import TargetPicker from "./TargetPicker";
import { setTargetMode, useTargetMode } from "./targetMode";

import type { TimedStep } from "./RoundPlanView";

/**
 * The player's Actions panel. Out of an encounter, actions happen straight away (Move is free, Search rolls).
 * In an encounter, it builds this round's plan instead: actions and moves (click the map) are added in order
 * onto a six-second timeline, then the player marks themselves ready.
 */
export default function PickLock({
  doors, onMap, moveLeft, freeMovement, plan, targets = [],
}: {
  doors: { id: number; name: string }[];
  onMap: boolean;
  moveLeft: number;
  freeMovement: boolean;
  plan: { steps: TimedStep[]; used: number; ready: boolean } | null; // set while an encounter runs
  targets?: { id: number; name: string }[]; // who they can see, to attack
}) {
  // Picking a target: on the map (click a token) or from the list. Shared with the map through a small store.
  const target = useTargetMode();
  const choosing = target && target.tokenId === (null) ? target.action : null;
  const setChoosing = (action: PlayerActionId | null) => setTargetMode(action ? { action, tokenId: null } : null);
  const moving = useMoveMode();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (f: () => Promise<{ error?: string } | void>) => startTransition(async () => setError((await f())?.error ?? null));
  const label = (id: PlayerActionId) => PLAYER_ACTIONS.find((a) => a.id === id)?.label ?? id;

  // What each button does now: plan it (encounter), do it (out of one), or nothing yet.
  const usable = (id: PlayerActionId) => onMap && (plan ? id !== "dash" && !plan.ready : id === "move" || id === "search"); // Evade / Pursue: encounters only
  const press = (id: PlayerActionId) => {
    if (id === "move") return setMoveMode(!moving);
    if (plan && TARGETED_ACTIONS.includes(id)) return setChoosing(id);
    if (plan) return run(() => planStep({ kind: "action", action: id }));
    if (id === "search") return run(search);
  };
  const hint = (id: PlayerActionId, base: string) =>
    !onMap ? "You're not on the map yet"
    : plan ? (id === "move" ? "Plan a move: click where to go on the map" : id === "dash" ? "Dash: not yet" : CHASE_ACTIONS.includes(id) ? `${label(id)} someone for the rest of the round (until within 5 ft)` : `Plan ${label(id)} (${ACTION_SECONDS[id] ?? 1} s)`)
    : id === "search" ? "Search: Investigation check (DC 14) for anything hidden within 10 ft"
    : id === "move" ? (freeMovement ? "Move: click anywhere you've seen to walk there" : `Move (${moveLeft} ft left)`)
    : `${base}: not available yet`;

  return (
    <div className="space-y-3 text-sm">
      {plan && choosing && (
        <TargetPicker
          title={`Click who to ${label(choosing).toLowerCase()} on the map, or pick:`}
          targets={targets}
          onCancel={() => setChoosing(null)}
          onPick={(target) => {
            const action = choosing;
            setChoosing(null);
            run(() => planStep({ kind: "action", action, target }));
          }}
        />
      )}
      {plan && <RoundPlanView plan={plan} pending={pending} label={label} onUndo={() => run(undoStep)} onReady={() => run(() => setPlanReady(!plan.ready))} />}
      <ul className="grid grid-cols-3 gap-2" data-player-actions>
        {PLAYER_ACTIONS.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              data-action={a.id}
              disabled={!usable(a.id) || pending}
              aria-pressed={a.id === "move" ? moving : undefined}
              onClick={() => press(a.id)}
              title={hint(a.id, `${a.label}${"hint" in a ? ` (${a.hint})` : ""}`)}
              className={`btn h-auto w-full flex-col gap-1 py-2 disabled:bg-base-100/60 disabled:text-base-content/80 ${a.id === "move" && moving ? "btn-primary" : ""}`}
            >
              <GameIcon name={a.icon} className="size-7" />
              <span className="text-xs leading-tight">
                {a.label}
                <span className="block opacity-60">
                  {a.id === "move" && onMap && !plan ? (freeMovement ? "free" : `${moveLeft} ft left`)
                    : plan && ACTION_SECONDS[a.id] ? `${ACTION_SECONDS[a.id]} s`
                    : plan && CHASE_ACTIONS.includes(a.id) ? "rest of round"
                    : "hint" in a ? a.hint : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!plan && doors.length > 0 && (
        <ul className="space-y-1" data-pick-lock>
          {doors.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="flex-1">{d.name} <span className="opacity-60">(locked)</span></span>
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => pickLock(d.id))}>Pick lock</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-warning">{error}</p>}
    </div>
  );
}

