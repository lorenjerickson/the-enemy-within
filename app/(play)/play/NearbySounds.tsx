"use client";

import { useEffect, useRef } from "react";

import { loudnessAt, type Placed } from "@/lib/loudness";
import { master, useSoundPrefs } from "@/lib/soundPrefs";

/**
 * A player's speakers: the GM's looping placed sounds (a fountain, a forge), louder the nearer their token stands and
 * silent beyond each sound's reach. Browsers refuse sound until the page has been clicked: then they start.
 */
export default function NearbySounds({ sounds, at }: { sounds: Placed[]; at: { x: number; y: number } | null }) {
  const playing = useRef(new Map<number, HTMLAudioElement>());
  const prefs = useSoundPrefs(); // their own volume, mute, and whether sound is on
  const key = sounds.map((s) => `${s.id}:${s.url}:${s.x}:${s.y}:${s.radius}:${s.volume}`).join() + (at ? `@${at.x},${at.y}` : "");
  useEffect(() => {
    const now = playing.current;
    for (const [id, a] of now) if (!sounds.some((s) => s.id === id)) { a.pause(); now.delete(id); }
    for (const s of sounds) {
      const v = at ? loudnessAt(s, at) * master() : 0;
      let a = now.get(s.id);
      if (v <= 0) { a?.pause(); continue; }
      if (!a) { a = new Audio(s.url); a.loop = true; now.set(s.id, a); }
      a.volume = Math.min(1, v);
      if (a.paused) a.play().catch(() => {}); // the browser may wait for a first click
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefs]);
  useEffect(() => {
    const unlock = () => { for (const a of playing.current.values()) if (a.paused && a.volume > 0) a.play().catch(() => {}); };
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => { document.removeEventListener("pointerdown", unlock); for (const a of playing.current.values()) a.pause(); };
  }, []);
  return null;
}
