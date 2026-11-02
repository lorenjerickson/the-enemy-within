"use client";

import { useSyncExternalStore } from "react";

/**
 * The one ambient player for this browser tab: starting anything stops whatever was playing,
 * so only one ambient sound plays at a time. A sound plays its "loop" clips one after another
 * on one channel, and each "layer" clip looping on its own channel at the same time.
 */
type Now = { soundId: number; clipId: number | null; layerIds: number[] } | null;

let audio: HTMLAudioElement | null = null;
let layers: HTMLAudioElement[] = [];
let volume = 1;
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
  for (const l of layers) l.pause();
  layers = [];
  now = null;
  emit();
}

function play(clip: { id: number; url: string }, onEnded: (() => void) | null) {
  const a = player();
  a.onended = onEnded;
  a.src = clip.url;
  a.volume = volume;
  void a.play().catch(() => {}); // autoplay can be refused; the GM can press play again
  if (now) now = { ...now, clipId: clip.id };
  emit();
}

/** Sets the playing ambient sound's volume (0..1), for every channel. */
export function setAmbientVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  player().volume = volume;
  for (const l of layers) l.volume = volume;
}

/**
 * Plays a sound: its sequence clips one after another, starting over after the last, and its
 * layer clips all at once, each looping on its own.
 */
export function playSequence(
  soundId: number,
  clips: { id: number; url: string }[],
  v = 1,
  layerClips: { id: number; url: string }[] = []
) {
  stopAmbient();
  if (clips.length === 0 && layerClips.length === 0) return;
  setAmbientVolume(v);
  now = { soundId, clipId: null, layerIds: layerClips.map((c) => c.id) };
  layers = layerClips.map((c) => {
    const l = new Audio(c.url);
    l.loop = true;
    l.volume = volume;
    void l.play().catch(() => {});
    return l;
  });
  if (clips.length) {
    const step = (i: number) => play(clips[i], () => step((i + 1) % clips.length));
    step(0);
  } else emit();
}

/** Plays a single clip once (manual or event clips). */
export function playOnce(soundId: number, clip: { id: number; url: string }, v = 1) {
  stopAmbient();
  setAmbientVolume(v);
  now = { soundId, clipId: clip.id, layerIds: [] };
  play(clip, () => stopAmbient());
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
