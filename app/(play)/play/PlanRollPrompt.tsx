"use client";

import { useRef, useState, useTransition } from "react";
import type DiceBox from "@3d-dice/dice-box";
import { formulaText, type RollSpec } from "@/lib/rolls";
import { rollPlan, submitPlanDice } from "./actions";

export interface PlanRollView {
  spec: RollSpec;
  want: ({ count: number; sides: number } | null)[]; // what to throw per part (to-hit and check d20s twice)
  result?: { total: number; text: string }; // once rolled
}

/**
 * The dice a plan needs (each attack's to-hit and damage, a Dodge's check), rolled together with 3D dice before
 * Ready. Modifiers are shown; resolution adds them, and advantage or disadvantage at the time picks between the two
 * d20s (else the first counts). Once rolled the plan is set.
 */
export default function PlanRollPrompt({ rolls, rolled }: { rolls: PlanRollView[]; rolled: 0 | 1 | 2 }) {
  const box = useRef<DiceBox | null>(null);
  const [throwing, setThrowing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  if (rolled === 0 || (rolled === 2 && closed) || !rolls.length) return null;

  async function throwAll() {
    setThrowing(true);
    setError(null);
    try {
      if (!box.current) {
        const { default: Box } = await import("@3d-dice/dice-box");
        box.current = new Box({ container: "#plan-dice-box", assetPath: "/assets/dice-box/", scale: 7, theme: "default", themeColor: "#7c3aed" });
        await box.current.init();
      }
      // Every die at once; each group (notation) maps back to its roll and part.
      const groups = rolls.flatMap((r, ri) => r.want.flatMap((w, pi) => (w ? [{ ri, pi, notation: `${w.count}d${w.sides}` }] : [])));
      const dice = await box.current.roll(groups.map((g) => g.notation));
      const thrown = rolls.map((r) => r.want.map(() => [] as number[]));
      groups.forEach((g, gi) => (thrown[g.ri][g.pi] = dice.filter((d) => d.groupId === gi).map((d) => d.value)));
      const r = await submitPlanDice(thrown);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(`The dice didn't roll: ${e instanceof Error ? e.message : e}`);
    } finally {
      setThrowing(false);
    }
  }

  return (
    <>
      <div id="plan-dice-box" className="pointer-events-none fixed inset-0 z-30 [&_canvas]:size-full" />
      <div data-plan-roll-prompt className="fixed left-1/2 top-16 z-40 w-[min(28rem,calc(100vw-7rem))] -translate-x-1/2 space-y-3 rounded-box bg-base-200/95 p-4 shadow-2xl backdrop-blur">
        <div className="text-sm opacity-80">Your plan&apos;s dice</div>
        <ul className="space-y-2">
          {rolls.map((r, i) => (
            <li key={i} className="flex items-baseline gap-3" data-plan-roll>
              <div className="min-w-0 flex-1">
                <div className="text-xs opacity-70">{r.spec.label}</div>
                <div className="font-mono font-semibold" title={r.spec.parts.map((p) => `${p.formula}: ${p.source}`).join("\n")}>{formulaText(r.spec)}</div>
                {r.result && <div className="text-xs opacity-70">{r.result.text}</div>}
              </div>
              {r.result && <span className="text-2xl font-bold" data-plan-roll-total>{r.result.total}</span>}
            </li>
          ))}
        </ul>
        <p className="text-xs opacity-60">To-hit and Dodge d20s are thrown twice: advantage or disadvantage when it happens picks which counts (otherwise the first).</p>
        {rolled === 2 ? (
          <button type="button" className="btn btn-sm" onClick={() => { box.current?.clear(); setClosed(true); }}>Close (plan set; now Ready)</button>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={throwing} onClick={throwAll}>{throwing ? "Rolling…" : "Roll"}</button>
            <button type="button" className="btn btn-ghost" disabled={throwing} onClick={() => startTransition(() => rollPlan(false))}>Cancel</button>
          </div>
        )}
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </>
  );
}
