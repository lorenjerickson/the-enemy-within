"use client";

import { useEffect, useRef } from "react";

/** The GM's areas' sounds (crackling fire, hissing gas): each loops on the GM's screen while its area is on, and stops when it's removed or runs out. */
export default function AreaSounds({ sounds }: { sounds: { id: number; url: string }[] }) {
  const playing = useRef(new Map<number, HTMLAudioElement>());
  const key = sounds.map((s) => `${s.id}:${s.url}`).join();
  useEffect(() => {
    const now = playing.current;
    for (const [id, a] of now) if (!sounds.some((s) => s.id === id)) { a.pause(); now.delete(id); }
    for (const s of sounds) if (!now.has(s.id)) {
      const a = new Audio(s.url);
      a.loop = true;
      a.volume = 0.6;
      a.play().catch(() => {}); // the browser may wait for a first click
      now.set(s.id, a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => { for (const a of playing.current.values()) a.pause(); }, []);
  return null;
}
