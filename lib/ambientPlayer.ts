"use client";

import { useSyncExternalStore } from "react";

/**
 * The one ambient player for this browser tab: starting anything stops whatever was playing,
 * so only one ambient sound plays at a time.
 */
type Now = { soundId: number; clipId: number } | null;

let audio: HTMLAudioElement | null = null;
let now: Now = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function player() {
  audio ??= new Audio();
  return audio;
}

export function stopAmbient() {
  const a = player();
  a.onended = null;
  a.pause();
  now = null;
  emit();
}

function play(soundId: number, clip: { id: number; url: string }, onEnded: (() => void) | null) {
  const a = player();
  a.onended = onEnded;
  a.src = clip.url;
  void a.play().catch(() => {}); // autoplay can be refused; the GM can press play again
  now = { soundId, clipId: clip.id };
  emit();
}

/** Plays a sound's looped clips one after another, starting over after the last. */
export function playSequence(soundId: number, clips: { id: number; url: string }[]) {
  if (clips.length === 0) return stopAmbient();
  const step = (i: number) => play(soundId, clips[i], () => step((i + 1) % clips.length));
  step(0);
}

/** Plays a single clip once (manual or event clips). */
export function playOnce(soundId: number, clip: { id: number; url: string }) {
  play(soundId, clip, () => stopAmbient());
}

export function useAmbientNow(): Now {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => now,
    () => null
  );
}
