"use client";

import { useState, useTransition } from "react";
import { pickLock, planStep, search, setPlanReady, rollPlan, undoStep } from "./actions";
import { setMoveMode, useMoveMode } from "./moveMode";
import { ACTION_GROUPS, CHASE_ACTIONS, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ACTION_SECONDS } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import RoundPlanView from "./RoundPlanView";
import TargetPicker from "./TargetPicker";
import { planTargeted } from "./targetPlan";
import { maxPicks, picksSeveral, type Allegiance } from "@/lib/sides";
import GearActions, { gearTargetMode } from "./GearActions";
import { setTargetMode, useTargetMode } from "./targetMode";

import type { TimedStep } from "./RoundPlanView";
import RefitPicker, { type RefitOption } from "./RefitPicker";

/**
 * The player's Actions panel. Out of an encounter, actions happen straight away (Move is free, Search rolls).
 * In an encounter, it builds this round's plan instead: actions and moves (click the map) are added in order
 * onto a six-second timeline, then the player marks themselves ready.
 */
export default function PickLock({
  doors, onMap, moveLeft, freeMovement, plan, targets = [], gear = [], down = false, refits = [], dice, self = null,
}: {
  doors: { id: number; name: string }[];
  onMap: boolean;
  moveLeft: number;
  freeMovement: boolean;
  plan: { steps: TimedStep[]; used: number; ready: boolean } | null; // set while an encounter runs
  targets?: { id: number; name: string; allegiance?: string | null; character_id?: number | null }[]; // who they can see, to aim at
  gear?: { id: number; name: string; source: string; seconds: number; range: number }[]; // actions from their equipped weapons
  refits?: RefitOption[]; // what Refit could swap in (with the plan so far done)
  dice?: { count: number; rolled: 0 | 1 | 2 }; // the rolls the plan needs, and whether they're rolled
  self?: { id: number; name: string; allegiance?: Allegiance } | null; // their own token (actions on themselves; whose side they're on)
  down?: boolean; // their character is down (0 health): nothing to do until revived
}) {
  // Picking a target: on the map (click a token) or from the list. Shared with the map through a small store.
  const target = useTargetMode();
  const choosing = target && target.tokenId === (null) ? target.action : null;
  const setChoosing = (action: PlayerActionId | null) => setTargetMode(action ? { action, tokenId: null } : null);
  const moving = useMoveMode();
  const [refitting, setRefitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (f: () => Promise<{ error?: string } | void>) => startTransition(async () => setError((await f())?.error ?? null));
  const label = (id: PlayerActionId) => PLAYER_ACTIONS.find((a) => a.id === id)?.label ?? id;

  // What each button does now: plan it (encounter), do it (out of one), or nothing yet.
  const usable = (id: PlayerActionId) => onMap && (plan ? id !== "dash" && !plan.ready && !dice?.rolled : id === "move" || id === "search"); // Evade / Pursue: encounters only
  const press = (id: PlayerActionId) => {
    if (id === "move") return setMoveMode(!moving);
    if (id === "refit") return setRefitting(!refitting);
    if (plan && TARGETED_ACTIONS.includes(id)) return setChoosing(id);
    if (plan) return run(() => planStep({ kind: "action", action: id }));
    if (id === "search") return run(search);
  };
  const hint = (id: PlayerActionId, base: string) =>
    !onMap ? "You're not on the map yet"
    : plan ? (id === "refit" ? "Refit: swap something you carry into an equipment slot (2 s, bonus action)" : id === "move" ? "Plan a move: click where to go on the map" : id === "dash" ? "Dash: not yet" : CHASE_ACTIONS.includes(id) ? `${label(id)} someone for a few seconds or the rest of the round (until within 5 ft, or within range of what comes next)` : `Plan ${label(id)} (${ACTION_SECONDS[id] ?? 1} s)`)
    : id === "search" ? "Search: Investigation check (DC 14) for anything hidden within 10 ft"
    : id === "move" ? (freeMovement ? "Move: click anywhere you've seen to walk there" : `Move (${moveLeft} ft left)`)
    : `${base}: not available yet`;

  if (down) {
    return (
      <div role="alert" className="alert alert-error text-sm" data-down>
        You&apos;re down. You can&apos;t act until you&apos;re revived.
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {plan && choosing && (
        <TargetPicker
          title={target?.area ? `${target.label}: click where to aim it on the map` : target?.label ? `${target.label}: click the target on the map, or pick:` : `Click who to ${label(choosing!).toLowerCase()} on the map, or pick:`}
          aiming={!!target?.area && !target.aimed}
          duration={CHASE_ACTIONS.includes(choosing) ? { left: 6 - plan.used, seconds: target?.seconds, onChange: (seconds) => setTargetMode(target ? { ...target, seconds } : null) } : undefined}
          targets={targets}
          me={target?.canSelf && self ? self : null}
          who={target?.targeting?.who ?? ""}
          actor={self?.allegiance}
          only={target?.pickFrom}
          several={target && (picksSeveral(target.targeting) && !target.area || target.aimed) ? {
            max: maxPicks(target.targeting),
            exact: target.targeting?.count === "exactly" && !target.aimed,
            picks: target.picks ?? [],
            onToggle: (id) => setTargetMode({ ...target, picks: (target.picks ?? []).includes(id) ? (target.picks ?? []).filter((x) => x !== id) : [...(target.picks ?? []), id] }),
            onDone: () => { const m = target; setTargetMode(null); run(() => planTargeted(m, { picks: m.picks, ...(m.aimed ? { aim: m.aimed } : {}) })); },
          } : undefined}
          onCancel={() => setChoosing(null)}
          onPick={(picked) => {
            const action = choosing, use = target?.use, seconds = target?.seconds;
            setChoosing(null);
            run(() => planStep({ kind: "action", action, target: picked, ...(use !== undefined ? { use } : {}), ...(seconds ? { seconds } : {}) }));
          }}
        />
      )}
      {plan && refitting && (
        <RefitPicker options={refits} onCancel={() => setRefitting(false)} onPick={(slot, item) => { setRefitting(false); run(() => planStep({ kind: "action", action: "refit", swap: { slot, item } })); }} />
      )}
      {plan && <RoundPlanView plan={plan} pending={pending} label={label} onUndo={() => run(undoStep)} onReady={() => run(() => setPlanReady(!plan.ready))} dice={dice && { ...dice, onRoll: () => run(() => rollPlan(true)) }} />}
      {/* Grouped by kind: movement, actions (with their gear's), bonus actions (none yet), reactions. */}
      {ACTION_GROUPS.map(([kind, title]) => {
        const group = PLAYER_ACTIONS.filter((a) => a.kind === kind);
        if (!group.length && !(kind === "action" && gear.length)) return null;
        return (
          <section key={kind} className="space-y-1" data-action-group={kind}>
            <div className="text-xs font-semibold opacity-80">{title}</div>
            <ul className="grid grid-cols-3 gap-2" data-player-actions>
        {group.map((a) => (
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
                    : plan && CHASE_ACTIONS.includes(a.id) ? "follows them"
                    : "hint" in a ? a.hint : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
            {kind === "action" && <GearActions gear={gear} enabled={!!plan && !plan.ready && onMap && !dice?.rolled} onUse={(g) => (g.targeting?.count === "all" && !g.area && !g.self ? run(() => planStep({ kind: "action", action: "attack", use: g.id })) : g.self ? run(() => planStep({ kind: "action", action: "use", use: g.id })) : setTargetMode(gearTargetMode(g, null)))} />}
          </section>
        );
      })}
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

