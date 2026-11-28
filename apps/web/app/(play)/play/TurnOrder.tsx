"use client";

import { useTransition } from "react";
import { actAs } from "../../(app)/sessions/actions";
import { gmRollInitiativeFor } from "./gmActions";
import PlanCountdown from "./PlanCountdown";

export interface TurnRow {
  tokenId: number;
  initiative: number | null; // null: still rolling
  name: string;
  player: string | null; // who plays them (a character), or null for a GM creature
  down: boolean;
  ready: boolean;
  rolling?: boolean; // rolling their plan's dice
  turn: boolean;
  statuses: { source: string; text: string }[]; // what actions left on them (Blinding flash: disadvantage on attack rolls)
  clock?: number; // the last one planning: when their time runs out (ms)
}

/**
 * The initiative order. The GM clicks anyone to act as them (their view, and their Actions panel): a creature of
 * theirs or an absent player's character to play, a present player's to watch. Everyone shows whether their plan is ready.
 */
export default function TurnOrder({ rows }: { rows: TurnRow[] }) {
  const [, startTransition] = useTransition();
  return (
    <ol className="space-y-1" data-turn-order>
      {rows.map((r) => (
        <li key={r.tokenId} className="flex items-center gap-1">
          <button
            type="button"
            data-turn={r.tokenId}
            title={`${r.player ? `${r.name}'s view (${r.player})` : `Act as ${r.name}`}${r.down ? ": down, no plan until revived" : ""}`}
            onClick={() => startTransition(async () => { await actAs(r.tokenId); })}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left ${r.turn ? "bg-primary/25" : "bg-base-100/60"} ${r.initiative === null ? "opacity-70" : ""} ${r.down ? "cursor-default" : "hover:ring-1 hover:ring-primary"}`}
          >
            <span className="w-6 text-right font-mono">{r.initiative ?? "…"}</span>
            <span className="flex-1">
              {r.name}
              {r.player && <span className="ml-1 text-xs opacity-60">({r.player})</span>}
              {r.statuses.map((s, i) => (
                <span key={i} className="badge badge-xs badge-warning ml-1" title={s.text} data-status>{s.source}</span>
              ))}
            </span>
            {r.initiative === null && <span className="text-xs">rolling</span>}
            {r.down ? (
              <span className="badge badge-sm badge-error">down</span>
            ) : (
              <>
                <span className={`badge badge-sm ${r.ready ? "badge-success" : r.rolling ? "badge-secondary" : "badge-ghost"}`}>{r.ready ? "ready" : r.rolling ? "rolling…" : "planning"}</span>
                {r.clock && !r.ready && <PlanCountdown endsAt={r.clock} compact />}
              </>
            )}
          </button>
          {r.initiative === null && (
            <form action={gmRollInitiativeFor.bind(null, r.tokenId)}>
              <button className="btn btn-xs" data-roll-for={r.tokenId} title={`Roll initiative for ${r.name}${r.player ? ` (instead of ${r.player})` : ""}`}>Roll</button>
            </form>
          )}
        </li>
      ))}
    </ol>
  );
}
