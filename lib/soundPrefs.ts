"use client";

import { useSyncExternalStore } from "react";

/**
 * This browser's own sound settings: whether sound has been switched on (browsers play nothing until the page has
 * been clicked), and a master volume (0 = muted). Remembered in this browser. Every sound multiplies by `master()`.
 */
type Prefs = { on: boolean; volume: number; muted: boolean };
const KEY = "tew-sound";
let prefs: Prefs = { on: false, volume: 0.8, muted: false };
try { const saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (saved) prefs = { ...prefs, volume: saved.volume ?? 0.8, muted: !!saved.muted }; } catch { /* no storage */ }
const listeners = new Set<() => void>();

export const master = () => (prefs.on && !prefs.muted ? prefs.volume : 0);
export function setSoundPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  try { localStorage.setItem(KEY, JSON.stringify({ volume: prefs.volume, muted: prefs.muted })); } catch { /* no storage */ }
  listeners.forEach((l) => l());
}
export const onSoundPrefs = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSoundPrefs = () => useSyncExternalStore(onSoundPrefs, () => prefs, () => prefs);
