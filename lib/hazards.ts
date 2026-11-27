/**
 * Hazards (backlog X, claude/hazards-design.md): one kind of thing on the map for what traps and areas did. A hazard
 * is a lasting area plus how it's set off: always active (while on, until it ends), or dormant until triggered (by
 * someone stepping in, starting or ending a round in it, or by a map trigger), then active for an instant, a while, or
 * until switched off. Pure rules: whether it's active, whether a moment sets it off, whom it may catch, springing it,
 * and who sees it. Play (walks, rounds) and the editor use these.
 */
import { NO_SAVE_DC, UNTIL_REMOVED, areaFromDrawn, type AreaFires, type LastingArea } from "@/lib/aoe";
import type { Attribute } from "@/lib/attributes";
import type { Condition } from "@/lib/conditions";
import type { Allegiance } from "@/lib/sides";
import { canSpring, type Trap, type TrapOften, type TrapWho } from "@/lib/traps";

export type SetOffBy = "enter" | "start" | "end"; // someone coming into it, starting a round in it, ending a round (or move) in it

/** What a hazard adds to a lasting area (all optional: an area as it was is an always-active hazard). */
export interface HazardSettings {
  activation?: "always" | "dormant"; // default always
  setOffBy?: SetOffBy[]; // dormant: what someone does to set it off (none: only a map trigger can)
  byTrigger?: boolean; // dormant: a map trigger can set it off
  activeFor?: "instant" | "time" | "untilOff"; // once triggered (default instant)
  activeMinutes?: number; // "time": how long, in game minutes (a round is 0.1)
  activeUntil?: number; // triggered: active until this game time (set when it springs)
  who?: TrapWho; // anyone / the party / their enemies
  often?: TrapOften; // once / once per creature / every time (default every time)
  sprung?: number[]; // the tokens it has gone off on (0: on no one)
  stops?: boolean; // stops whoever sets it off
  seenBy?: number[]; // characters who saw it go off (they see it now)
  soundHidden?: boolean; // its sound plays even before it's found (a cue something is there)
  spent?: boolean; // a "once" hazard that has gone off: gone from the map
  noLook?: boolean; // drawn as an outline only, no animated look (a pit, a tripwire)
}

export type Hazard = LastingArea & HazardSettings;

/** Whether it's doing anything at `now` (game minutes): on, not spent, and always active until it ends, or triggered and still active. */
export function isActive(h: Hazard, now: number): boolean {
  if (h.off || h.spent || now >= h.ends) return false;
  if ((h.activation ?? "always") === "always") return true;
  return h.activeUntil !== undefined && now < h.activeUntil;
}

/** Whether someone doing `what` there sets a dormant hazard off. */
export const setsOff = (h: Hazard, what: SetOffBy): boolean => h.activation === "dormant" && !h.off && !h.spent && (h.setOffBy ?? []).includes(what);

/** Whether it may go off on (or catch) this token: who it's for, and how often (once / once each / every time). */
export const mayCatch = (h: Hazard, tokenId: number, side: Allegiance): boolean =>
  canSpring({ who: h.who ?? "", often: h.often ?? "always", sprung: h.sprung ?? [] }, tokenId, side);

/** Whether, while active, it catches whoever does `when` (comes in, starts or ends a round in it, stays in it, leaves). */
export const catchesWhen = (h: Hazard, now: number, when: AreaFires): boolean => isActive(h, now) && (h.fires ?? ["end"]).includes(when);

/**
 * It goes off on `on` (none: a map trigger set it off with no one in it) at `now`: they're remembered (once each), it
 * stays active for its time, and a "once" hazard is spent. Who saw it go off is the caller's to add (sight).
 */
export function spring(h: Hazard, on: number[], now: number): Hazard {
  const sprung = [...(h.sprung ?? []), ...(on.length ? on : [0])];
  const activeUntil = h.activeFor === "time" ? now + (h.activeMinutes ?? 0.1) : h.activeFor === "untilOff" ? UNTIL_REMOVED : h.activeUntil;
  return { ...h, sprung, activeUntil, spent: h.often === "once" ? true : h.spent };
}

/** Re-armed: back to dormant, it has gone off on no one. A spent "once" hazard doesn't re-arm. */
export const rearm = (h: Hazard): Hazard => (h.spent ? h : { ...h, sprung: [], activeUntil: undefined });

/** Whether a player's character sees it: always (shown), once triggered or found (hidden: found, or saw it go off), never (GM only). */
export function seenBy(h: Hazard, tokenId: number): boolean {
  if (h.spent || h.off) return false;
  const v = h.visibility ?? "shown";
  return v === "shown" || (v === "hidden" && (!!h.found || (h.seenBy ?? []).includes(tokenId)));
}

/** Whether a player near it hears its sound: when they can see it, or always with "play sound while hidden". */
export const heardBy = (h: Hazard, tokenId: number, now: number): boolean => !!h.sound && !h.off && !h.spent && now < h.ends && h.visibility !== "gm" && (seenBy(h, tokenId) || !!h.soundHidden); // a dormant one too (a hiss before the gas)

/**
 * A trap as a hazard (the one-time move from the Traps layer): dormant, set off by what set it off (none: only a map
 * trigger), an instant, the same who / how often / stops, found as it was, its damage and save, its effects (copies,
 * from `conditionOf`). Null for a "once" trap that has already gone off: it's spent.
 */
export function hazardFromTrap(t: Trap, conditionOf: (id: number) => Condition | undefined): Omit<Hazard, "id"> | null {
  if (t.often === "once" && t.sprung.length) return null;
  const setOffBy = t.springs.filter((s): s is SetOffBy => s === "enter" || s === "start" || s === "end");
  return {
    name: t.name, look: "fog", noLook: true, area: areaFromDrawn(t.area), drawn: true, ends: UNTIL_REMOVED,
    damage: t.damage || null, damageType: t.damage_type || undefined, save: (t.save_attr || "agility") as Attribute, dc: t.save_attr ? t.save_dc : NO_SAVE_DC, half: !!t.save_half,
    conditions: t.effects.flatMap((id) => { const c = conditionOf(id); return c ? [c] : []; }),
    activation: "dormant", setOffBy, byTrigger: true, activeFor: "instant", fires: ["enter"],
    who: t.who, often: t.often, sprung: [...t.sprung], stops: !!t.stops,
    visibility: "hidden", findDc: t.find_dc, found: !!t.found, seenBy: [...(t.seen_by ?? [])],
  };
}
