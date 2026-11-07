"use client";

import { useEffect, useState } from "react";

/**
 * After a round has played back: the player's own story of it ("You close in on Giant Rat 1…"), until they close it.
 * `showAt` is when the playback ends (ms since epoch).
 */
export default function RoundSummary({ round, showAt, lines }: { round: number; showAt: number; lines: string[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [closed, setClosed] = useState<number | null>(null);
  useEffect(() => {
    if (Date.now() >= showAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [showAt]);
  if (closed === round || now < showAt || now > showAt + 10 * 60_000) return null; // gone after ten minutes
  return (
    <div data-round-summary className="fixed bottom-16 left-1/2 z-30 w-[min(30rem,calc(100vw-7rem))] -translate-x-1/2 space-y-2 rounded-box bg-base-200/95 p-4 text-sm shadow-2xl backdrop-blur">
      <div className="flex items-center">
        <span className="font-semibold">Round {round}</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => setClosed(round)}>Close</button>
      </div>
      {lines.length ? (
        <p className="leading-relaxed">{lines.join(" ")}</p>
      ) : (
        <p className="opacity-70">You keep watch; nothing comes your way.</p>
      )}
    </div>
  );
}
