"use client";

import { useRef, useState, useTransition } from "react";
import type DiceBox from "@3d-dice/dice-box";
import { diceToThrow, formulaText, type RollSpec, type RolledPart } from "@/lib/rolls";
import { closeRoll, submitRoll } from "./actions";

export interface PromptRequest {
  id: number;
  spec: RollSpec;
  result: { total: number; parts: RolledPart[]; outcome: string; success: boolean } | null;
}

const MODE_LABEL = { normal: "No advantage", advantage: "Advantage", disadvantage: "Disadvantage" } as const;

/**
 * A roll the player has to make: the formula (hover it for where each part comes from), advantage or
 * disadvantage, and a Roll button that throws 3D dice (dice-box); the dice decide, the server scores and settles.
 */
export default function RollPrompt({ request }: { request: PromptRequest | null }) {
  const box = useRef<DiceBox | null>(null);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  if (!request) return null;
  const { spec, result } = request;

  async function roll() {
    setRolling(true);
    setError(null);
    try {
      if (!box.current) {
        const { default: Box } = await import("@3d-dice/dice-box");
        box.current = new Box({ container: "#dice-box", assetPath: "/assets/dice-box/", scale: 7, theme: "default", themeColor: "#7c3aed" });
        await box.current.init();
      }
      const throws = diceToThrow(spec);
      // dice-box resolves with every die thrown, each tagged with the group (notation) it came from.
      const dice = await box.current.roll(throws.filter((t) => t !== null).map((t) => `${t.count}d${t.sides}`));
      let g = 0;
      const thrown = throws.map((t) => {
        if (!t) return [];
        const group = g++;
        return dice.filter((d) => d.groupId === group).map((d) => d.value);
      });
      const r = await submitRoll(request!.id, thrown);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(`The dice didn't roll: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRolling(false);
    }
  }

  function close() {
    box.current?.clear();
    startTransition(() => closeRoll(request!.id));
  }

  return (
    <>
      {/* The 3D dice tumble across the whole screen, above the map. */}
      <div id="dice-box" className="pointer-events-none fixed inset-0 z-30 [&_canvas]:size-full" />
      <div data-roll-prompt className="fixed left-1/2 top-16 z-40 w-[min(26rem,calc(100vw-7rem))] -translate-x-1/2 space-y-3 rounded-box bg-base-200/95 p-4 shadow-2xl backdrop-blur">
        <div className="text-sm opacity-80">{spec.label}</div>
        <div className="flex items-center gap-3">
          <span className="group relative cursor-help" tabIndex={0}>
            <span data-roll-formula className="font-mono text-2xl font-semibold underline decoration-dotted underline-offset-4">{formulaText(spec)}</span>
            <Breakdown spec={spec} parts={result?.parts} />
          </span>
          <span data-roll-mode className={`badge ${spec.mode === "advantage" ? "badge-success" : spec.mode === "disadvantage" ? "badge-error" : "badge-ghost"}`}>
            {MODE_LABEL[spec.mode]}
          </span>
        </div>
        {result ? (
          <div className="space-y-2">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold" data-roll-total>{result.total}</span>
              <span className={result.success ? "text-success" : "text-warning"} data-roll-outcome>{result.outcome}</span>
            </div>
            <button type="button" className="btn btn-sm" onClick={close}>Close</button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary w-full" disabled={rolling} onClick={roll}>
            {rolling ? "Rolling…" : "Roll"}
          </button>
        )}
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </>
  );
}

/** Where each part of the formula comes from (and, once rolled, what each die showed). */
function Breakdown({ spec, parts }: { spec: RollSpec; parts?: RolledPart[] }) {
  return (
    <div role="tooltip" data-roll-breakdown className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-80 rounded-box bg-base-100 p-3 text-sm opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100">
      <table className="w-full">
        <tbody>
          {spec.parts.map((p, i) => (
            <tr key={i}>
              <td className="pr-3 font-mono whitespace-nowrap">{i === 0 ? p.formula : /^-/.test(p.formula) ? p.formula.replace("-", "− ") : `+ ${p.formula}`}</td>
              <td className="opacity-80">{p.source}{i === 0 && (spec.reroll || spec.min) ? <span className="ml-1 text-xs opacity-70">({[spec.reroll && `reroll ${spec.reroll === 1 ? "a 1" : `${spec.reroll} or less`}`, spec.min && `at least ${spec.min}`].filter(Boolean).join(", ")})</span> : null}</td>
              {parts && (
                <td className="pl-2 text-right font-mono whitespace-nowrap">
                  {parts[i].dice.length ? `[${parts[i].dice.join(", ")}]` : ""}
                  {parts[i].dropped !== undefined && <span className="opacity-50 line-through"> {parts[i].dropped}</span>}
                  {parts[i].note && <span className="ml-1 text-xs opacity-70">({parts[i].note})</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {spec.mode !== "normal" && (
        <p className="mt-2 text-xs opacity-70">{MODE_LABEL[spec.mode]}: roll the d20 twice and keep the {spec.mode === "advantage" ? "higher" : "lower"}.</p>
      )}
    </div>
  );
}
