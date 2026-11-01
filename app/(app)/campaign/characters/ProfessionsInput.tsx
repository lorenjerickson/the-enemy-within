"use client";

import { useState } from "react";

export interface ProfessionNode {
  id: number;
  name: string;
  prerequisites: number[];
}

/**
 * Pick a starting profession and any advancements beyond it. An advancement can only be picked once one of
 * its prerequisites is; options that share a prerequisite are alternatives, so picking one clears the others.
 * Submits as repeated "profession" fields.
 */
export default function ProfessionsInput({ professions, initial = [] }: { professions: ProfessionNode[]; initial?: number[] }) {
  const [chosen, setChosen] = useState<Set<number>>(new Set(initial));
  const childrenOf = (id: number | null) =>
    professions.filter((p) => (id === null ? p.prerequisites.length === 0 : p.prerequisites.includes(id)));

  function descendants(id: number, seen = new Set<number>()): Set<number> {
    for (const c of childrenOf(id)) if (!seen.has(c.id)) { seen.add(c.id); descendants(c.id, seen); }
    return seen;
  }

  function toggle(p: ProfessionNode, parent: number | null, on: boolean) {
    const next = new Set(chosen);
    const clear = (id: number) => { next.delete(id); descendants(id).forEach((d) => next.delete(d)); };
    if (on) {
      childrenOf(parent).filter((s) => s.id !== p.id).forEach((s) => clear(s.id)); // alternatives
      next.add(p.id);
    } else {
      clear(p.id);
    }
    setChosen(next);
  }

  function Level({ parent, path }: { parent: number | null; path: number[] }) {
    const options = childrenOf(parent).filter((p) => !path.includes(p.id));
    if (options.length === 0) return null;
    return (
      <ul className={parent === null ? "space-y-1" : "ml-6 border-l border-base-300 pl-3 space-y-1"}>
        {options.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type={parent === null ? "checkbox" : "radio"}
                className={parent === null ? "checkbox checkbox-sm" : "radio radio-sm"}
                checked={chosen.has(p.id)}
                onChange={(e) => toggle(p, parent, parent === null ? e.target.checked : true)}
                onClick={() => parent !== null && chosen.has(p.id) && toggle(p, parent, false)}
              />
              {p.name}
            </label>
            {chosen.has(p.id) && <Level parent={p.id} path={[...path, p.id]} />}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Professions</legend>
      {[...chosen].map((id) => (
        <input key={id} type="hidden" name="profession" value={id} />
      ))}
      {professions.length === 0 ? <p className="text-sm opacity-60">No professions defined.</p> : <Level parent={null} path={[]} />}
      <p className="text-xs opacity-60">Tick a starting profession, then pick any advancements already earned.</p>
    </fieldset>
  );
}
