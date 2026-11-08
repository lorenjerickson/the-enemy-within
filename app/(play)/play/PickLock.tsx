"use client";

import { useState, useTransition } from "react";
import { pickLock, planStep, search, setPlanReady, rollPlan, removeStep } from "./actions";
import { setMoveMode, useMoveMode } from "./moveMode";
import { actionKind, ACTION_GROUPS, CHASE_ACTIONS, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { unavailable, ACTION_SECONDS, type GearAction } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import RoundPlanView from "./RoundPlanView";
import TargetPicker from "./TargetPicker";
import RoundScrubber from "./RoundScrubber";
import RoundHistory from "./RoundHistory";
import ActionTip from "./ActionTip";
import { basicLines } from "./basicLines";
import { planTargeted } from "./targetPlan";
import { allegianceOf, fits, maxPicks, picksSeveral, relation, type Allegiance } from "@/lib/sides";
import GearActions, { gearTargetMode } from "./GearActions";
import { setTargetMode, useTargetMode, type TargetMode } from "./targetMode";

import type { TimedStep } from "./RoundPlanView";
import RefitPicker, { type RefitOption } from "./RefitPicker";

/**
 * The player's Actions panel. Out of an encounter, actions happen straight away (Move is free, Search rolls).
 * In an encounter, it builds this round's plan instead: actions and moves (click the map) are added in order
 * onto a six-second timeline, then the player marks themselves ready.
 */
export default function PickLock({
  doors, onMap, moveLeft, freeMovement, plan, targets = [], selected = null, history = [], gear = [], down = false, refits = [], dice, self = null, lastRound = null, attackRange = 1,
}: {
  doors: { id: number; name: string }[];
  onMap: boolean;
  moveLeft: number;
  freeMovement: boolean;
  plan: { steps: TimedStep[]; used: number; ready: boolean } | null; // set while an encounter runs
  targets?: { id: number; name: string; allegiance?: string | null; character_id?: number | null }[]; // who they can see, to aim at
  history?: { round: number; showAt: number; lines: string[] }[]; // every round of the encounter so far, told from their side
  selected?: number | null; // their selected target (kept from last round): used for a targeted action straight away
  gear?: (GearAction & { source: string })[]; // actions from their equipped gear and professions
  refits?: RefitOption[]; // what Refit could swap in (with the plan so far done)
  dice?: { count: number; rolled: 0 | 1 | 2 }; // the rolls the plan needs, and whether they're rolled
  attackRange?: number; // squares their plain Attack reaches (main-hand weapon)
  lastRound?: { round: number; seconds: number; endsAt: number } | null; // the last round's replay, to step through once it has played
  self?: { id: number; name: string; allegiance?: Allegiance } | null; // their own token (actions on themselves; whose side they're on)
  down?: boolean; // their character is down (0 health): nothing to do until revived
}) {
  // Picking a target: on the map (click a token) or from the list. Shared with the map through a small store.
  const target = useTargetMode();
  const choosing = target && target.tokenId === (null) ? target.action : null;
  const setChoosing = (action: PlayerActionId | null) => (action ? startTargeting({ action, tokenId: null, visible: targets.map((t) => t.id), ...(action === "attack" ? { range: attackRange } : {}) }) : setTargetMode(null));
  // Their selected target, if it suits this action (one target, not an area or a chase, someone it can be used on).
  const selectedFor = (m: NonNullable<TargetMode>) => {
    const t = targets.find((x) => x.id === selected);
    if (!t || m.area || CHASE_ACTIONS.includes(m.action) || picksSeveral(m.targeting)) return null;
    if (m.targeting?.who && self?.allegiance && !fits(m.targeting.who, relation(self.allegiance, allegianceOf({ allegiance: t.allegiance, character_id: t.character_id ?? null })))) return null;
    return t.id;
  };
  // A targeted action: at their selected target straight away if it suits, otherwise pick on the map.
  const startTargeting = (m: NonNullable<TargetMode>) => {
    setMoveMode(false);
    const id = selectedFor(m);
    if (id === null) return setTargetMode(m);
    setTargetMode(null);
    run(() => planTargeted(m, { target: id }));
  };
  const moving = useMoveMode();
  const [refitting, setRefitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Anything else in the planning panel ends Move (its waypoint clicks and overlay) first.
  const run = (f: () => Promise<{ error?: string } | void>) => { setMoveMode(false); startTransition(async () => setError((await f())?.error ?? null)); };
  const label = (id: PlayerActionId) => PLAYER_ACTIONS.find((a) => a.id === id)?.label ?? id;

  // What each button does now: plan it (encounter), do it (out of one), or nothing yet.
  // In an encounter: one action, bonus action and reaction each, and only what fits the time left (greyed out, with why).
  const spent = (id: PlayerActionId) => (plan ? unavailable(plan.steps, plan.used, actionKind(id), ACTION_SECONDS[id] ?? 0) : null);
  const usable = (id: PlayerActionId) => onMap && (plan ? id !== "dash" && !plan.ready && !dice?.rolled && !spent(id) : id === "move" || id === "search"); // Evade / Pursue: encounters only
  const press = (id: PlayerActionId) => {
    if (id === "move") {
      // Move takes over: whatever else was being picked is put away.
      setTargetMode(null);
      setRefitting(false);
      return setMoveMode(!moving);
    }
    setMoveMode(false);
    if (id === "refit") return setRefitting(!refitting);
    if (plan && TARGETED_ACTIONS.includes(id)) return setChoosing(id);
    if (plan) return run(() => planStep({ kind: "action", action: id }));
    if (id === "search") return run(search);
  };
  const hint = (id: PlayerActionId, base: string) =>
    !onMap ? "You're not on the map yet"
    : plan && spent(id) ? spent(id)!
    : plan ? (id === "refit" ? "Refit: swap something you carry into an equipment slot (2 s, bonus action)" : id === "move" ? "Plan a move: click where to go on the map" : id === "dash" ? "Dash: not yet" : CHASE_ACTIONS.includes(id) ? `${label(id)} someone for a few seconds or the rest of the round (until within 5 ft, or within range of what comes next)` : `Plan ${label(id)} (${ACTION_SECONDS[id] ?? 1} s)`)
    : id === "search" ? "Search: Investigation check (DC 14) for anything hidden within 10 ft"
    : id === "move" ? (freeMovement ? "Move: click anywhere you've seen to walk there" : `Move (${moveLeft} ft left)`)
    : `${base}: not available yet`;

  // Once the last round has played back: step through it second by second (only what they could have seen).
  const scrubber = lastRound && Date.now() > lastRound.endsAt ? <RoundScrubber round={lastRound.round} seconds={lastRound.seconds} /> : null;
  if (down) {
    return (
      <div className="space-y-3">
        <div role="alert" className="alert alert-error text-sm" data-down>
          You&apos;re down. You can&apos;t act until you&apos;re revived.
        </div>
        {scrubber}
        <RoundHistory rounds={history} />
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {scrubber}
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
      {plan && (
        <p className="text-xs opacity-80" data-selected-target>
          {selected !== null ? <>Target: <b className="text-error">{targets.find((t) => t.id === selected)?.name}</b> <span className="opacity-70">(used for targeted actions; click someone else on the map to change)</span></> : <span className="opacity-70">Click someone on the map to make them your target.</span>}
        </p>
      )}
      {plan && <RoundPlanView plan={plan} pending={pending} label={label} onRemove={(i) => run(() => removeStep(i))} onReady={() => run(() => setPlanReady(!plan.ready))} dice={dice && { ...dice, onRoll: () => run(() => rollPlan(true)) }} />}
      <RoundHistory rounds={history} />
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
          <ActionTip name={a.label} desc={a.desc} lines={basicLines(a.id)} why={!usable(a.id) ? hint(a.id, a.label) : null}>
            <button
              type="button"
              data-action={a.id}
              disabled={!usable(a.id) || pending}
              aria-pressed={a.id === "move" ? moving : undefined}
              onClick={() => press(a.id)}
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
          </ActionTip>
          </li>
        ))}
      </ul>
            {kind === "action" && <GearActions gear={gear} enabled={!!plan && !plan.ready && onMap && !dice?.rolled} blocked={(g) => (plan ? unavailable(plan.steps, plan.used, "action", g.seconds) : null)} onUse={(g) => (g.targeting?.count === "all" && !g.area && !g.self ? run(() => planStep({ kind: "action", action: "attack", use: g.id })) : g.self ? run(() => planStep({ kind: "action", action: "use", use: g.id })) : startTargeting({ ...gearTargetMode(g, null), visible: targets.map((t) => t.id) }))} />}
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

