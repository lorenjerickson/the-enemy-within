"use client";

import { useTransition } from "react";
import { advanceTime } from "./actions";

/** Game time as "Day N, HH:MM" (day 1 starts at minute 0). */
export function formatGameTime(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1;
  const m = Math.floor(minutes % 1440);
  return `Day ${day}, ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Elapsed game time, e.g. "2 d 3 h 10 m". */
const formatSpan = (minutes: number) => {
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = Math.floor(minutes % 60);
  return [d && `${d} d`, h && `${h} h`, `${m} m`].filter(Boolean).join(" ");
};

const STEPS = [
  { label: "+10 min", minutes: 10 },
  { label: "+1 hour", minutes: 60 },
  { label: "+8 hours", minutes: 480 },
  { label: "+1 day", minutes: 1440 },
];

/** The game calendar: the current game time, buttons to move it forward, and running timers. */
export function CalendarPanel({ now, timers }: { now: number; timers: { name: string; started: number; duration: number | null }[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="rounded-box bg-base-200 p-3 space-y-2 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold" data-game-time>{formatGameTime(now)}</span>
        <span className="flex-1" />
        {STEPS.map((s) => (
          <button key={s.label} type="button" className="btn btn-xs" disabled={pending} onClick={() => startTransition(() => advanceTime(s.minutes))}>
            {s.label}
          </button>
        ))}
      </div>
      {timers.length > 0 && (
        <ul className="text-sm">
          {timers.map((t) => (
            <li key={t.name} className="flex gap-2">
              <span>⏱ {t.name}</span>
              <span className="opacity-60">{formatSpan(now - t.started)} elapsed</span>
              {t.duration !== null &&
                (now - t.started >= t.duration ? (
                  <span className="badge badge-warning badge-sm">expired</span>
                ) : (
                  <span className="opacity-60">· {formatSpan(t.duration - (now - t.started))} left</span>
                ))}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs opacity-60">Scripts: game.calendar.now, game.calendar.advance(2, &apos;hours&apos;), game.calendar.timers.start(&apos;name&apos;).expires(3, &apos;days&apos;).</p>
    </div>
  );
}
