"use client";

import { useSyncExternalStore } from "react";

// Whether the player has the Move action on: the Actions panel switches it, the map draws the movement overlay.
// (Two separate client trees, so a tiny shared store rather than props.)
let on = false;
const listeners = new Set<() => void>();

export function setMoveMode(value: boolean) {
  on = value;
  listeners.forEach((l) => l());
}

export function useMoveMode(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => on,
    () => false
  );
}
