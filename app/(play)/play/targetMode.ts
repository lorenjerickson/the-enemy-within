"use client";

import { useSyncExternalStore } from "react";
import type { PlayerActionId } from "@/lib/playerActions";

// Picking a target for a planned action by clicking a token on the map. `tokenId` is set when the GM plans for one
// of their creatures (null = the player's own character). The panel sets it; the map uses it and clears it.
export type TargetMode = { action: PlayerActionId; tokenId: number | null; use?: number; label?: string } | null; // use: a gear action (Aimed shot…)
let mode: TargetMode = null;
const listeners = new Set<() => void>();

export function setTargetMode(m: TargetMode) {
  mode = m;
  listeners.forEach((l) => l());
}

export function useTargetMode(): TargetMode {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => mode,
    () => null
  );
}
