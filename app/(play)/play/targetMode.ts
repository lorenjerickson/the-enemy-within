"use client";

import { useSyncExternalStore } from "react";
import type { PlayerActionId } from "@/lib/playerActions";
import type { AreaShape } from "@/lib/aoe";

// Picking a target for a planned action by clicking a token on the map. `tokenId` is set when the GM plans for one
// of their creatures (null = the player's own character). The panel sets it; the map uses it and clears it.
// seconds: for Evade / Pursue, how long (unset = the rest of the round).
// area: an area attack, aimed at a spot instead of a token (range in squares, for a circle's centre).
export type TargetMode = { action: PlayerActionId; tokenId: number | null; use?: number; label?: string; area?: { shape: AreaShape; ft: number; range: number }; seconds?: number } | null; // use: a gear action (Aimed shot…)
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
