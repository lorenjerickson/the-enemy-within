/** Game time as "Day N, HH:MM" (day 1 starts at minute 0). */
export function formatGameTime(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1;
  const m = Math.floor(minutes % 1440);
  return `Day ${day}, ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A span of game time, e.g. "2 d 3 h 10 m". */
export const formatSpan = (minutes: number) => {
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = Math.floor(minutes % 60);
  return [d && `${d} d`, h && `${h} h`, (m || (!d && !h)) && `${m} m`].filter(Boolean).join(" ");
};
