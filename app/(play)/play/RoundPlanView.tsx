"use client";

import type { PlayerActionId } from "@/lib/playerActions";
import { describeArea } from "@/lib/aoe";
import { ROUND_SECONDS, stepKind, type PlanStep } from "@/lib/roundPlan";

export type TimedStep = PlanStep & { start: number; end: number };

const KIND_LABEL = { movement: "Move", action: "Action", bonus: "Bonus action", reaction: "Reaction" } as const;
const SEGMENT = {
  movement: "bg-sky-500/75 text-white",
  action: "bg-amber-500/85 text-black",
  bonus: "bg-emerald-500/80 text-black",
  reaction: "bg-violet-500/80 text-white",
} as const;

/** This round's plan: a six-second timeline with each step in order (hover one for ✕ to take it out), and Ready. */
export default function RoundPlanView({ plan, pending, label, onRemove, onReady, title = "This round", dice }: {
  plan: { steps: TimedStep[]; used: number; ready: boolean };
  pending: boolean;
  label: (id: PlayerActionId) => string;
  onRemove: (index: number) => void; // takes that step out; the ones after it move up
  onReady: () => void;
  title?: string;
  // A player's plan with dice to roll: Roll comes before Ready, and once rolled the plan is set.
  dice?: { count: number; rolled: 0 | 1 | 2; onRoll: () => void };
}) {
  const mustRoll = !!dice && dice.count > 0 && dice.rolled !== 2;
  const locked = plan.ready ? "Ready: undo that to change the plan" : dice?.rolled ? "The dice are rolled: the plan is set" : null;
  const name = (s: TimedStep) => (s.kind === "move" ? `Move ${s.feet} ft` : `${s.use?.name ?? label(s.action)}${s.swap ? ` ${s.swap.item.name}` : ""}${(s.picks?.length ?? 0) > 1 ? ` ${s.picks!.map((x) => x.name).join(", ")}` : s.target ? ` ${s.target.name}` : s.aim ? " (aimed)" : ""}`);
  return (
    <div className="space-y-2 rounded-box bg-base-100/60 p-3" data-round-plan>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{title}</span>
        <span className="ml-auto text-xs opacity-70">{+plan.used.toFixed(1)} of {ROUND_SECONDS} s</span>
      </div>
      <div className="relative h-11 overflow-hidden rounded bg-base-300" aria-label="Timeline">
        {Array.from({ length: ROUND_SECONDS - 1 }, (_, i) => (
          <div key={i} className="absolute inset-y-0 w-px bg-base-content/20" style={{ left: `${((i + 1) / ROUND_SECONDS) * 100}%` }} />
        ))}
        {plan.steps.map((s, i) => {
          const kind = stepKind(s);
          return (
            <div
              key={i}
              data-plan-segment={i}
              title={`${KIND_LABEL[kind]}: ${name(s)} · ${+s.start.toFixed(1)}–${+s.end.toFixed(1)} s`}
              className={`group absolute inset-y-1 flex flex-col justify-center overflow-hidden rounded px-1.5 leading-tight transition-[left,width] duration-300 ${SEGMENT[kind]}`}
              style={{ left: `calc(${(s.start / ROUND_SECONDS) * 100}% + 1px)`, width: `calc(${((s.end - s.start) / ROUND_SECONDS) * 100}% - 2px)` }}
            >
              <span className="truncate text-[9px] uppercase tracking-wide opacity-75">{KIND_LABEL[kind]}</span>
              <span className="truncate text-xs font-semibold">{name(s)}</span>
              {!locked && (
                <button
                  type="button"
                  data-plan-remove={i}
                  aria-label={`Remove ${name(s)}`}
                  title={`Remove ${name(s)} (the steps after it move up)`}
                  disabled={pending}
                  onClick={() => onRemove(i)}
                  className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-white hover:bg-error group-hover:flex"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      {plan.steps.length === 0 ? (
        <p className="text-xs opacity-60">Add steps in order: an action, or a move (click the map).</p>
      ) : (
        <ol className="list-inside list-decimal text-xs" data-plan-steps>
          {plan.steps.map((s, i) => (
            <li key={i}>
              {s.kind === "move" ? `Move ${s.feet} ft` : s.use?.name ?? label(s.action)}
              {s.kind === "action" && s.swap && <span className="font-semibold"> {s.swap.from ? `${s.swap.from.name} → ` : ""}{s.swap.item.name}</span>}
              {s.kind === "action" && (s.picks?.length ?? 0) > 1 ? <span className="font-semibold"> → {s.picks!.map((x) => x.name).join(", ")}</span> : s.kind === "action" && s.target && <span className="font-semibold"> → {s.target.name}</span>}
              {s.kind === "action" && s.aim && s.use?.area && <span className="opacity-70"> ({describeArea(s.use.area)}, aimed)</span>}
              <span className="opacity-60"> · {+s.start.toFixed(1)}–{+s.end.toFixed(1)} s</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        {mustRoll ? (
          <button type="button" data-plan-roll className="btn btn-xs btn-secondary ml-auto" disabled={pending || dice.rolled === 1} onClick={dice.onRoll} title="Roll the dice your plan needs; after that the plan can't change">
            {dice.rolled === 1 ? "Rolling…" : `Roll (${dice.count} ${dice.count === 1 ? "roll" : "rolls"})`}
          </button>
        ) : (
          <button type="button" data-plan-ready className={`btn btn-xs ml-auto ${plan.ready ? "btn-success" : "btn-primary"}`} disabled={pending || (plan.ready && dice?.rolled === 2)} onClick={onReady}>
            {plan.ready ? (dice?.rolled === 2 ? "Ready ✓ (dice rolled, plan set)" : "Ready ✓ (change plan)") : "Ready"}
          </button>
        )}
      </div>
    </div>
  );
}
