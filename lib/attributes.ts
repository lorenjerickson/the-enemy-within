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

/** Skills inherit the modifier of their attribute. */
export const SKILLS_BY_ATTRIBUTE: Record<Attribute, string[]> = {
  might: ["athletics"],
  agility: ["acrobatics", "sleight of hand", "stealth", "pilot"],
  intellect: ["academia", "engineering", "technology", "investigation", "medicine", "nature"],
  wisdom: ["animal handling", "insight", "perception", "folklore"],
  fortitude: ["survival", "medicine", "nature"],
  charisma: ["deception", "etiquette", "intimidation", "persuasion"],
  sanity: ["psychiatry", "determination"],
};

export interface SkillModifier {
  skill: string;
  attributes: Attribute[];
  modifier: number;
}

/** Skill modifiers, alphabetical. A skill under several attributes (medicine, nature) uses the best one. */
export function skillModifiers(a: Attributes): SkillModifier[] {
  const skills = new Map<string, SkillModifier>();
  for (const attr of ATTRIBUTES) {
    for (const skill of SKILLS_BY_ATTRIBUTE[attr]) {
      const existing = skills.get(skill);
      const m = modifier(a[attr]);
      if (existing) {
        existing.attributes.push(attr);
        existing.modifier = Math.max(existing.modifier, m);
      } else {
        skills.set(skill, { skill, attributes: [attr], modifier: m });
      }
    }
  }
  return [...skills.values()].sort((x, y) => x.skill.localeCompare(y.skill));
}
