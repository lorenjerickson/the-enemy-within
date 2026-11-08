"use client";

import { useEffect } from "react";
import CreaturePlans, { type CreaturePlan } from "./CreaturePlans";
import { GmSheet, useGmSheet } from "./GmSheetPanel";
import { setGmPlanToken, useGmPlanToken } from "./gmPlanner";
import { setMoveMode } from "./moveMode";
import { setTargetMode } from "./targetMode";
import GmRoundHistory, { type GmRound } from "./GmRoundHistory";

const back = () => {
  setGmPlanToken(null);
  setMoveMode(false);
  setTargetMode(null);
};

/**
 * The GM planning someone's round (picked in the turn order) sees what a player sees: their sheet on the left edge,
 * their planning on the right, and a prominent way back to GM mode (where Resolve round is: never next to Ready).
 */
export default function GmPlanningMode({ creatures, targets, history }: { creatures: CreaturePlan[]; targets: { id: number; name: string; allegiance?: string | null; character_id?: number | null }[]; history: GmRound[] }) {
  const id = useGmPlanToken();
  const [sheet, setSheet, reload] = useGmSheet(id);
  const current = creatures.find((c) => c.tokenId === id);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && id !== null && !document.querySelector("[data-art-modal]") && back();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [id]);
  if (id === null) return null;
  return (
    <>
      <aside data-planning-sheet className="fixed inset-y-0 left-0 z-20 flex w-[24rem] max-w-[calc(100vw-3rem)] flex-col bg-base-200/90 shadow-xl backdrop-blur">
        <div className="space-y-2 border-b border-base-300 p-3">
          <button type="button" className="btn btn-warning btn-block" data-gm-mode onClick={back}>← Back to GM mode</button>
          <p className="text-xs opacity-70">Planning for {current?.name ?? "…"}{current?.player ? ` (for ${current.player})` : ""}. Esc also goes back.</p>
          {/* Switch to someone else's plan: here, or by clicking their token on the map. */}
          <div className="flex flex-wrap gap-1" data-plan-switch>
            {creatures.map((c) => (
              <button
                key={c.tokenId}
                type="button"
                data-plan-switch-to={c.tokenId}
                aria-pressed={c.tokenId === id}
                className={`btn btn-xs ${c.tokenId === id ? "btn-primary" : c.plan.ready ? "btn-success btn-outline" : ""}`}
                title={c.plan.ready ? "Ready" : "Still planning"}
                onClick={() => { setMoveMode(false); setTargetMode(null); setGmPlanToken(c.tokenId); }}
              >
                {c.name}{c.plan.ready ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{sheet ? <GmSheet sheet={sheet} onChange={setSheet} reload={reload} /> : <p className="text-sm opacity-60">Loading…</p>}</div>
      </aside>
      <aside data-planning-panel className="fixed inset-y-0 right-0 z-20 flex w-[26rem] max-w-[calc(100vw-3rem)] flex-col bg-base-200/90 shadow-xl backdrop-blur">
        <header className="px-3 py-2 font-semibold">Actions</header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {current ? <CreaturePlans creatures={creatures} targets={targets} /> : <p className="text-sm opacity-60">They can&apos;t plan right now (down, or out of the encounter).</p>}
          <div className="mt-3"><GmRoundHistory rounds={history} /></div>
        </div>
      </aside>
    </>
  );
}
