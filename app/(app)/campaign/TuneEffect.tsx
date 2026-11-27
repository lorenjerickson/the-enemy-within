"use client";

import { useState } from "react";
import type { Effect } from "@/lib/conditions";
import { effectSentences } from "@/lib/effectGrammar";
import { answersFromEffect, effectCard } from "@/lib/effectWizard";
import { isTuned, tune, tunablesOf, type Tunable } from "@/lib/effectCopy";

/**
 * Tuning one use's copy of an effect (backlog W), in place where it's added: only what a copy may change (its name,
 * rounds, save DCs, the numbers in its rules), filled in from the copy, with its card as it reads now. Locked parts
 * aren't offered. `catalog`: the effect as the catalog has it, to say whether this copy differs and to put it back.
 */
export default function TuneEffect({ copy, catalog, onChange }: { copy: Effect; catalog?: Effect; onChange: (next: Effect) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Record<string, string>>({});
  const set = (t: Tunable, raw: string) => {
    setDraft((d) => ({ ...d, [t.path]: raw }));
    try {
      onChange(tune(copy, { [t.path]: t.kind === "number" ? Number(raw) : raw }));
      setProblem((p) => { const { [t.path]: _, ...rest } = p; return rest; });
    } catch (e) {
      setProblem((p) => ({ ...p, [t.path]: e instanceof Error ? e.message : "Not a good value" }));
    }
  };
  const card = effectCard(answersFromEffect(copy), effectSentences(copy.modifiers));
  const tuned = catalog ? isTuned(copy, catalog) : false;
  return (
    <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-2 text-sm" data-tune-effect={copy.id}>
      <div className="text-xs opacity-70">{card.join(" ")}</div>
      <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
        {tunablesOf(copy).map((t) => (
          <label key={t.path} className="flex flex-col gap-0.5">
            <span className="text-xs opacity-60">{t.label}</span>
            <input
              value={draft[t.path] ?? String(t.value)}
              onChange={(e) => set(t, e.target.value)}
              type={t.kind === "number" ? "number" : "text"}
              min={t.min} max={t.max} step={t.kind === "number" && t.path.includes("factor") ? 0.25 : 1}
              className={`input input-xs w-full ${problem[t.path] ? "input-error" : ""}`}
            />
            {problem[t.path] && <span className="text-xs text-error">{problem[t.path]}</span>}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs opacity-70">
        <span>{tuned ? "Tuned for this use." : "As the catalog has it."} Its type, saves' abilities and wording stay as the catalog's.</span>
        {tuned && catalog && <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDraft({}); setProblem({}); onChange(JSON.parse(JSON.stringify(catalog))); }}>Put it back</button>}
      </div>
    </div>
  );
}
