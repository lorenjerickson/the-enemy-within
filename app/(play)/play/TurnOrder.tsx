"use client";

import { setGmPlanToken, useGmPlanToken } from "./gmPlanner";
import { setMoveMode } from "./moveMode";

export interface TurnRow {
  tokenId: number;
  initiative: number | null; // null: still rolling
  name: string;
  player: string | null; // who plays them (a character), or null for a GM creature
  down: boolean;
  ready: boolean;
  turn: boolean;
}

/**
 * The initiative order. The GM clicks anyone not down to plan their round below: their own creatures, or a player's
 * character (for an absent or AFK player). Everyone shows whether their plan is ready.
 */
export default function TurnOrder({ rows }: { rows: TurnRow[] }) {
  const selected = useGmPlanToken();
  return (
    <ol className="space-y-1" data-turn-order>
      {rows.map((r) => (
        <li key={r.tokenId}>
          <button
            type="button"
            data-turn={r.tokenId}
            disabled={r.down}
            aria-pressed={selected === r.tokenId}
            title={r.down ? "Down: no plan until revived" : `Plan ${r.name}'s round${r.player ? ` (for ${r.player})` : ""}`}
            onClick={() => {
              setMoveMode(false); // a newly picked one starts with no move being planned
              setGmPlanToken(selected === r.tokenId ? null : r.tokenId);
            }}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${selected === r.tokenId ? "bg-primary text-primary-content" : r.turn ? "bg-primary/25" : "bg-base-100/60"} ${r.initiative === null ? "opacity-70" : ""} ${r.down ? "cursor-default" : "hover:ring-1 hover:ring-primary"}`}
          >
            <span className="w-6 text-right font-mono">{r.initiative ?? "…"}</span>
            <span className="flex-1">
              {r.name}
              {r.player && <span className="ml-1 text-xs opacity-60">({r.player})</span>}
            </span>
            {r.initiative === null && <span className="text-xs">rolling</span>}
            {r.down ? (
              <span className="badge badge-sm badge-error">down</span>
            ) : (
              <span className={`badge badge-sm ${r.ready ? "badge-success" : "badge-ghost"}`}>{r.ready ? "ready" : "planning"}</span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}
