"use client";

import { useEffect, useRef } from "react";
import { playOnce, playSequence, setAmbientVolume, stopAmbient } from "@/lib/ambientPlayer";
import type { SharedAmbient as Shared } from "@/lib/db"; // type only

/**
 * Plays on a player's screen whatever ambient sound the GM is playing on their level (each new play starts it again;
 * a volume change just changes it). Browsers refuse sound until the page has been clicked: then it starts.
 */
export default function SharedAmbient({ ambient }: { ambient: Shared }) {
  const rev = useRef<number | null>(null);
  const start = (a: Shared) => {
    if (!a || (!a.once && !a.loop.length && !a.layer.length)) return stopAmbient();
    if (a.once) playOnce(-1, a.once, a.volume);
    else playSequence(-1, a.loop, a.volume, a.layer);
  };
  useEffect(() => {
    if (!ambient) { if (rev.current !== null) stopAmbient(); rev.current = null; return; }
    if (ambient.rev !== rev.current) { rev.current = ambient.rev; start(ambient); }
    else setAmbientVolume(ambient.volume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient?.rev, ambient?.volume]);
  // A browser that refused to play before the page was clicked: start on the first click.
  const latest = useRef(ambient);
  latest.current = ambient;
  useEffect(() => {
    const unlock = () => { if (latest.current) start(latest.current); };
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => stopAmbient(), []);
  return null;
}
