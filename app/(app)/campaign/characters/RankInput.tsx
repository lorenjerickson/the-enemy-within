"use client";

import { useState } from "react";

export interface ProfessionOption {
  id: number;
  name: string;
  ranks: { id: number; name: string; depth: number }[]; // in order: each after the rank it advances from; the starting rank first
}

/**
 * A character's profession and rank (they hold every rank before it too). Picking a profession picks its starting
 * rank; `startingOnly` (a player making their own character) leaves the rank at that. Submits "rank_id".
 */
export default function RankInput({ professions, initial = null, startingOnly = false }: { professions: ProfessionOption[]; initial?: number | null; startingOnly?: boolean }) {
  const [rank, setRank] = useState<number | null>(initial);
  const group = professions.find((g) => g.ranks.some((r) => r.id === rank));
  return (
    <fieldset className="fieldset" data-rank-input>
      <legend className="fieldset-legend">Profession</legend>
      <input type="hidden" name="rank_id" value={rank ?? ""} />
      {professions.length === 0 ? <p className="text-sm opacity-60">No professions defined.</p> : (
        <div className="flex flex-wrap items-center gap-2">
          <select className="select select-sm w-auto" data-profession value={group?.id ?? ""} onChange={(e) => setRank(professions.find((g) => g.id === Number(e.target.value))?.ranks[0]?.id ?? null)}>
            <option value="">None</option>
            {professions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {group && !startingOnly && (
            <>
              <span className="text-sm opacity-70">rank</span>
              <select className="select select-sm w-auto" data-rank value={rank ?? ""} onChange={(e) => setRank(Number(e.target.value))}>
                {group.ranks.map((r) => <option key={r.id} value={r.id}>{`${"  ".repeat(r.depth)}${r.depth ? "› " : ""}${r.name}`}</option>)}
              </select>
            </>
          )}
          {group && startingOnly && <span className="text-sm opacity-70">starting as {group.ranks.find((r) => r.id === rank)?.name}</span>}
        </div>
      )}
      {!startingOnly && <p className="text-xs opacity-60">They hold every rank before it too.</p>}
    </fieldset>
  );
}
