/**
 * The effect editor as an interview (backlog V): the answers, which questions follow from them, and the effect's
 * timing (its lifecycle) to answers and back. The rules themselves are the sentence builder's (`Filled`), carried as
 * they are. Pure: the screen (EffectInterview.tsx) and the tests use it.
 */
import type { Attribute } from "@/lib/attributes";
import { DEFAULT_LIFECYCLE, type Duration, type Lifecycle } from "@/lib/conditions";
import { lifecycleSentences, type Filled } from "@/lib/effectGrammar";

export type EndsOn = "damage" | "attack" | "trigger" | "concentration";
export const ENDS_ON: [EndsOn, string][] = [["damage", "they take damage"], ["attack", "they attack"], ["trigger", "one of its triggers fires"], ["concentration", "the source stops concentrating"]];

export interface Answers {
  name: string;
  description: string;
  duration: Duration;
  rounds: number;
  rules: Filled[]; // what it does: the sentence builder's rules
  resist: boolean; // a save as it lands
  resistAttr: Attribute;
  resistDc: number;
  resistOutcome: "negates" | "halves";
  shake: boolean; // a save to end it
  shakeAttr: Attribute;
  shakeDc: number;
  shakeWhen: "end" | "start" | "damaged";
  shakeAction: boolean; // they can also spend their action on it
  shakeNeeded: number; // successes it takes
  endsOn: EndsOn[];
  again: "refresh" | "stack" | "ignore";
  stackLimit: number; // 0: no limit
}

export type Question = "name" | "duration" | "rules" | "resist" | "shake" | "ends" | "again";

/** The questions, in order, for these answers: the timing ones only for an effect lasting rounds. */
export function questions(a: Answers): Question[] {
  return ["name", "duration", "rules", ...(a.duration === "rounds" ? (["resist", "shake", "ends", "again"] as const) : [])];
}

type Saved = Partial<Lifecycle & { duration: Duration; name: string; description: string }>;

/** The answers for a saved effect (or a new one), and its rules as sentences. */
export function answersFromEffect(e: Saved = {}, rules: Filled[] = []): Answers {
  const d = { ...DEFAULT_LIFECYCLE, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== null)) } as Required<Lifecycle> & Saved;
  return {
    name: e.name ?? "", description: e.description ?? "", duration: e.duration ?? "rounds", rounds: d.rounds || 1, rules,
    resist: !!d.apply_save_attr, resistAttr: (d.apply_save_attr || "fortitude") as Attribute, resistDc: d.apply_save_dc, resistOutcome: d.apply_save_outcome,
    shake: !!d.save_attr, shakeAttr: (d.save_attr || "fortitude") as Attribute, shakeDc: d.save_dc, shakeWhen: d.save_when, shakeAction: !!d.save_action, shakeNeeded: d.saves_needed || 1,
    endsOn: ENDS_ON.map(([k]) => k).filter((k) => (k === "damage" ? d.ends_on_damage : k === "attack" ? d.ends_on_attack : k === "trigger" ? d.ends_on_trigger : d.concentration)),
    again: d.reapply, stackLimit: d.stack_limit,
  };
}

/** The effect's timing from the answers (only an effect lasting rounds has saves, endings and stacking). */
export function lifecycleFromAnswers(a: Answers): Required<Lifecycle> & { duration: Duration } {
  const rounds = a.duration === "rounds";
  const on = (k: EndsOn) => (rounds && a.endsOn.includes(k) ? 1 : 0);
  return {
    duration: a.duration, rounds: rounds ? Math.max(1, a.rounds) : 1,
    apply_save_attr: rounds && a.resist ? a.resistAttr : "", apply_save_dc: rounds && a.resist ? a.resistDc : 12, apply_save_outcome: rounds && a.resist ? a.resistOutcome : "negates",
    save_attr: rounds && a.shake ? a.shakeAttr : "", save_dc: rounds && a.shake ? a.shakeDc : 12, save_when: rounds && a.shake ? a.shakeWhen : "end",
    save_action: rounds && a.shake && a.shakeAction ? 1 : 0, saves_needed: rounds && a.shake ? Math.max(1, a.shakeNeeded) : 1,
    ends_on_damage: on("damage"), ends_on_attack: on("attack"), ends_on_trigger: on("trigger"), concentration: on("concentration"),
    reapply: rounds ? a.again : "refresh", stack_limit: rounds && a.again === "stack" ? a.stackLimit : 0,
  };
}

/** The timing as the "how long it lasts" sentences the server reads (as the old form posted). */
export const lifecyclePosted = (a: Answers): Filled[] => lifecycleSentences(lifecycleFromAnswers(a));

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WHEN: Record<Answers["shakeWhen"], string> = { end: "at the end of each round", start: "at the start of each round", damaged: "when they take damage" };

/** Each answer in a few words, for the list of answers (click one to go back to it). ruleText: a rule as a sentence. */
export function answerLine(q: Question, a: Answers, ruleText: (r: Filled) => string = () => "a rule"): [string, string] {
  switch (q) {
    case "name": return ["Name", a.name || "—"];
    case "duration": return ["Lasts", a.duration === "equipped" ? "While equipped" : a.duration === "always" ? "Always" : `${a.rounds} round${a.rounds === 1 ? "" : "s"}`];
    case "rules": return ["What it does", a.rules.length ? a.rules.map(ruleText).join("; ") : "—"];
    case "resist": return ["Resisted as it lands", a.resist ? `${cap(a.resistAttr)} DC ${a.resistDc}: ${a.resistOutcome === "halves" ? "half as long" : "avoids it"}` : "No"];
    case "shake": return ["Shaken off", a.shake ? `${cap(a.shakeAttr)} DC ${a.shakeDc} ${WHEN[a.shakeWhen]}${a.shakeAction ? ", or with their action" : ""}${a.shakeNeeded > 1 ? `, ${a.shakeNeeded} successes` : ""}` : "No"];
    case "ends": return ["Also ends when", a.endsOn.length ? a.endsOn.map((k) => ENDS_ON.find(([x]) => x === k)![1]).join(", ") : "Nothing else"];
    case "again": return ["Put on again", a.again === "stack" ? `Stacks${a.stackLimit ? ` (up to ${a.stackLimit})` : ""}` : a.again === "ignore" ? "Nothing happens" : "Starts over"];
  }
}

const YOU_ENDS: Record<EndsOn, string> = { damage: "you take damage", attack: "you attack", trigger: "one of its triggers fires", concentration: "the source stops concentrating on it" };
const SHAKE_WHEN: Record<Answers["shakeWhen"], string> = { end: "At the end of each round", start: "At the start of each round", damaged: "Whenever you take damage" };
const throwOf = (attr: Attribute, dc: number) => `${cap(attr)} saving throw against a DC ${dc}`;
const listed = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/**
 * The effect's card, from the point of view of whoever it's put on ("Your speed is halved for 3 rounds, unless you
 * make a successful Fortitude saving throw against a DC 12."). `rules`: its rules as the builder's sentences (already
 * second person: "Your speed is halved.").
 */
export function effectCard(a: Answers, rules: string[]): string[] {
  const said = rules.map((r) => r.trim().replace(/\.$/, "")).filter(Boolean);
  const rounds = a.duration === "rounds";
  const what = said.length ? said.map((s, i) => (i ? s.charAt(0).toLowerCase() + s.slice(1) : s)).join("; ") : "It does nothing yet";
  const lasts = rounds ? ` for ${a.rounds} round${a.rounds === 1 ? "" : "s"}` : a.duration === "equipped" ? " while you have it equipped" : "";
  const resist = rounds && a.resist ? (a.resistOutcome === "halves" ? `, or half as long if you make a successful ${throwOf(a.resistAttr, a.resistDc)}` : `, unless you make a successful ${throwOf(a.resistAttr, a.resistDc)}`) : "";
  // One rule: the timing rides on it ("Your speed is halved for 3 rounds, unless…"); several: a sentence of its own.
  const out = said.length > 1 ? [`${what}.`, ...(lasts || resist ? [`It lasts${lasts}${resist}.`] : [])] : [`${what}${lasts}${resist}.`];
  if (rounds && a.shake) out.push(`${SHAKE_WHEN[a.shakeWhen]} you can end the effect with a ${throwOf(a.shakeAttr, a.shakeDc)}${a.shakeAction ? ", or spend your action to try" : ""}${a.shakeNeeded > 1 ? `; it takes ${a.shakeNeeded} successes` : ""}.`);
  if (rounds && a.endsOn.length) out.push(`It ends early if ${listed(a.endsOn.map((k) => YOU_ENDS[k]))}.`);
  if (rounds && a.again === "stack") out.push(`If it's put on you again, another one runs alongside${a.stackLimit ? ` (up to ${a.stackLimit})` : ""}.`);
  if (rounds && a.again === "ignore") out.push("Putting it on you again does nothing while it lasts.");
  return out;
}
