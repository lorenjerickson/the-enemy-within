/**
 * Whose side a token is on, for actions aimed at friendlies or enemies. Each token has an allegiance: player
 * characters default to the party, the GM's creatures to hostile; the GM can set any token (an allied NPC, a charmed
 * rat, a neutral bystander).
 */
export type Allegiance = "party" | "hostile" | "neutral";
export const ALLEGIANCES: Allegiance[] = ["party", "hostile", "neutral"];

/** A token's allegiance: as set, else party for a character, hostile for a creature. */
export const allegianceOf = (t: { allegiance?: string | null; character_id: number | null }): Allegiance =>
  (ALLEGIANCES as string[]).includes(t.allegiance ?? "") ? (t.allegiance as Allegiance) : t.character_id ? "party" : "hostile";

/** How `other` stands to `me`: the same side is friendly, party and hostile are enemies, neutral is neither. */
export function relation(me: Allegiance, other: Allegiance): "friendly" | "enemy" | "neutral" {
  if (me === "neutral" || other === "neutral") return me === other ? "friendly" : "neutral";
  return me === other ? "friendly" : "enemy";
}

/** Who an action can be aimed at: anyone, friendlies or enemies; how many: one, exactly N, up to N, or all. */
export type TargetWho = "" | "friendly" | "enemy";
export type TargetCount = "one" | "exactly" | "upto" | "all";
export interface Targeting {
  who: TargetWho;
  count: TargetCount;
  n: number;
}

/** Whether a token of this relation fits who the action is for. */
export const fits = (who: TargetWho, rel: "friendly" | "enemy" | "neutral") => who === "" || who === rel;

/** "up to 3 enemies", "all friendlies", "one creature"… */
export function describeTargeting(t: Targeting, area: boolean): string {
  const noun = t.who === "friendly" ? "friendl" : t.who === "enemy" ? "enem" : "creature";
  const plural = t.who ? `${noun}ies` : "creatures", single = t.who ? `${noun}y` : "creature";
  const how = t.count === "all" ? `all ${plural}` : t.count === "one" ? `one ${single}` : `${t.count === "upto" ? "up to" : "exactly"} ${t.n} ${t.n === 1 ? single : plural}`;
  return `${how} ${area ? "in its area" : "in range"}`;
}

/** Whether the player picks several targets (exactly / up to N). */
/** Picking several (exactly / up to N, for N above 1): "exactly 1" or "up to 1" is just one target, picked with a click. */
export const picksSeveral = (t?: Targeting) => !!t && (t.count === "exactly" || t.count === "upto") && t.n > 1;
/** The most targets they may pick (one for "one"; all: no limit). */
export const maxPicks = (t?: Targeting) => (!t || t.count === "one" ? 1 : t.count === "all" ? Infinity : t.n);
