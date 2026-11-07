"use client";

import type { PlayerActionId } from "@/lib/playerActions";
import { describeArea } from "@/lib/aoe";
import { ROUND_SECONDS, type PlanStep } from "@/lib/roundPlan";

export type TimedStep = PlanStep & { start: number; end: number };

/** This round's plan: a six-second timeline with each step in order, Undo, and Ready. */
export default function RoundPlanView({ plan, pending, label, onUndo, onReady, title = "This round", dice }: {
  plan: { steps: TimedStep[]; used: number; ready: boolean };
  pending: boolean;
  label: (id: PlayerActionId) => string;
  onUndo: () => void;
  onReady: () => void;
  title?: string;
  // A player's plan with dice to roll: Roll comes before Ready, and once rolled the plan is set.
  dice?: { count: number; rolled: 0 | 1 | 2; onRoll: () => void };
}) {
  const mustRoll = !!dice && dice.count > 0 && dice.rolled !== 2;
  const name = (s: TimedStep) => (s.kind === "move" ? `Move ${s.feet} ft` : `${s.use?.name ?? label(s.action)}${s.swap ? ` ${s.swap.item.name}` : ""}${s.target ? ` ${s.target.name}` : s.aim ? " (aimed)" : ""}`);
  return (
    <div className="space-y-2 rounded-box bg-base-100/60 p-3" data-round-plan>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{title}</span>
        <span className="ml-auto text-xs opacity-70">{+plan.used.toFixed(1)} of {ROUND_SECONDS} s</span>
      </div>
      <div className="relative h-6 overflow-hidden rounded bg-base-300" aria-label="Timeline">
        {Array.from({ length: ROUND_SECONDS - 1 }, (_, i) => (
          <div key={i} className="absolute inset-y-0 w-px bg-base-content/20" style={{ left: `${((i + 1) / ROUND_SECONDS) * 100}%` }} />
        ))}
        {plan.steps.map((s, i) => (
          <div
            key={i}
            title={`${name(s)}: ${+s.start.toFixed(1)}–${+s.end.toFixed(1)} s`}
            className={`absolute inset-y-0.5 truncate rounded px-1 text-[10px] leading-5 ${s.kind === "move" ? "bg-sky-500/70" : "bg-amber-500/80 text-black"}`}
            style={{ left: `${(s.start / ROUND_SECONDS) * 100}%`, width: `${((s.end - s.start) / ROUND_SECONDS) * 100}%` }}
          >
            {name(s)}
          </div>
        ))}
      </div>
      {plan.steps.length === 0 ? (
        <p className="text-xs opacity-60">Add steps in order: an action, or a move (click the map).</p>
      ) : (
        <ol className="list-inside list-decimal text-xs" data-plan-steps>
          {plan.steps.map((s, i) => (
            <li key={i}>
              {s.kind === "move" ? `Move ${s.feet} ft` : s.use?.name ?? label(s.action)}
              {s.kind === "action" && s.swap && <span className="font-semibold"> {s.swap.from ? `${s.swap.from.name} → ` : ""}{s.swap.item.name}</span>}
              {s.kind === "action" && s.target && <span className="font-semibold"> → {s.target.name}</span>}
              {s.kind === "action" && s.aim && s.use?.area && <span className="opacity-70"> ({describeArea(s.use.area)}, aimed)</span>}
              <span className="opacity-60"> · {+s.start.toFixed(1)}–{+s.end.toFixed(1)} s</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-xs" disabled={pending || plan.ready || !plan.steps.length || !!dice?.rolled} onClick={onUndo} title={dice?.rolled === 2 ? "The dice are rolled: the plan is set" : undefined}>Undo last</button>
        {mustRoll ? (
          <button type="button" data-plan-roll className="btn btn-xs btn-secondary ml-auto" disabled={pending || dice.rolled === 1} onClick={dice.onRoll} title="Roll the dice your plan needs; after that the plan can't change">
            {dice.rolled === 1 ? "Rolling…" : `Roll (${dice.count} ${dice.count === 1 ? "roll" : "rolls"})`}
          </button>
        ) : (
          <button type="button" data-plan-ready className={`btn btn-xs ml-auto ${plan.ready ? "btn-success" : "btn-primary"}`} disabled={pending} onClick={onReady}>
            {plan.ready ? (dice?.rolled === 2 ? "Ready ✓ (not ready)" : "Ready ✓ (change plan)") : "Ready"}
          </button>
        )}
      </div>
    </div>
  );
}
