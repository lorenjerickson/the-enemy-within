"use client";

import { useState, useTransition } from "react";
import { actionKind, ACTION_GROUPS, CHASE_ACTIONS, PLAYER_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { unavailable, ACTION_SECONDS, type GearAction } from "@/lib/roundPlan";
import GameIcon from "../../(app)/campaign/locations/[id]/GameIcon";
import { gmPlanStep, gmSetReady, gmRemoveStep } from "./gmActions";
import { useGmPlanToken } from "./gmPlanner";
import { setMoveMode, useMoveMode } from "./moveMode";
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
  gear: (GearAction & { source: string })[]; // its own, its gear's and its professions' actions
  refits: RefitOption[]; // what Refit could swap in (with the plan so far done)
  allegiance: Allegiance; // whose side it's on (actions aimed at friendlies or enemies)
  attackRange?: number; // squares its plain Attack reaches
  sees?: number[]; // who it could see (and so aim at) from where its plan has it
}

/** The GM plans a round for whoever they picked in the initiative order: their creatures, or a player's character. */
export default function CreaturePlans({ creatures, targets }: { creatures: CreaturePlan[]; targets: { id: number; name: string; allegiance?: string | null; character_id?: number | null }[] }) {
  const selected = useGmPlanToken();
  // Picking a target: on the map (click a token) or from the list. Shared with the map through a small store.
  const target = useTargetMode();
  const choosing = target && target.tokenId === (selected) ? target.action : null;
  const setChoosing = (action: PlayerActionId | null) => setTargetMode(action ? { action, tokenId: selected, visible: creatures.find((c) => c.tokenId === selected)?.sees, ...(action === "attack" ? { range: creatures.find((c) => c.tokenId === selected)?.attackRange ?? 1 } : {}) } : null);
  const moving = useMoveMode();
  const [refitting, setRefitting] = useState(false);
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
            onRemove={(i) => run(() => gmRemoveStep(current.tokenId, i))}
            onReady={() => run(() => gmSetReady(current.tokenId, !current.plan.ready))}
          />
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
          {refitting && (
            <RefitPicker options={current.refits} onCancel={() => setRefitting(false)} onPick={(slot, item) => { setRefitting(false); run(() => gmPlanStep(current.tokenId, { kind: "action", action: "refit", swap: { slot, item } })); }} />
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
              <ActionTip key={a.id} name={a.label} desc={a.desc} lines={basicLines(a.id)} why={unavailable(current.plan.steps, current.plan.used, actionKind(a.id), ACTION_SECONDS[a.id] ?? 0) ?? (a.id === "dash" ? "Not in yet" : null)}>
              <button
                type="button"
                data-gm-action={a.id}
                aria-pressed={a.id === "move" ? moving : undefined}
                disabled={pending || current.plan.ready || a.id === "dash" || !!unavailable(current.plan.steps, current.plan.used, actionKind(a.id), ACTION_SECONDS[a.id] ?? 0)}
                className={`btn btn-xs h-auto flex-col py-1 ${a.id === "move" && moving ? "btn-primary" : ""}`}
                onClick={() =>
                  a.id === "move" ? setMoveMode(!moving)
                  : a.id === "refit" ? setRefitting(!refitting)
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
              </ActionTip>
            ))}
          </div>
                {kind === "action" && <GearActions gear={current.gear} enabled={!current.plan.ready} blocked={(g) => unavailable(current.plan.steps, current.plan.used, "action", g.seconds)} onUse={(g) => (g.targeting?.count === "all" && !g.area && !g.self ? run(() => gmPlanStep(current.tokenId, { kind: "action", action: "attack", use: g.id })) : g.self ? run(() => gmPlanStep(current.tokenId, { kind: "action", action: "use", use: g.id })) : setTargetMode({ ...gearTargetMode(g, current.tokenId), visible: current.sees }))} />}
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
