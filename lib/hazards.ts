/**
 * Hazards (backlog X, claude/hazards-design.md): one kind of thing on the map for what traps and areas did. A hazard
 * is a lasting area plus how it's set off: always active (while on, until it ends), or dormant until triggered (by
 * someone stepping in, starting or ending a round in it, or by a map trigger), then active for an instant, a while, or
 * until switched off. Pure rules: whether it's active, whether a moment sets it off, whom it may catch, springing it,
 * and who sees it. Play (walks, rounds) and the editor use these.
 */
import { NO_SAVE_DC, UNTIL_REMOVED, areaFromDrawn, inArea, type AreaFires, type LastingArea } from "@/lib/aoe";
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
  traits?: Trait[]; // what the place itself does to moving (ice, deep water, a chasm)
  obscures?: boolean; // fog, smoke: no one sees further than 15 ft into it (sight, fog of war, targets, Hide's blind spots)
  activatesWhen?: string; // a script condition: switched on when it becomes true (game.vars.sluiceOpen)
  deactivatesWhen?: string; // a script condition: switched off when it becomes true
  whenHeld?: { activates?: boolean; deactivates?: boolean }; // how those conditions stood at the last check (they act as one becomes true)
}

export type Hazard = LastingArea & HazardSettings;

/** What a place does to moving through it (the areas design, 2.4), and what each says in the interview. */
export const TRAITS = [["frozen", "Frozen (ice): moving in it costs double"]] as const;
export type Trait = (typeof TRAITS)[number][0];

/** Whether a spot (grid units) is in an active hazard with this trait. */
export const traitAt = (hazards: Hazard[], trait: Trait, p: { x: number; y: number }, now: number) =>
  hazards.some((h) => (h.traits ?? []).includes(trait) && isActive(h, now) && inArea(h.area, p));

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

/** A hazard's area in the shapes traps were drawn in (circle, rectangle, tripwire): the round engine's trap zones. */
export function trapAreaOf(a: Hazard["area"]): Trap["area"] {
  if (a.shape === "rect") return { shape: "rect", x: a.origin.x - (a.w ?? a.size * 2) / 2, y: a.origin.y - (a.h ?? a.size * 2) / 2, w: a.w ?? a.size * 2, h: a.h ?? a.size * 2 };
  if (a.shape === "line") return { shape: "line", x1: a.origin.x, y1: a.origin.y, x2: a.origin.x + Math.cos(a.dir) * a.size, y2: a.origin.y + Math.sin(a.dir) * a.size };
  return { shape: "circle", x: a.origin.x, y: a.origin.y, r: a.size };
}

/**
 * A dormant hazard as the round engine's trap (until rounds read hazards directly): springs as it's set off, once /
 * each / every time, stops, its damage and save, its effects (`given`). Its id is the hazard's, negated, so what sprang
 * in the round goes back to the hazard.
 */
export function asRoundTrap(h: Hazard): Trap & { given: Condition[] } {
  return {
    id: -h.id, name: h.name, area: trapAreaOf(h.area), springs: h.setOffBy ?? [], who: h.who ?? "", often: h.often ?? "always",
    damage: h.damage, damage_type: h.damageType ?? "", save_attr: h.dc < NO_SAVE_DC ? h.save : "", save_dc: h.dc, save_half: h.half ? 1 : 0,
    effects: [], stops: h.stops ? 1 : 0, find_dc: h.findDc ?? 14, found: h.found ? 1 : 0, seen_by: h.seenBy ?? [], sprung: h.sprung ?? [], given: h.conditions ?? [],
  };
}
