"use client";

import { useSyncExternalStore } from "react";

// Whose character sheet the GM has open (clicking a token on the map picks it; the sheet panel shows it).
let token: number | null = null;
const listeners = new Set<() => void>();

export function setSheetToken(id: number | null) {
  token = id;
  listeners.forEach((l) => l());
}

export function useSheetToken(): number | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => token,
    () => null
  );
}
