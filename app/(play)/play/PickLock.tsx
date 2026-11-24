"use client";

import { useState, useTransition } from "react";
import { hidePlanOptions, startHide, interactDoor, interactThing, pickLock, planStep, search, setPlanReady, rollPlan, removeStep, setStanding, useItemNow } from "./actions";
import { setMoveMode, useMoveMode, useRunMode } from "./moveMode";
import { setHideSpots, useHideSpots } from "./hideMode";
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
  running = 0, standing = null, things = [], doors, onMap, moveLeft, freeMovement, plan, targets = [], selected = null, history = [], forbidden = {}, shakeable = false, gear = [], down = false, refits = [], dice, self = null, lastRound = null, attackRange = 1,
}: {
  doors: { id: number; name: string; open: boolean; locked: boolean }[]; // doors within reach (Interact)
  things?: { id: number; name: string }[]; // levers, switches, objects within reach (interactable map triggers)
  running?: number; // running speed (feet a round): Dash; 0 = can't run
  standing?: { mode: "follow" | "pursue" | "evade"; name: string } | null; // out of an encounter: who they follow / pursue / evade
  onMap: boolean;
  moveLeft: number;
  freeMovement: boolean;
  plan: { steps: TimedStep[]; used: number; ready: boolean } | null; // set while an encounter runs
  targets?: { id: number; name: string; allegiance?: string | null; character_id?: number | null }[]; // who they can see, to aim at
  forbidden?: Partial<Record<string, string>>; // what conditions on them stop them doing (by step kind), and which condition
  shakeable?: boolean; // a condition on them they can spend their action fighting off (Shake off)
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
  const moving = useMoveMode(), runMode = useRunMode();
  const walkingNow = moving && !runMode, dashingNow = moving && runMode;
  const [ordering, setOrdering] = useState<"follow" | "pursue" | "evade" | null>(null); // out of an encounter: picking who to follow / pursue / evade
  const [refitting, setRefitting] = useState(false);
  const [using, setUsing] = useState(false); // Use: picking which item (in hand or on a belt) to use
  const [usingOn, setUsingOn] = useState<(typeof gear)[number] | null>(null); // out of combat: an item picked, now who on
  const [told, setTold] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const hideSpots = useHideSpots();
  const [noCover, setNoCover] = useState(false); // Hide: seen, and no blind spot within reach // Interact: what's within reach (doors) // what an item used out of combat did
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Anything else in the planning panel ends Move (its waypoint clicks and overlay) first.
  const run = (f: () => Promise<{ error?: string } | void>) => { setMoveMode(false); startTransition(async () => setError((await f())?.error ?? null)); };
  const label = (id: PlayerActionId) => PLAYER_ACTIONS.find((a) => a.id === id)?.label ?? id;
  // A gear action picked (from the gear list, or through Use): planned straight away if it needs no target, else aimed.
  const useGear = (g: (typeof gear)[number]) => { setUsing(false); return g.targeting?.count === "all" && !g.area && !g.self ? run(() => planStep({ kind: "action", action: "attack", use: g.id })) : g.self ? run(() => planStep({ kind: "action", action: "use", use: g.id })) : startTargeting({ ...gearTargetMode(g, null), visible: targets.map((t) => t.id) }); };
  // Use: items in a hand or on a belt (in a round, a pack's need a Refit first).
  const usableItems = gear.filter((g) => g.item && (!plan || g.item.where === "hand" || g.item.where === "belt")); // out of combat: anything carried
  // Out of combat it happens now: on themselves, or on someone they pick (attacks and areas need an encounter).
  const useNow = (g: (typeof gear)[number], target?: number) => {
    setUsing(false);
    setUsingOn(null);
    startTransition(async () => { const r = await useItemNow(g.id, target); setError(r.error ?? null); setTold(r.told ?? null); });
  };
  const pickNow = (g: (typeof gear)[number]) => (g.self ? useNow(g) : setUsingOn(g));

  // What each button does now: plan it (encounter), do it (out of one), or nothing yet.
  // In an encounter: one action, bonus action and reaction each, and only what fits the time left (greyed out, with why).
  const spent = (id: PlayerActionId) => (plan && id === "dash" ? (running <= 0 ? "No running speed" : unavailable(plan.steps, plan.used, "movement", 0, forbidden) ?? unavailable(plan.steps, plan.used, "action", 0, forbidden)) : plan ? (id === "shake" && !shakeable ? "Nothing to shake off (no condition on you allows it)" : unavailable(plan.steps, plan.used, actionKind(id), ACTION_SECONDS[id] ?? 0, forbidden)) : null);
  const usable = (id: PlayerActionId) => onMap && (plan ? !plan.ready && !dice?.rolled && !spent(id) : id === "move" || id === "search" || id === "use" || id === "interact" || id === "assist" || id === "hide" || CHASE_ACTIONS.includes(id)); // Follow / Pursue / Evade out of one: a standing order
  const press = (id: PlayerActionId) => {
    if (id === "move") {
      // Move takes over: whatever else was being picked is put away.
      setTargetMode(null);
      setRefitting(false);
      return setMoveMode(!walkingNow);
    }
    if (id === "dash") {
      setTargetMode(null);
      setRefitting(false);
      return setMoveMode(!dashingNow, true);
    }
    setMoveMode(false);
    if (id === "refit") return setRefitting(!refitting);
    if (plan && id === "use") { setTargetMode(null); setRefitting(false); return setUsing(!using); }
    if (plan && id === "hide") {
      setTargetMode(null);
      if (hideSpots || noCover) { setHideSpots(null); return setNoCover(false); }
      return startTransition(async () => {
        const r = await hidePlanOptions();
        if (r.error) return setError(r.error);
        if (!r.seen) setError((await planStep({ kind: "action", action: "hide" })).error ?? null);
        else if (r.spots?.length) setHideSpots(r.spots, { tokenId: null }); // pick a blind spot on the map
        else setNoCover(true);
      });
    }
    if (plan && id === "interact") { setTargetMode(null); setRefitting(false); return setInteracting(!interacting); }
    if (plan && id === "assist") return setTargetMode(target?.action === "assist" ? null : { action: "assist", tokenId: null, range: 1, targeting: { who: "friendly", count: "one", n: 1 }, visible: targets.map((t) => t.id) }); // map clicks only
    if (plan && TARGETED_ACTIONS.includes(id)) return setChoosing(id);
    if (plan) return run(() => planStep({ kind: "action", action: id }));
    if (id === "search") return run(search);
    if (id === "use") { setTold(null); setUsingOn(null); return setUsing(!using); }
    if (id === "interact") return setInteracting(!interacting);
    if (id === "hide") {
      if (hideSpots || noCover) { setHideSpots(null); return setNoCover(false); }
      return startTransition(async () => {
        const r = await startHide();
        setError(r.error ?? null);
        if (r.seen && r.spots?.length) setHideSpots(r.spots); // pick a blind spot on the map
        else if (r.seen) setNoCover(true);
        else if (!r.error) setTold("Unseen: roll Stealth to hide.");
      });
    }
    if (id === "assist") return setTargetMode(target?.action === "assist" ? null : { action: "assist", tokenId: null, now: true, range: 1, targeting: { who: "friendly", count: "one", n: 1 }, visible: targets.map((t) => t.id) });
    if (CHASE_ACTIONS.includes(id)) return setOrdering(ordering === id ? null : (id as "follow" | "pursue" | "evade"));
  };
  const hint = (id: PlayerActionId, base: string) =>
    !onMap ? "You're not on the map yet"
    : plan && spent(id) ? spent(id)!
    : plan ? (id === "refit" ? "Refit: swap something you carry into an equipment slot (2 s, bonus action)" : id === "use" ? "Use something in hand or on your belt" : id === "interact" ? "Interact: open or close a door within reach (1 s; it happens after the round)" : id === "hide" ? "Hide (2 s): unseen where your plan leaves you, hide there; seen, pick a blind spot you can reach in time (then Stealth with disadvantage)" : id === "move" ? "Plan a move: click where to go on the map" : id === "dash" ? "Dash: click where to run on the map (running speed; uses your action)" : CHASE_ACTIONS.includes(id) ? `${label(id)} someone for a few seconds or the rest of the round (until within 5 ft, or within range of what comes next)` : `Plan ${label(id)} (${ACTION_SECONDS[id] ?? 1} s)`)
    : id === "search" ? "Search: Investigation check (DC 14) for anything hidden within 10 ft"
    : id === "use" ? "Use something you carry: it happens straight away"
    : id === "interact" ? "Interact with something within reach: open or close a door, pick a lock"
    : id === "assist" ? "Assist someone on your side within 5 ft: click them on the map (advantage on their next roll)"
    : id === "hide" ? "Hide: unseen, roll Stealth; seen, pick a blind spot within reach on the map (Stealth with disadvantage)"
    : id === "follow" ? "Follow someone: whenever they move, you go after them as far as they went"
    : id === "pursue" ? "Pursue someone: whenever they move, you go after them until within 5 ft"
    : id === "evade" ? "Evade someone: whenever they move, you move away as far as they moved"
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
      {!plan && told && <p className="text-xs" data-use-told>{told}</p>}
      {hideSpots && (
        <p className="text-xs" data-hide-pick>You&apos;re seen. Click a blind spot on the map (green) to slip into it and hide; it&apos;s harder in a hurry (disadvantage). Enemies you can&apos;t see may still spot you there. <button type="button" className="btn btn-ghost btn-xs" onClick={() => setHideSpots(null)}>Cancel</button></p>
      )}
      {noCover && (
        <p className="text-xs text-warning" data-hide-none>You&apos;re seen, and there&apos;s no cover within reach: you can&apos;t hide here. <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNoCover(false)}>OK</button></p>
      )}
      {!plan && target?.now && (
        <p className="text-xs" data-assist-pick>Click who to help on the map (someone on your side, within 5 ft). <button type="button" className="btn btn-ghost btn-xs" onClick={() => setTargetMode(null)}>Cancel</button></p>
      )}
      {interacting && (
        <section className="space-y-1" data-interact>
          <div className="text-xs font-semibold opacity-80">{plan ? "Within reach (where your plan leaves you): it happens after the round" : "Within reach"}</div>
          {doors.length || things.length ? (
            <ul className="space-y-1">
              {things.map((t) => (
                <li key={`t${t.id}`} className="flex items-center gap-2" data-thing={t.id}>
                  <span className="flex-1">{t.name}</span>
                  <button type="button" className="btn btn-sm" disabled={pending || (!!plan && (plan.ready || !!spent("interact")))} onClick={() => { setInteracting(false); if (plan) run(() => planStep({ kind: "action", action: "interact", thing: t.id })); else startTransition(async () => { const r = await interactThing(t.id); setError(r.error ?? null); setTold(r.told ?? null); }); }}>Use</button>
                </li>
              ))}
              {doors.map((d) => (
                <li key={d.id} className="flex items-center gap-2" data-door={d.id}>
                  <span className="flex-1">{d.name} <span className="opacity-60">({d.locked ? "locked" : d.open ? "open" : "closed"})</span></span>
                  {d.locked
                    ? (plan ? <span className="text-xs opacity-60">pick it out of combat</span> : <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => pickLock(d.id))}>Pick lock</button>)
                    : <button type="button" className="btn btn-sm" disabled={pending || (!!plan && (plan.ready || !!spent("interact")))} onClick={() => { setInteracting(false); run(() => (plan ? planStep({ kind: "action", action: "interact", door: d.id }) : interactDoor(d.id))); }}>{d.open ? "Close" : "Open"}</button>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs opacity-70">Nothing within reach to interact with.</p>}
        </section>
      )}
      {!plan && using && !usingOn && (
        usableItems.length
          ? <GearActions title="Use what?" gear={usableItems} enabled={onMap && !pending} blocked={(g) => (g.damage || g.area ? "Only in an encounter" : null)} onUse={pickNow} />
          : <p className="text-xs opacity-70" data-use-none>You carry nothing you can use. <button type="button" className="btn btn-ghost btn-xs" onClick={() => setUsing(false)}>Close</button></p>
      )}
      {!plan && usingOn && (
        <TargetPicker title={`${usingOn.name}: on who?`} targets={targets} me={usingOn.targets !== "others" && self ? self : null} onCancel={() => setUsingOn(null)} onPick={(id) => useNow(usingOn, id)} />
      )}
      {plan && using && (
        usableItems.length
          ? <GearActions title="Use what? (in hand or on your belt)" gear={usableItems} enabled={!plan.ready && onMap && !dice?.rolled} blocked={(g) => unavailable(plan.steps, plan.used, g.kind === "reaction" ? "reaction" : "action", g.seconds, forbidden)} onUse={useGear} />
          : <p className="text-xs opacity-70" data-use-none>Nothing in hand or on your belt to use. (Refit brings something out of a pack.) <button type="button" className="btn btn-ghost btn-xs" onClick={() => setUsing(false)}>Close</button></p>
      )}
      {!plan && standing && (
        <div className="alert text-sm py-2" data-standing>
          <span>{standing.mode === "follow" ? "Following" : standing.mode === "pursue" ? "Pursuing" : "Evading"} {standing.name}</span>
          <button type="button" className="btn btn-xs" disabled={pending} onClick={() => run(() => setStanding(null))}>Stop</button>
        </div>
      )}
      {!plan && ordering && (
        <TargetPicker
          title={`${label(ordering)} who?`}
          targets={targets}
          onCancel={() => setOrdering(null)}
          onPick={(picked) => { const mode = ordering; setOrdering(null); run(() => setStanding(mode, picked)); }}
        />
      )}
      {plan && choosing === "assist" && (
        <p className="text-xs" data-assist-pick>Click who to help on the map (someone on your side; you close in first if they're out of reach). <button type="button" className="btn btn-ghost btn-xs" onClick={() => setTargetMode(null)}>Cancel</button></p>
      )}
      {plan && choosing && choosing !== "assist" && (
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
        if (!group.length && !gear.some((g) => (g.kind ?? "action") === kind)) return null;
        return (
          <section key={kind} className="space-y-1" data-action-group={kind}>
            <div className="text-xs font-semibold opacity-80">{title}</div>
            <ul className="grid grid-cols-3 auto-rows-fr gap-2" data-player-actions>
        {group.map((a) => (
          <li key={a.id} className="h-full">
          <ActionTip name={a.label} desc={a.desc} lines={basicLines(a.id)} why={!usable(a.id) ? hint(a.id, a.label) : null}>
            <button
              type="button"
              data-action={a.id}
              disabled={!usable(a.id) || pending}
              aria-pressed={a.id === "move" ? walkingNow : a.id === "dash" ? dashingNow : undefined}
              onClick={() => press(a.id)}
              className={`btn h-full min-h-20 w-full flex-col gap-1 py-2 disabled:bg-base-100/60 disabled:text-base-content/80 ${(a.id === "move" && walkingNow) || (a.id === "dash" && dashingNow) ? "btn-primary" : ""}`}
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
            {(kind === "action" || kind === "reaction") && <GearActions gear={gear.filter((g) => (g.kind ?? "action") === kind)} enabled={!!plan && !plan.ready && onMap && !dice?.rolled} blocked={(g) => (plan ? unavailable(plan.steps, plan.used, kind, g.seconds, forbidden) : null)} onUse={useGear} />}
          </section>
        );
      })}

      {error && <p className="text-warning">{error}</p>}
    </div>
  );
}

