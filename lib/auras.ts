/**
 * Auras: an effect's aura modifier gives a condition to creatures within so many feet of whoever has it (its own,
 * from gear, or from a condition on it), following it as it moves. The condition lasts while they're within it and
 * ends as they leave. A condition with a save as it lands is rolled on entering; passing keeps them safe until they
 * leave and come back (a "pass", kept per creature and condition). The same condition from two auras counts once.
 */
import { modifiersOf, type Affliction, type Condition, type Modifier } from "@/lib/conditions";
import { fits, relation, type Allegiance } from "@/lib/sides";
import { FEET_PER_SQUARE } from "@/lib/movement";

export type AuraModifier = Extract<Modifier, { kind: "aura" }>;
type Pos = { col: number; row: number };

/** Auras a creature gives off now: its standing ones, and those of conditions on it (not ones it only has from another's aura). */
export const aurasOf = (standing: AuraModifier[], list: Affliction[] = []): (AuraModifier & { given: Condition })[] =>
  [...standing, ...list.filter((a) => a.aura == null).flatMap((a) => modifiersOf(a.condition))].filter(
    (m): m is AuraModifier & { given: Condition } => m.kind === "aura" && !!m.given,
  );

/** Whether `b` is within `radius` ft of `a` (squares on a grid count like moving: diagonals are 5 ft). */
export function withinFeet(a: Pos, b: Pos, radius: number, gridless: boolean): boolean {
  const squares = gridless ? Math.hypot(a.col - b.col, a.row - b.row) : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  return squares * FEET_PER_SQUARE <= radius + 1e-6;
}

/** Who should be getting which aura condition now, as "token:condition" → the condition and whose aura it is (the nearest). */
export function auraWants(o: {
  ids: number[];
  where: (id: number) => Pos | undefined;
  allegiance: (id: number) => Allegiance;
  down: Set<number>;
  standing: (id: number) => AuraModifier[];
  afflicted: Map<number, Affliction[]>;
  gridless: boolean;
}): Map<string, { target: number; source: number; condition: Condition }> {
  const out = new Map<string, { target: number; source: number; condition: Condition; d: number }>();
  for (const source of o.ids) {
    const from = o.where(source);
    if (!from || o.down.has(source)) continue;
    for (const aura of aurasOf(o.standing(source), o.afflicted.get(source))) {
      for (const target of o.ids) {
        const at = o.where(target);
        if (!at || o.down.has(target)) continue;
        if (target === source ? !aura.self : !fits(aura.who, relation(o.allegiance(source), o.allegiance(target)))) continue;
        if (!withinFeet(from, at, aura.radius, o.gridless)) continue;
        const key = `${target}:${aura.given.id}`, d = Math.hypot(from.col - at.col, from.row - at.row);
        if (!out.has(key) || d < out.get(key)!.d) out.set(key, { target, source, condition: aura.given, d });
      }
    }
  }
  return new Map([...out].map(([k, { d: _d, ...w }]) => [k, w]));
}

/**
 * Brings aura conditions in line with who's where: those no longer within an aura lose its condition (`leave`),
 * passes of those who left are forgotten, and those newly within get it (`enter`, which returns false when they
 * pass its save: they're safe until they leave).
 */
export function syncAuras(
  afflicted: Map<number, Affliction[]>,
  wants: Map<string, { target: number; source: number; condition: Condition }>,
  passes: Set<string>,
  enter: (target: number, c: Condition, source: number) => boolean,
  leave: (target: number, a: Affliction) => void,
) {
  for (const [id, list] of [...afflicted]) for (const a of [...list]) if (a.aura != null && !wants.has(`${id}:${a.condition.id}`)) leave(id, a);
  for (const key of [...passes]) if (!wants.has(key)) passes.delete(key);
  for (const [key, w] of wants) {
    if (passes.has(key) || (afflicted.get(w.target) ?? []).some((a) => a.aura != null && a.condition.id === w.condition.id)) continue;
    if (!enter(w.target, w.condition, w.source)) passes.add(key);
  }
}

/** An aura condition as it sits on a creature: no rounds of its own (kept at 1; it never ticks down). */
export const auraAffliction = (c: Condition, source: number): Affliction => ({ condition: c, left: 1, by: source, aura: source });
