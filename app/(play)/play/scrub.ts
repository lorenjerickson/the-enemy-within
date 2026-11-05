"use client";

import { useSyncExternalStore } from "react";

// The GM scrubbing through the last resolved round: which second their map shows (0 = before it), or null = live.
let second: number | null = null;
const listeners = new Set<() => void>();

export function setScrub(value: number | null) {
  second = value;
  listeners.forEach((l) => l());
}

export function useScrub(): number | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => second,
    () => null
  );
}
