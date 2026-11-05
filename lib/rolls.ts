import { ATTRIBUTES, SKILLS_BY_ATTRIBUTE, formatModifier, modifier, type Attributes } from "@/lib/attributes";
import type { RollMode } from "@/lib/actions";

/** One contribution to a roll: dice ("1d20", "1d4") or a flat number ("2", "-1"), and where it comes from. */
export interface RollPart {
  formula: string;
  source: string;
}

/** A roll someone has to make: what it's for, its parts, and advantage / disadvantage (on the d20). */
export interface RollSpec {
  label: string;
  parts: RollPart[];
  mode: RollMode;
}

/** A rolled part: the dice that came up (a kept d20 first when rolling with advantage/disadvantage) and its value. */
export interface RolledPart extends RollPart {
  dice: number[];
  dropped?: number; // the other d20, with advantage / disadvantage
  value: number;
}

const signed = (f: string) => (/^[+-]/.test(f) ? f : `+${f}`);

/** "1d20 + 2 + 1d4 − 1": the whole formula as players read it. */
export function formulaText(spec: RollSpec): string {
  return spec.parts
    .map((p, i) => (i === 0 ? p.formula : signed(p.formula).replace(/^([+-])/, " $1 ")))
    .join("")
    .replace(/-/g, "−");
}

/** A part's dice, e.g. "1d20" → { count: 1, sides: 20, sign: 1 }; null for a flat number. */
export function partDice(formula: string): { count: number; sides: number; sign: 1 | -1 } | null {
  const m = formula.replace(/\s/g, "").match(/^([+-]?)(\d*)d(\d+)$/i);
  return m ? { count: Number(m[2] || 1), sides: Number(m[3]), sign: m[1] === "-" ? -1 : 1 } : null;
}

/** Which part is the d20 that advantage / disadvantage applies to (the first single d20), or -1. */
export const d20Part = (spec: RollSpec) => spec.parts.findIndex((p) => { const d = partDice(p.formula); return d?.count === 1 && d.sides === 20; });

/**
 * What to throw for each part, in order (for the dice roller): the d20 doubles with advantage / disadvantage.
 * Flat parts throw nothing.
 */
export function diceToThrow(spec: RollSpec): ({ count: number; sides: number } | null)[] {
  const adv = spec.mode !== "normal" ? d20Part(spec) : -1;
  return spec.parts.map((p, i) => {
    const d = partDice(p.formula);
    return d && { count: i === adv ? 2 : d.count, sides: d.sides };
  });
}

/** Scores thrown dice (one list per part, as diceToThrow asked); null if they don't fit the roll. */
export function scoreRoll(spec: RollSpec, thrown: number[][]): { total: number; parts: RolledPart[] } | null {
  const want = diceToThrow(spec);
  if (thrown.length !== want.length) return null;
  const parts: RolledPart[] = [];
  for (let i = 0; i < want.length; i++) {
    const p = spec.parts[i], w = want[i], got = thrown[i] ?? [];
    if (!w) {
      if (got.length) return null;
      parts.push({ ...p, dice: [], value: Number(p.formula) || 0 });
      continue;
    }
    if (got.length !== w.count || got.some((v) => !Number.isInteger(v) || v < 1 || v > w.sides)) return null;
    const sign = partDice(p.formula)!.sign;
    if (w.count === 2 && partDice(p.formula)!.count === 1) {
      const keep = spec.mode === "advantage" ? Math.max(...got) : Math.min(...got);
      parts.push({ ...p, dice: [keep], dropped: keep === got[0] ? got[1] : got[0], value: sign * keep });
    } else {
      parts.push({ ...p, dice: got, value: sign * got.reduce((a, v) => a + v, 0) });
    }
  }
  return { total: parts.reduce((a, p) => a + p.value, 0), parts };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A skill check: d20, the best attribute modifier for the skill, and any profession modifiers to it.
 * Zero modifiers are left out so the formula stays short (the breakdown says so).
 */
export function skillCheck(
  skill: string,
  attributes: Attributes,
  professionMods: { profession: string; value: string }[],
  mode: RollMode = "normal",
): RollSpec {
  const attrs = ATTRIBUTES.filter((a) => SKILLS_BY_ATTRIBUTE[a].includes(skill));
  const best = attrs.reduce((b, a) => (modifier(attributes[a]) > modifier(attributes[b]) ? a : b), attrs[0]);
  const parts: RollPart[] = [{ formula: "1d20", source: `${cap(skill)} check` }];
  if (best) {
    const m = modifier(attributes[best]);
    if (m !== 0) parts.push({ formula: String(m), source: `${cap(best)} ${attributes[best]} (${formatModifier(m)})` });
  }
  for (const p of professionMods) if (p.value.trim() && p.value.trim() !== "0") parts.push({ formula: p.value.replace(/^\+/, "").trim(), source: p.profession });
  return { label: `${cap(skill)} check`, parts, mode };
}

/** Initiative: d20 + agility modifier. */
export function initiativeRoll(attributes: Attributes, mode: RollMode = "normal"): RollSpec {
  const m = modifier(attributes.agility ?? 10);
  const parts: RollPart[] = [{ formula: "1d20", source: "Initiative" }];
  if (m !== 0) parts.push({ formula: String(m), source: `Agility ${attributes.agility} (${formatModifier(m)})` });
  return { label: "Roll initiative", parts, mode };
}

/** Rolls a spec on the server, for the GM's creatures (players roll their own dice). */
export function rollSpec(spec: RollSpec): { total: number; parts: RolledPart[] } {
  const thrown = diceToThrow(spec).map((t) => (t ? Array.from({ length: t.count }, () => 1 + Math.floor(Math.random() * t.sides)) : []));
  return scoreRoll(spec, thrown)!;
}
