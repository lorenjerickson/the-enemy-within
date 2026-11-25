/**
 * Exposure to a lingering area's harm (fire, poison…; the areas design, Q4–Q5): staying in it makes it worse each
 * interval (its damage plus the build-up so far), and after leaving it keeps landing, less each interval (the decay),
 * until it's gone. One per creature per kind of harm: a second fire doesn't stack, it just keeps them building up.
 * An interval is a round (6 s), or 6 s walked out of combat.
 */
export interface Exposure {
  kind: string; // the harm: the area's damage type (else its name)
  extra: number; // added to its damage next interval inside
  last: number; // what it did last interval: after leaving, the next one does this less the decay
  buildUp: number; // added each interval inside
  decay: number; // taken off each interval after leaving
  source: string; // the area's name (for what they're told)
}

export type Exposures = Map<number, Exposure[]>; // per token

/** A lingering area's kind of harm. */
export const harmOf = (l: { damageType?: string; name: string }) => l.damageType || l.name;

/** The build-up so far for this kind (what to add to the area's damage this interval). */
export const exposureExtra = (all: Exposures, id: number, kind: string) => all.get(id)?.find((e) => e.kind === kind)?.extra ?? 0;

/** An interval inside a lingering area did `dealt` damage: exposure builds (or starts). */
export function exposedInside(all: Exposures, id: number, l: { damageType?: string; name: string; buildUp?: number; decay?: number }, dealt: number): void {
  const kind = harmOf(l), list = all.get(id) ?? [], was = list.find((e) => e.kind === kind);
  const buildUp = l.buildUp ?? 1, decay = Math.max(1, l.decay ?? 2);
  const next: Exposure = { kind, extra: (was?.extra ?? 0) + buildUp, last: dealt, buildUp, decay, source: l.name };
  all.set(id, [...list.filter((e) => e !== was), next]);
}

/** An interval after leaving: what it does now (the last less the decay), and whether it's over. */
export function decayed(e: Exposure): { damage: number; next: Exposure | null } {
  const damage = Math.max(0, e.last - e.decay);
  return { damage, next: damage - e.decay > 0 ? { ...e, last: damage } : null }; // the next would do nothing: over now
}
