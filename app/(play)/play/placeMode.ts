"use client";

import { useSyncExternalStore } from "react";
import type { Template } from "@/lib/improvise";

// Placing an improvisation's template: it follows the cursor on the map until a click puts it down (the player's, or the
// GM moving it). Set by the Actions panel or the GM's notice, read by the map (two client trees: a tiny shared store).
export type PlaceMode = { id: number; template: Template; from: { x: number; y: number }; gm: boolean; miss?: boolean } | null; // miss: the GM placing where a missed one lands
let mode: PlaceMode = null;
const listeners = new Set<() => void>();

export function setPlaceMode(m: PlaceMode) {
  mode = m;
  listeners.forEach((l) => l());
}

export const usePlaceMode = (): PlaceMode => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => mode, () => null);
