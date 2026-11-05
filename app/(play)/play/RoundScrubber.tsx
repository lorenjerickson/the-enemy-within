"use client";

import { setScrub, useScrub } from "./scrub";

/** GM only: step backwards and forwards through the last resolved round's seconds on their own map (players unaffected). */
export default function RoundScrubber({ round, seconds }: { round: number; seconds: number }) {
  const at = useScrub();
  const show = (s: number) => setScrub(Math.max(0, Math.min(seconds, s)));
  return (
    <div className="space-y-1 rounded-box bg-base-100/50 p-2" data-scrubber>
      <div className="flex items-center gap-1 text-xs">
        <span className="font-semibold">Round {round} replay</span>
        <span className="ml-auto opacity-70">{at === null ? "live" : at === 0 ? "before it" : `${at} s`}</span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-xs" aria-label="Back a second" disabled={at === 0} onClick={() => show((at ?? seconds) - 1)}>◀</button>
        <input
          type="range"
          min={0}
          max={seconds}
          step={1}
          aria-label="Second of the round"
          value={at ?? seconds}
          onChange={(e) => show(Number(e.target.value))}
          className="range range-xs flex-1"
        />
        <button type="button" className="btn btn-xs" aria-label="Forward a second" disabled={at === null || at >= seconds} onClick={() => show((at ?? seconds) + 1)}>▶</button>
        <button type="button" className={`btn btn-xs ${at === null ? "btn-disabled" : ""}`} onClick={() => setScrub(null)}>Live</button>
      </div>
    </div>
  );
}
