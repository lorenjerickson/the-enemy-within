"use client";

import { useEffect, useState, useTransition } from "react";
import type { Sheet } from "@/lib/sheet";
import CharacterSheet from "./CharacterSheet";
import { gmApplyCondition, gmConditionCatalog, gmRemoveAffliction, gmSetAllegiance, gmSheet } from "./gmActions";
import { ALLEGIANCES } from "@/lib/sides";
import { setSheetToken, useSheetToken } from "./sheetToken";
import { useGmPlanToken } from "./gmPlanner";

/** A token's character sheet for the GM, kept up to date (health and effects change as rounds resolve). */
export function useGmSheet(id: number | null) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [tick, setTick] = useState(0);
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
  }, [id, tick]);
  return [sheet, setSheet, () => setTick((n) => n + 1)] as const; // the last reloads it now (after a change)
}

/** Effects on them (Poisoned…): the GM can put one from the catalog on them, or take one off. */
function GmConditions({ sheet, reload }: { sheet: Sheet; reload?: () => void }) {
  const [catalog, setCatalog] = useState<{ id: number; name: string; text: string }[]>([]);
  const [pick, setPick] = useState("");
  const [busy, start] = useTransition();
  useEffect(() => { gmConditionCatalog().then(setCatalog); }, []);
  const on = sheet.effects.filter((e) => e.affliction !== undefined);
  return (
    <section className="mt-3 space-y-1 text-xs" data-gm-conditions>
      <div className="font-semibold opacity-80">Effects</div>
      {on.map((e) => (
        <div key={e.affliction} className="flex items-center gap-2">
          <span className="badge badge-warning badge-sm">{e.source}</span>
          <span className="flex-1 opacity-70">{e.left} left</span>
          <button type="button" className="btn btn-ghost btn-xs" disabled={busy} data-remove-affliction={e.affliction} onClick={() => start(async () => { await gmRemoveAffliction(e.affliction!); reload?.(); })}>Remove</button>
        </div>
      ))}
      {catalog.length ? (
        <div className="flex items-center gap-2">
          <select className="select select-xs flex-1" value={pick} onChange={(ev) => setPick(ev.target.value)} data-condition-pick>
            <option value="">Put an effect on them…</option>
            {catalog.map((c) => <option key={c.id} value={c.id} title={c.text}>{c.name}</option>)}
          </select>
          <button type="button" className="btn btn-xs" disabled={!pick || busy} data-apply-condition onClick={() => start(async () => { await gmApplyCondition(sheet.tokenId, Number(pick)); setPick(""); reload?.(); })}>Apply</button>
        </div>
      ) : (
        <p className="opacity-60">No effects that last rounds in the catalog yet (Campaign › Effects).</p>
      )}
    </section>
  );
}

/** The sheet, plus whose side they're on (the GM can change it), and the conditions on them. */
export function GmSheet({ sheet, onChange, reload }: { sheet: Sheet; onChange: (s: Sheet) => void; reload?: () => void }) {
  return (
    <>
      <CharacterSheet sheet={sheet} manage={{ gm: true, onChanged: reload }} />
      <GmConditions sheet={sheet} reload={reload} />
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
  const [sheet, setSheet, reload] = useGmSheet(planning ? null : id);
  if (id === null || !sheet || planning) return null;
  return (
    <aside data-gm-sheet className="fixed right-3 top-3 z-30 max-h-[calc(100vh-24px)] w-80 overflow-y-auto rounded-box bg-base-200/95 p-4 shadow-2xl backdrop-blur">
      <button type="button" className="btn btn-ghost btn-xs absolute right-2 top-2" aria-label="Close sheet" onClick={() => setSheetToken(null)}>✕</button>
      <GmSheet sheet={sheet} onChange={setSheet} reload={reload} />
    </aside>
  );
}
