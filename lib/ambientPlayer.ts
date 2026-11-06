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
let sequence: { id: number; url: string }[] = []; // the loop clips, played in turn
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
  sequence = [];
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
  sequence = [...clips];
  if (sequence.length) step(0);
  else emit();
}

/** Plays the sequence's clip at i, then the next (wrapping round). */
function step(i: number) {
  if (!sequence.length) return;
  const at = i % sequence.length;
  play(sequence[at], () => step(at + 1));
}

/** A clip removed from its sound (or no longer a loop / layer clip): it stops, and the rest play on. */
export function dropAmbientClip(clipId: number) {
  if (!now) return;
  const li = now.layerIds.indexOf(clipId);
  if (li >= 0) {
    layers[li].pause();
    layers = layers.filter((_, i) => i !== li);
    now = { ...now, layerIds: now.layerIds.filter((id) => id !== clipId) };
  }
  const si = sequence.findIndex((c) => c.id === clipId);
  if (si >= 0) {
    sequence = sequence.filter((c) => c.id !== clipId);
    if (now.clipId === clipId) {
      if (sequence.length) step(si); // the clip after it (now at its place)
      else {
        const a = player();
        a.onended = null;
        a.pause();
        now = { ...now, clipId: null };
      }
    }
  } else if (now.clipId === clipId) return stopAmbient(); // a single clip played once
  if (now && !sequence.length && !layers.length) return stopAmbient();
  emit();
}

/** A sound removed: stops it if it's the one playing. */
export function dropAmbientSound(soundId: number) {
  if (now?.soundId === soundId) stopAmbient();
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
