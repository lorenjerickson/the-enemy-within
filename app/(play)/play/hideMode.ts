"use client";

import { useSyncExternalStore } from "react";

// Hide (out of an encounter, seen): the blind spots the player can pick on the map. The Actions panel sets them, the
// map draws them and takes the click. (Two separate client trees, so a tiny shared store rather than props.)
let spots: { col: number; row: number }[] | null = null;
const listeners = new Set<() => void>();

export function setHideSpots(value: { col: number; row: number }[] | null) {
  spots = value;
  listeners.forEach((l) => l());
}

export function useHideSpots() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => spots,
    () => null
  );
}
