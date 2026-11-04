/** Game time as "Day N, HH:MM" (day 1 starts at minute 0). */
export function formatGameTime(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1;
  const m = Math.floor(minutes % 1440);
  return `Day ${day}, ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
