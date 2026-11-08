"use client";

import { useEffect, useState } from "react";
import type { Sheet } from "@/lib/sheet";
import CharacterSheet from "./CharacterSheet";
import { gmSheet } from "./gmActions";
import { setSheetToken, useSheetToken } from "./sheetToken";

/** The GM's view of whoever's token they clicked on the map: their character sheet, on the right, kept up to date. */
export default function GmSheetPanel() {
  const id = useSheetToken();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  useEffect(() => {
    if (id === null) return setSheet(null);
    let live = true;
    const load = () => gmSheet(id).then((s) => live && setSheet(s));
    load();
    const t = setInterval(load, 3000); // health and effects change as rounds resolve
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  if (id === null || !sheet) return null;
  return (
    <aside data-gm-sheet className="fixed right-3 top-3 z-30 max-h-[calc(100vh-24px)] w-80 overflow-y-auto rounded-box bg-base-200/95 p-4 shadow-2xl backdrop-blur">
      <button type="button" className="btn btn-ghost btn-xs absolute right-2 top-2" aria-label="Close sheet" onClick={() => setSheetToken(null)}>✕</button>
      <CharacterSheet sheet={sheet} />
    </aside>
  );
}
