"use client";

import { useEffect, useState } from "react";

/**
 * Every round of this encounter so far, told from the player's side ("You close in on Giant Rat 1…"), newest first.
 * A round shows once its playback has ended (`showAt`, ms since epoch), so it doesn't give away what's coming.
 */
export default function RoundHistory({ rounds }: { rounds: { round: number; showAt: number; lines: string[] }[] }) {
  const [now, setNow] = useState(() => Date.now());
  const waiting = rounds.some((r) => r.showAt > now);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [waiting]);
  const shown = rounds.filter((r) => r.showAt <= now).sort((a, b) => b.round - a.round);
  if (!shown.length) return null;
  return (
    <section data-round-history className="space-y-1">
      <div className="text-xs font-semibold opacity-80">Earlier rounds</div>
      <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {shown.map((r, i) => (
          <li key={r.round} data-round-story={r.round} className={`rounded-box p-2 text-sm leading-relaxed ${i === 0 ? "bg-base-100/80" : "bg-base-100/40 opacity-80"}`}>
            <div className="text-xs font-semibold opacity-70">Round {r.round}{i === 0 ? " · latest" : ""}</div>
            <p>{r.lines.length ? r.lines.join(" ") : "You keep watch; nothing comes your way."}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
