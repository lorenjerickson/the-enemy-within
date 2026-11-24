"use client";

import { useState, useTransition } from "react";
import { actionKind, ACTION_GROUPS, CHASE_ACTIONS, DEFERRED_ACTIONS, DEFERRED_WHY, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { unavailable, ACTION_SECONDS, type GearAction } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import { gmHidePlanOptions, gmPlanStep, gmSetReady, gmRemoveStep } from "./gmActions";
import { useGmPlanToken } from "./gmPlanner";
import { setMoveMode, useMoveMode, useRunMode } from "./moveMode";
import { setHideSpots } from "./hideMode";
import RoundPlanView, { type TimedStep } from "./RoundPlanView";
import TargetPicker from "./TargetPicker";
import GearActions, { gearTargetMode } from "./GearActions";
import { setTargetMode, useTargetMode } from "./targetMode";
import RefitPicker, { type RefitOption } from "./RefitPicker";
import ActionTip from "./ActionTip";
import { basicLines } from "./basicLines";
import { planTargeted } from "./targetPlan";
import { maxPicks, picksSeveral, type Allegiance } from "@/lib/sides";

export interface CreaturePlan {
  tokenId: number;
  name: string;
  player: string | null; // a player's character the GM is planning for (absent or AFK)
  plan: { steps: TimedStep[]; used: number; ready: boolean };
  runPerSecond?: number; // running pace (Dash); 0: can't run
  doors?: { id: number; name: string; open: boolean; locked: boolean }[]; // Interact: doors within reach of where the plan leaves them
  things?: { id: number; name: string }[]; // and levers / switches / objects
  gear: (GearAction & { source: string })[]; // its own, its gear's and its professions' actions
  refits: RefitOption[]; // what Refit could swap in (with the plan so far done)
  allegiance: Allegiance; // whose side it's on (actions aimed at friendlies or enemies)
  attackRange?: number; // squares its plain Attack reaches
  sees?: number[]; // who it could see (and so aim at) from where its plan has it
  forbidden?: Partial<Record<string, string>>; // what conditions stop it doing (by step kind), and which condition
  shakeable?: boolean; // a condition on it that it can spend its action fighting off
}

/** The GM plans a round for whoever they picked in the initiative order: their creatures, or a player's character. */
export default function CreaturePlans({ creatures, targets }: { creatures: CreaturePlan[]; targets: { id: number; name: string; allegiance?: string | null; character_id?: number | null }[] }) {
  const selected = useGmPlanToken();
  // Picking a target: on the map (click a token) or from the list. Shared with the map through a small store.
  const target = useTargetMode();
  const choosing = target && target.tokenId === (selected) ? target.action : null;
  const setChoosing = (action: PlayerActionId | null) => setTargetMode(action ? { action, tokenId: selected, visible: creatures.find((c) => c.tokenId === selected)?.sees, ...(action === "attack" ? { range: creatures.find((c) => c.tokenId === selected)?.attackRange ?? 1 } : {}) } : null);
  const moving = useMoveMode(), runMode = useRunMode();
  const [using, setUsing] = useState(false); // Use: what's in hand or on the belt
  const [interacting, setInteracting] = useState(false); // Interact: doors and levers within reach
  const walkingNow = moving && !runMode, dashingNow = moving && runMode;
  const [refitting, setRefitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Anything else in the planning panel ends Move (its waypoint clicks and overlay) first.
  const run = (f: () => Promise<{ error?: string } | void>) => { setMoveMode(false); startTransition(async () => setError((await f())?.error ?? null)); };
  // Why an action can't be planned now (greyed out with why), or null. Dash: running speed, and it takes the action.
  const blocked = (id: PlayerActionId) =>
    !current ? null
    : DEFERRED_ACTIONS.includes(id) ? DEFERRED_WHY
    : id === "dash" ? (!current.runPerSecond ? "No running speed" : unavailable(current.plan.steps, current.plan.used, "movement", 0, current.forbidden) ?? unavailable(current.plan.steps, current.plan.used, "action", 0, current.forbidden))
    : id === "shake" && !current.shakeable ? "Nothing to shake off"
    : unavailable(current.plan.steps, current.plan.used, actionKind(id), ACTION_SECONDS[id] ?? 0, current.forbidden);
  const label = (id: PlayerActionId) => PLAYER_ACTIONS.find((a) => a.id === id)?.label ?? id;
  const current = creatures.find((c) => c.tokenId === selected);
  if (!creatures.length) return null;
  return (
    <div className="space-y-2" data-creature-plans>
      {current ? (
        <div className="space-y-2">
          {/* The plan stays in view at the top while the action lists scroll beneath it. */}
          <div className="sticky top-0 z-10 -mx-3 bg-base-200 px-3 py-2 shadow-sm" data-plan-header>
            <RoundPlanView
              title={`${current.name}'s round${current.player ? ` (planning for ${current.player})` : ""}`}
              plan={current.plan}
              pending={pending}
              label={label}
              onRemove={(i) => run(() => gmRemoveStep(current.tokenId, i))}
              onReady={() => run(() => gmSetReady(current.tokenId, !current.plan.ready))}
            />
          </div>
          {choosing && (
            <TargetPicker
              title={target?.area ? `${target.label}: click where to aim it on the map` : target?.label ? `${target.label}: click the target on the map, or pick:` : `Click who to ${label(choosing!).toLowerCase()} on the map, or pick:`}
          aiming={!!target?.area && !target.aimed}
          duration={CHASE_ACTIONS.includes(choosing) ? { left: 6 - current.plan.used, seconds: target?.seconds, onChange: (seconds) => setTargetMode(target ? { ...target, seconds } : null) } : undefined}
              targets={targets.filter((t) => t.id !== current.tokenId && (!current.sees || current.sees.includes(t.id)))}
              me={target?.canSelf ? { id: current.tokenId, name: current.name } : null}
          who={target?.targeting?.who ?? ""}
          actor={current.allegiance}
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
                run(() => gmPlanStep(current.tokenId, { kind: "action", action, target: picked, ...(use !== undefined ? { use } : {}), ...(seconds ? { seconds } : {}) }));
              }}
            />
          )}
          {using && (() => {
            const items = current.gear.filter((g) => g.item && (g.item.where === "hand" || g.item.where === "belt"));
            const pick = (g: (typeof items)[number]) => { setUsing(false); if (g.targeting?.count === "all" && !g.area && !g.self) run(() => gmPlanStep(current.tokenId, { kind: "action", action: "attack", use: g.id })); else if (g.self) run(() => gmPlanStep(current.tokenId, { kind: "action", action: "use", use: g.id })); else { setMoveMode(false); setTargetMode({ ...gearTargetMode(g, current.tokenId), visible: current.sees }); } };
            return items.length
              ? <GearActions compact title="Use what? (in hand or on the belt)" gear={items} enabled={!current.plan.ready} blocked={(g) => unavailable(current.plan.steps, current.plan.used, g.kind === "reaction" ? "reaction" : "action", g.seconds, current.forbidden)} onUse={pick} />
              : <p className="text-xs opacity-70">Nothing in hand or on the belt to use. <button type="button" className="btn btn-ghost btn-xs" onClick={() => setUsing(false)}>Close</button></p>;
          })()}
          {interacting && (
            <section className="space-y-1 text-xs" data-gm-interact>
              <div className="font-semibold opacity-80">Within reach (where the plan leaves them): it happens after the round</div>
              {(current.doors?.length || current.things?.length) ? (
                <ul className="space-y-1">
                  {(current.things ?? []).map((t) => (
                    <li key={`t${t.id}`} className="flex items-center gap-2"><span className="flex-1">{t.name}</span><button type="button" className="btn btn-xs" disabled={pending} onClick={() => { setInteracting(false); run(() => gmPlanStep(current.tokenId, { kind: "action", action: "interact", thing: t.id })); }}>Use</button></li>
                  ))}
                  {(current.doors ?? []).map((d) => (
                    <li key={d.id} className="flex items-center gap-2"><span className="flex-1">{d.name} <span className="opacity-60">({d.locked ? "locked" : d.open ? "open" : "closed"})</span></span>{!d.locked && <button type="button" className="btn btn-xs" disabled={pending} onClick={() => { setInteracting(false); run(() => gmPlanStep(current.tokenId, { kind: "action", action: "interact", door: d.id })); }}>{d.open ? "Close" : "Open"}</button>}</li>
                  ))}
                </ul>
              ) : <p className="opacity-70">Nothing within reach. <button type="button" className="btn btn-ghost btn-xs" onClick={() => setInteracting(false)}>Close</button></p>}
            </section>
          )}
          {refitting && (
            <RefitPicker options={current.refits} onCancel={() => setRefitting(false)} onPick={(slot, item) => { setRefitting(false); run(() => gmPlanStep(current.tokenId, { kind: "action", action: "refit", swap: { slot, item } })); }} />
          )}
          {/* The same actions players have, grouped by kind: Move draws its reach so a map click plans the move; Dash isn't in yet. */}
          {ACTION_GROUPS.map(([kind, title]) => {
            const group = PLAYER_ACTIONS.filter((a) => a.kind === kind);
            if (!group.length && !current.gear.some((g) => (g.kind ?? "action") === kind)) return null;
            return (
              <section key={kind} className="space-y-1" data-action-group={kind}>
                <div className="text-xs font-semibold opacity-80">{title}</div>
              <div className="grid grid-cols-4 auto-rows-fr gap-1">
            {group.map((a) => (
              <ActionTip key={a.id} name={a.label} desc={a.desc} lines={basicLines(a.id)} why={blocked(a.id)}>
              <button
                type="button"
                data-gm-action={a.id}
                aria-pressed={a.id === "move" ? walkingNow : a.id === "dash" ? dashingNow : undefined}
                disabled={pending || current.plan.ready || !!blocked(a.id)}
                className={`btn btn-xs h-full min-h-12 w-full flex-col py-1 ${(a.id === "move" && walkingNow) || (a.id === "dash" && dashingNow) ? "btn-primary" : ""}`}
                onClick={() =>
                  a.id === "move" ? (setTargetMode(null), setRefitting(false), setMoveMode(!walkingNow))
                  : a.id === "dash" ? (setTargetMode(null), setRefitting(false), setMoveMode(!dashingNow, true))
                  : a.id === "hide" ? (setMoveMode(false), setTargetMode(null), startTransition(async () => {
                      const r = await gmHidePlanOptions(current.tokenId);
                      if (r.error) return setError(r.error);
                      if (!r.seen) setError((await gmPlanStep(current.tokenId, { kind: "action", action: "hide" })).error ?? null);
                      else if (r.spots?.length) { setHideSpots(r.spots, { tokenId: current.tokenId }); setError("Seen: click a blind spot on the map (green)."); }
                      else setError("Seen, and no cover within reach: they can't hide.");
                    }))
                  : a.id === "use" ? (setMoveMode(false), setTargetMode(null), setInteracting(false), setUsing(!using))
                  : a.id === "interact" ? (setMoveMode(false), setTargetMode(null), setUsing(false), setInteracting(!interacting))
                  : a.id === "refit" ? (setMoveMode(false), setRefitting(!refitting))
                  : TARGETED_ACTIONS.includes(a.id) ? (setMoveMode(false), setChoosing(a.id))
                  : run(() => gmPlanStep(current.tokenId, { kind: "action", action: a.id }))
                }
              >
                <GameIcon name={a.icon} className="size-4" />
                <span className="text-[10px] leading-tight">
                  {a.label}
                  <span className="block opacity-60">{ACTION_SECONDS[a.id] ? `${ACTION_SECONDS[a.id]} s` : CHASE_ACTIONS.includes(a.id) ? "follows them" : "hint" in a ? a.hint : ""}</span>
                </span>
              </button>
              </ActionTip>
            ))}
          </div>
                {(kind === "action" || kind === "reaction") && <GearActions compact gear={current.gear.filter((g) => (g.kind ?? "action") === kind)} enabled={!current.plan.ready} blocked={(g) => unavailable(current.plan.steps, current.plan.used, kind, g.seconds, current.forbidden)} onUse={(g) => (g.targeting?.count === "all" && !g.area && !g.self ? run(() => gmPlanStep(current.tokenId, { kind: "action", action: "attack", use: g.id })) : g.self ? run(() => gmPlanStep(current.tokenId, { kind: "action", action: "use", use: g.id })) : (setMoveMode(false), setTargetMode({ ...gearTargetMode(g, current.tokenId), visible: current.sees })))} />}
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
