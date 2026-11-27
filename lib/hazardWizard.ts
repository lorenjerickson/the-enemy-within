/**
 * The hazard editor as an interview (backlog X, claude/hazards-design.md section 3): how it's set off, whom it
 * catches, who sees and hears it, what it does (damage, its save, effects, lingering, flammable) and how long it lasts. Answers to the hazard's settings and back, the questions that follow from them, presets, a short
 * line per answer, and the card in plain words. Pure: HazardInterview.tsx and the tests use it.
 */
import { NO_SAVE_DC, UNTIL_REMOVED, type AreaFires } from "@/lib/aoe";
import type { Attribute } from "@/lib/attributes";
import type { EffectKind } from "@/lib/effects";
import type { Hazard, SetOffBy } from "@/lib/hazards";
import type { TrapOften, TrapWho } from "@/lib/traps";

export type Preset = "trap" | "cloud" | "fire" | "ward";
export const PRESETS: [Preset, string, string][] = [
  ["trap", "Trap", "Hidden; set off by someone coming into it; once per creature; stops them."],
  ["cloud", "Cloud", "Always there for a while; catches whoever starts a round in it or stays in it."],
  ["fire", "Fire", "Always burning; catches whoever comes into it or ends a round in it; lingers."],
  ["ward", "Ward", "Always there; catches the party's enemies coming into it; only the GM sees it."],
];

export interface Answers {
  name: string;
  activation: "always" | "dormant";
  setOffBy: SetOffBy[];
  byTrigger: boolean;
  activeFor: "instant" | "time" | "untilOff";
  activeRounds: number; // "time": how many rounds it stays active once set off
  fires: AreaFires[]; // while active, it catches whoever…
  who: TrapWho;
  often: TrapOften;
  stops: boolean;
  visibility: "shown" | "hidden" | "gm";
  findDc: number;
  look: EffectKind | "none"; // none: an outline only (a pit)
  sound: number | null; // an audio asset
  soundHidden: boolean; // heard even before it's found
  damage: string;
  damageType: string;
  damageSave: boolean;
  saveAttr: Attribute;
  saveDc: number;
  half: boolean;
  effectIds: number[]; // catalog effects (copied onto the hazard when saved)
  lingers: boolean;
  buildUp: number;
  decay: number;
  flammable: boolean;
  lasts: number; // game minutes from now (0: until removed)
}

export type Question = "name" | "preset" | "activation" | "activeFor" | "catches" | "who" | "often" | "stops" | "visible" | "look" | "damage" | "effects" | "lingers" | "lasts";

/** The questions for these answers: presets only for a new hazard; how long it stays active only for a dormant one; whom it catches unless it acts for an instant. */
export function questions(a: Answers, isNew = false): Question[] {
  const dormantInstant = a.activation === "dormant" && a.activeFor === "instant";
  return ["name", ...(isNew ? (["preset"] as const) : []), "activation", ...(a.activation === "dormant" ? (["activeFor"] as const) : []), ...(dormantInstant ? [] : (["catches"] as const)), "who", "often", "stops", "visible", "look", "damage", "effects", "lingers", "lasts"];
}

/** The answers for a hazard as it is (`now`: game minutes, for how long it has left). */
export function answersFromHazard(h: Partial<Hazard>, now = 0): Answers {
  return {
    name: h.name ?? "", activation: h.activation ?? "always", setOffBy: h.setOffBy ?? (h.activation === "dormant" ? ["enter"] : []), byTrigger: !!h.byTrigger,
    activeFor: h.activeFor ?? "instant", activeRounds: Math.max(1, Math.round((h.activeMinutes ?? 1) * 10)),
    fires: h.fires ?? ["enter"], who: h.who ?? "", often: h.often ?? "always", stops: !!h.stops,
    visibility: h.visibility ?? "shown", findDc: h.findDc ?? 14, look: h.noLook ? "none" : h.look ?? "fog", sound: h.sound ?? null, soundHidden: !!h.soundHidden,
    damage: h.damage ?? "", damageType: h.damageType ?? "", damageSave: !!h.damage && (h.dc ?? NO_SAVE_DC) < NO_SAVE_DC, saveAttr: h.save ?? "agility", saveDc: (h.dc ?? NO_SAVE_DC) < NO_SAVE_DC ? h.dc! : 12, half: h.half ?? true,
    effectIds: (h.conditions ?? []).map((c) => c.id), lingers: !!h.lingers, buildUp: h.buildUp ?? 1, decay: h.decay ?? 2, flammable: !!h.flammable,
    lasts: h.ends === undefined || h.ends >= UNTIL_REMOVED ? 0 : Math.max(0.1, Math.round((h.ends - now) * 10) / 10),
  };
}

/** What the answers set on the hazard (the rest of it is kept as it is). */
export function hazardPatch(a: Answers): Partial<Hazard> {
  const dormant = a.activation === "dormant";
  return {
    name: a.name.trim() || "Hazard", activation: a.activation,
    setOffBy: dormant ? a.setOffBy : [], byTrigger: dormant && a.byTrigger,
    activeFor: dormant ? a.activeFor : "instant", activeMinutes: dormant && a.activeFor === "time" ? a.activeRounds / 10 : undefined,
    fires: a.fires.length ? a.fires : ["enter"], who: a.who, often: a.often, stops: a.stops,
    visibility: a.visibility, findDc: a.findDc, noLook: a.look === "none", ...(a.look !== "none" ? { look: a.look } : {}), sound: a.sound ?? undefined, soundHidden: !!a.sound && a.soundHidden,
    damage: a.damage.trim() || null, damageType: a.damageType || undefined, save: a.saveAttr, dc: a.damage.trim() && a.damageSave ? a.saveDc : NO_SAVE_DC, half: a.half,
    lingers: a.lingers, buildUp: a.buildUp, decay: a.decay, flammable: a.flammable,
  };
}

/** What the server finishes from the answers: the catalog effects to copy on, and when it ends (from its own game time). */
export const hazardExtras = (a: Answers) => ({ effectIds: a.effectIds, lasts: a.lasts });

/** A preset's answers (it only fills them in: everything stays editable). */
export function applyPreset(a: Answers, p: Preset): Answers {
  const base = { ...a, setOffBy: [] as SetOffBy[], byTrigger: false, activeFor: "instant" as const, who: "" as TrapWho, stops: false };
  if (p === "trap") return { ...base, activation: "dormant", setOffBy: ["enter"], byTrigger: true, often: "each", stops: true, visibility: "hidden", look: "none" };
  if (p === "cloud") return { ...base, activation: "always", fires: ["start", "inside"], often: "always", visibility: "shown", look: "fog" };
  if (p === "fire") return { ...base, activation: "always", fires: ["enter", "end"], often: "always", visibility: "shown", look: "fire", lingers: true };
  return { ...base, activation: "always", fires: ["enter"], who: "hostile", often: "always", visibility: "gm", look: "none" };
}

const SET_OFF: Record<SetOffBy, string> = { enter: "someone comes into it", start: "someone starts a round in it", end: "someone ends a round or a move in it" };
const FIRES: Record<AreaFires, string> = { enter: "comes into it", start: "starts a round in it", end: "ends a round in it", inside: "stays in it (its effects only while inside)", leave: "leaves it" };
export const SET_OFF_BY: [SetOffBy, string][] = Object.entries(SET_OFF) as [SetOffBy, string][];
export const CATCHES: [AreaFires, string][] = Object.entries(FIRES) as [AreaFires, string][];
const WHO: Record<TrapWho, string> = { "": "anyone", party: "the party", hostile: "the party's enemies" };
const OFTEN: Record<TrapOften, string> = { once: "once, then it's spent", each: "once for each creature", always: "every time" };
const or = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How it's set off, in words. */
const setOff = (a: Answers) => or([...a.setOffBy.map((s) => SET_OFF[s]), ...(a.byTrigger ? ["a map trigger sets it off"] : [])]) || "nothing sets it off yet";

/** Each answer in a few words, for the list of answers (click one to go back to it). */
export function answerLine(q: Question, a: Answers): [string, string] {
  switch (q) {
    case "name": return ["Name", a.name || "—"];
    case "preset": return ["Started from", "a preset (or by hand)"];
    case "activation": return ["Activation", a.activation === "always" ? "Always active" : `Waits until ${setOff(a)}`];
    case "activeFor": return ["Once set off", a.activeFor === "instant" ? "Acts once (an instant)" : a.activeFor === "time" ? `Active ${a.activeRounds} round${a.activeRounds === 1 ? "" : "s"}` : "Active until switched off"];
    case "catches": return ["Catches whoever", or(a.fires.map((f) => FIRES[f]))];
    case "who": return ["For", cap(WHO[a.who])];
    case "often": return ["How often", cap(OFTEN[a.often])];
    case "stops": return ["Stops them", a.stops ? "Yes" : "No"];
    case "visible": return ["Players see it", a.visibility === "shown" ? "Always" : a.visibility === "gm" ? "Never (GM only)" : `Once set off or found (Search DC ${a.findDc})`];
    case "look": return ["Look and sound", `${a.look === "none" ? "An outline" : a.look}${a.sound ? `, a sound${a.soundHidden ? " (heard while hidden)" : ""}` : ""}`];
    case "damage": return ["Damage", a.damage ? `${a.damage}${a.damageType ? ` ${a.damageType}` : ""}${a.damageSave ? `, ${cap(a.saveAttr)} DC ${a.saveDc} for ${a.half ? "half" : "none"}` : ""}` : "None"];
    case "effects": return ["Effects", a.effectIds.length ? `${a.effectIds.length} from the catalog` : "None"];
    case "lingers": return ["Lingering, flammable", [a.lingers ? `lingers (+${a.buildUp}, −${a.decay})` : "", a.flammable ? "flammable" : ""].filter(Boolean).join(", ") || "Neither"];
    case "lasts": return ["Lasts", a.lasts ? `${a.lasts} minute${a.lasts === 1 ? "" : "s"}` : "Until removed"];
  }
}

/** The card, in plain words (part 1: how it's set off and whom it catches). */
export function hazardCard(a: Answers): string[] {
  const out: string[] = [];
  if (a.activation === "always") out.push("It's always active while it's switched on.");
  else {
    const then = a.activeFor === "instant" ? "it acts at once on whoever is in it" : a.activeFor === "time" ? `it stays active for ${a.activeRounds} round${a.activeRounds === 1 ? "" : "s"}` : "it stays active until it's switched off";
    out.push(`It waits until ${setOff(a)}; then ${then}.`);
  }
  if (!(a.activation === "dormant" && a.activeFor === "instant")) out.push(`While active, it catches whoever ${or(a.fires.map((f) => FIRES[f]))}.`);
  out.push(`It's for ${WHO[a.who]}, ${OFTEN[a.often]}${a.stops ? ", and stops whoever sets it off" : ""}.`);
  if (a.damage) out.push(`It deals ${a.damage}${a.damageType ? ` ${a.damageType}` : ""} damage${a.damageSave ? `, ${a.half ? "half" : "none"} on a successful ${cap(a.saveAttr)} save (DC ${a.saveDc})` : ""}.`);
  if (a.lingers) out.push(`Its harm lingers: ${a.buildUp} more each round inside, ${a.decay} less each round after leaving.`);
  if (a.flammable) out.push("Fire sets it burning.");
  out.push(a.visibility === "shown" ? "Players see it." : a.visibility === "gm" ? "Only the GM sees it." : `Players see it once it goes off, or a Search beats DC ${a.findDc}.`);
  return out;
}
