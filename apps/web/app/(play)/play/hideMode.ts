"use client";

import { useSyncExternalStore } from "react";

// Hide (seen): the blind spots to pick on the map. The Actions panel (or the GM's planning) sets them, the map draws
// them and takes the click. `plan`: planning a round's Hide (for the GM's token, or the player's own: null); without
// it, out of combat, the click hides now. (Two separate client trees, so a tiny shared store rather than props.)
export type HidePick = { spots: { col: number; row: number }[]; plan?: { tokenId: number | null } } | null;
let pick: HidePick = null;
const listeners = new Set<() => void>();

export function setHideSpots(spots: { col: number; row: number }[] | null, plan?: { tokenId: number | null }) {
  pick = spots ? { spots, ...(plan ? { plan } : {}) } : null;
  listeners.forEach((l) => l());
}

export function useHidePick(): HidePick {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pick,
    () => null
  );
}

/** Just the spots (or null). */
export const useHideSpots = () => useHidePick()?.spots ?? null;
