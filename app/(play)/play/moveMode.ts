"use client";

import { useSyncExternalStore } from "react";

// Whether the player has the Move action on (or Dash: moving at running speed): the Actions panel switches it, the
// map draws the movement overlay and plans the move. (Two separate client trees, so a tiny shared store rather than props.)
let on = false;
let running = false;
const listeners = new Set<() => void>();

export function setMoveMode(value: boolean, run = false) {
  on = value;
  running = value && run;
  listeners.forEach((l) => l());
}

export function useMoveMode(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => on,
    () => false
  );
}

/** Whether the move being planned is a Dash (running speed; it uses the round's action). */
export function useRunMode(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => running,
    () => false
  );
}
