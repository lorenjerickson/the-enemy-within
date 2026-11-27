/**
 * The hazard editor as an interview (backlog X, claude/hazards-design.md section 3), part 1: how it's set off and
 * whom it catches. Answers to the hazard's settings and back, the questions that follow from them, presets, a short
 * line per answer, and the card in plain words. Pure: HazardInterview.tsx and the tests use it.
 */
import type { AreaFires } from "@/lib/aoe";
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
  extra: Partial<Hazard>; // settings a preset brings that later questions ask about (visibility, look, lingering…)
}

export type Question = "name" | "preset" | "activation" | "activeFor" | "catches" | "who" | "often" | "stops";

/** The questions for these answers: presets only for a new hazard; how long it stays active only for a dormant one; whom it catches unless it acts for an instant. */
export function questions(a: Answers, isNew = false): Question[] {
  const dormantInstant = a.activation === "dormant" && a.activeFor === "instant";
  return ["name", ...(isNew ? (["preset"] as const) : []), "activation", ...(a.activation === "dormant" ? (["activeFor"] as const) : []), ...(dormantInstant ? [] : (["catches"] as const)), "who", "often", "stops"];
}

/** The answers for a hazard as it is. */
export function answersFromHazard(h: Partial<Hazard>): Answers {
  return {
    name: h.name ?? "", activation: h.activation ?? "always", setOffBy: h.setOffBy ?? (h.activation === "dormant" ? ["enter"] : []), byTrigger: !!h.byTrigger,
    activeFor: h.activeFor ?? "instant", activeRounds: Math.max(1, Math.round((h.activeMinutes ?? 1) * 10)),
    fires: h.fires ?? ["enter"], who: h.who ?? "", often: h.often ?? "always", stops: !!h.stops, extra: {},
  };
}

/** What the answers set on the hazard (the rest of it is kept as it is). */
export function hazardPatch(a: Answers): Partial<Hazard> {
  const dormant = a.activation === "dormant";
  return {
    ...a.extra, name: a.name.trim() || "Hazard", activation: a.activation,
    setOffBy: dormant ? a.setOffBy : [], byTrigger: dormant && a.byTrigger,
    activeFor: dormant ? a.activeFor : "instant", activeMinutes: dormant && a.activeFor === "time" ? a.activeRounds / 10 : undefined,
    fires: a.fires.length ? a.fires : ["enter"], who: a.who, often: a.often, stops: a.stops,
  };
}

/** A preset's answers (it only fills them in: everything stays editable). */
export function applyPreset(a: Answers, p: Preset): Answers {
  const base = { ...a, setOffBy: [] as SetOffBy[], byTrigger: false, activeFor: "instant" as const, who: "" as TrapWho, stops: false };
  if (p === "trap") return { ...base, activation: "dormant", setOffBy: ["enter"], byTrigger: true, often: "each", stops: true, extra: { visibility: "hidden", noLook: true } };
  if (p === "cloud") return { ...base, activation: "always", fires: ["start", "inside"], often: "always", extra: { visibility: "shown", look: "fog", noLook: false } };
  if (p === "fire") return { ...base, activation: "always", fires: ["enter", "end"], often: "always", extra: { visibility: "shown", look: "fire", noLook: false, lingers: true } };
  return { ...base, activation: "always", fires: ["enter"], who: "hostile", often: "always", extra: { visibility: "gm", noLook: true } };
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
  return out;
}
