/**
 * Speeds as distance over time, each in its own units: "5 ft/s", "60 ft/round", "70 mph" (mi/h), "8 m/s". The rules
 * work in feet per second; a round is 6 seconds. Old speeds were plain numbers: feet per round (30 = 5 ft/s).
 */

export const DISTANCE_UNITS = ["ft", "yd", "m", "mi", "km"] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export const TIME_UNITS = ["s", "round", "min", "h"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export interface Speed {
  value: number;
  dist: DistanceUnit;
  per: TimeUnit;
}

const FEET: Record<DistanceUnit, number> = { ft: 1, yd: 3, m: 3.28084, mi: 5280, km: 3280.84 };
const SECONDS: Record<TimeUnit, number> = { s: 1, round: 6, min: 60, h: 3600 };

export const ROUND_SECONDS_PER = SECONDS.round;

/** A speed from anything stored: a speed, or an old plain number (feet per round). Junk reads as 0 ft/s. */
export function asSpeed(v: unknown): Speed {
  if (typeof v === "number" && Number.isFinite(v)) return { value: v, dist: "ft", per: "round" };
  if (v && typeof v === "object") {
    const o = v as Partial<Speed>;
    const value = Number(o.value);
    return {
      value: Number.isFinite(value) ? value : 0,
      dist: (DISTANCE_UNITS as readonly string[]).includes(String(o.dist)) ? (o.dist as DistanceUnit) : "ft",
      per: (TIME_UNITS as readonly string[]).includes(String(o.per)) ? (o.per as TimeUnit) : "s",
    };
  }
  return { value: 0, dist: "ft", per: "s" };
}

/** Feet per second. */
export const feetPerSecond = (s: Speed) => (s.value * FEET[s.dist]) / SECONDS[s.per];

/** The same speed in other units. */
export const convertSpeed = (s: Speed, dist: DistanceUnit, per: TimeUnit): Speed => ({ value: (feetPerSecond(s) * SECONDS[per]) / FEET[dist], dist, per });

/** A speed of so many feet per second. */
export const ftPerSec = (n: number): Speed => ({ value: n, dist: "ft", per: "s" });

/** "5 ft/s", "70 mph", "60 ft/round" (to two decimals at most). */
export function formatSpeed(s: Speed): string {
  const n = Math.round(s.value * 100) / 100;
  if (s.dist === "mi" && s.per === "h") return `${n} mph`;
  if (s.dist === "km" && s.per === "h") return `${n} km/h`;
  return `${n} ${s.dist}/${s.per}`;
}
