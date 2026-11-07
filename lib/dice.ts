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

// Dice a player has already thrown (in order), used by rollDice before any random ones: a planned attack's dice
// rolled with the plan are spent when the attack lands. A die that doesn't fit (wrong sides) is rolled afresh.
let thrown: number[] | null = null;

/** Runs `f` with these dice to draw on first (any left over are ignored). */
export function usingDice<T>(dice: number[] | undefined, f: () => T): T {
  const before = thrown;
  thrown = dice ? [...dice] : null;
  try {
    return f();
  } finally {
    thrown = before;
  }
}

const die = (sides: number) => {
  if (thrown?.length && Number.isInteger(thrown[0]) && thrown[0] >= 1 && thrown[0] <= sides) return thrown.shift()!;
  thrown = null; // out of step: the rest are random
  return 1 + Math.floor(Math.random() * sides);
};

/** Rolls a dice formula such as "1d20+2" or "3d4 + 2d6 - 1" and returns the total. */
export function rollDice(formula: string): number {
  const terms = formula.replace(/\s/g, "").match(/[+-]?[^+-]+/g);
  if (!terms) throw new Error(`Not a dice formula: ${formula}`);
  return terms.reduce((total, term) => {
    const m = term.match(/^([+-]?)(?:(\d*)d(\d+)|(\d+))$/i);
    if (!m) throw new Error(`Not a dice formula: ${formula}`);
    const sign = m[1] === "-" ? -1 : 1;
    if (m[4]) return total + sign * Number(m[4]);
    let sum = 0;
    for (let i = 0; i < Number(m[2] || 1); i++) sum += die(Number(m[3]));
    return total + sign * sum;
  }, 0);
}
