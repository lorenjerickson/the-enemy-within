"use client";

import { useSyncExternalStore } from "react";

// Which creature the GM is planning a round for (the Encounter panel picks it; map clicks then plan its moves).
let selected: number | null = null;
const listeners = new Set<() => void>();

export function setGmPlanToken(id: number | null) {
  selected = id;
  listeners.forEach((l) => l());
}

export function useGmPlanToken(): number | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selected,
    () => null
  );
}
