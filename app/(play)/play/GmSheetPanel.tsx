"use client";

import { useEffect, useState } from "react";
import type { Sheet } from "@/lib/sheet";
import CharacterSheet from "./CharacterSheet";
import { gmSetAllegiance, gmSheet } from "./gmActions";
import { ALLEGIANCES } from "@/lib/sides";
import { setSheetToken, useSheetToken } from "./sheetToken";
import { useGmPlanToken } from "./gmPlanner";

/** A token's character sheet for the GM, kept up to date (health and effects change as rounds resolve). */
export function useGmSheet(id: number | null) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  useEffect(() => {
    if (id === null) return setSheet(null);
    let live = true;
    const load = () => gmSheet(id).then((s) => live && setSheet(s));
    load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  return [sheet, setSheet] as const;
}

/** The sheet, plus whose side they're on (the GM can change it). */
export function GmSheet({ sheet, onChange }: { sheet: Sheet; onChange: (s: Sheet) => void }) {
  return (
    <>
      <CharacterSheet sheet={sheet} />
      <label className="mt-3 flex items-center gap-2 text-xs" data-allegiance>
        Side
        <select className="select select-xs w-auto" value={sheet.allegiance} onChange={(e) => { const a = e.target.value; onChange({ ...sheet, allegiance: a as typeof sheet.allegiance }); gmSetAllegiance(sheet.tokenId, a); }}>
          {ALLEGIANCES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="opacity-60">for actions aimed at friendlies or enemies</span>
      </label>
    </>
  );
}

/** The GM's view of whoever's token they clicked on the map: their character sheet, on the right (not while planning). */
export default function GmSheetPanel() {
  const id = useSheetToken();
  const planning = useGmPlanToken() !== null;
  const [sheet, setSheet] = useGmSheet(planning ? null : id);
  if (id === null || !sheet || planning) return null;
  return (
    <aside data-gm-sheet className="fixed right-3 top-3 z-30 max-h-[calc(100vh-24px)] w-80 overflow-y-auto rounded-box bg-base-200/95 p-4 shadow-2xl backdrop-blur">
      <button type="button" className="btn btn-ghost btn-xs absolute right-2 top-2" aria-label="Close sheet" onClick={() => setSheetToken(null)}>✕</button>
      <GmSheet sheet={sheet} onChange={setSheet} />
    </aside>
  );
}
