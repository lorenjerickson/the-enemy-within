/** Min/max of a dice formula like "2d6", "d8-1" or "3d4+2" (also plain numbers like "+2"). */
export function diceRange(formula: string): { min: number; max: number } {
  const m = formula.replace(/\s/g, "").match(/^([+-]?)(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) {
    const n = Number(formula) || 0;
    return { min: n, max: n };
  }
  const sign = m[1] === "-" ? -1 : 1;
  const count = Number(m[2] || 1);
  const sides = Number(m[3]);
  const flat = Number(m[4] ?? 0);
  const [lo, hi] = [count + flat, count * sides + flat].map((v) => v * sign);
  return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/** Combined formula and range of several formulas, e.g. "3d4 + 2d6" = 5–24. */
export function sumDice(formulas: string[]): { formula: string; min: number; max: number } {
  const ranges = formulas.map(diceRange);
  return {
    formula: formulas.join(" + ").replace(/\+ -/g, "- "),
    min: ranges.reduce((s, r) => s + r.min, 0),
    max: ranges.reduce((s, r) => s + r.max, 0),
  };
}
