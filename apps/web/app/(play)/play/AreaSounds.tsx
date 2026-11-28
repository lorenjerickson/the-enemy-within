"use client";

import { useEffect, useRef } from "react";
import { master, useSoundPrefs } from "@/lib/soundPrefs";

/** The GM's areas' sounds (crackling fire, hissing gas): each loops on the GM's screen while its area is on, and stops when it's removed or runs out. */
export default function AreaSounds({ sounds, player = false }: { sounds: { id: number; url: string }[]; player?: boolean }) {
  const playing = useRef(new Map<number, HTMLAudioElement>());
  const prefs = useSoundPrefs(); // a player's own volume (the GM's screen plays at full)
  const gain = player ? master() : 1;
  const key = sounds.map((s) => `${s.id}:${s.url}`).join();
  useEffect(() => {
    const now = playing.current;
    for (const [id, a] of now) if (!sounds.some((s) => s.id === id)) { a.pause(); now.delete(id); }
    for (const s of sounds) if (!now.has(s.id)) {
      const a = new Audio(s.url);
      a.loop = true;
      a.play().catch(() => {}); // the browser may wait for a first click
      now.set(s.id, a);
    }
    for (const a of now.values()) { a.volume = 0.6 * gain; if (gain > 0 && a.paused) a.play().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefs]);
  useEffect(() => () => { for (const a of playing.current.values()) a.pause(); }, []);
  return null;
}
