export const ATTRIBUTES = ["might", "intellect", "wisdom", "charisma", "fortitude", "sanity", "agility"] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export const MIN_SCORE = 1;
export const MAX_SCORE = 20;

/** D&D-style modifier: 10–11 = 0, each 2 points above/below adds/subtracts 1. */
export const modifier = (score: number) => Math.floor((score - 10) / 2);
export const formatModifier = (m: number) => (m >= 0 ? `+${m}` : `${m}`);

/** 4d6, drop the lowest. */
export function rollScore(): number {
  const dice = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

/** D&D 5e point buy: scores 8–15, 27 points. */
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const pointBuySpent = (a: Attributes) =>
  ATTRIBUTES.reduce((sum, k) => sum + (POINT_BUY_COST[a[k]] ?? Infinity), 0);

export const defaultAttributes = (score = 10): Attributes =>
  Object.fromEntries(ATTRIBUTES.map((k) => [k, score])) as Attributes;
