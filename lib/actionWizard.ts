// Client-safe: the action editor's interview. One question at a time; which comes next depends on the answers so far.
// Answers turn into the action's saved fields and back (so an existing action opens with the interview filled in).
import type { Boost } from "@/lib/actions";
import { NO_SAVE_DC } from "@/lib/aoe";
import type { ActionFields } from "@/lib/actionCard";
import type { ModifierTarget } from "@/lib/modifiers";

export type ActionType = "action" | "bonus" | "reaction" | "free";
export type Who = "self" | "one" | "several" | "area";
export type Affect = "attack" | "defend" | "heal" | "aid" | "effect";
export const AFFECTS: Affect[] = ["attack", "defend", "heal", "aid", "effect"];

export interface Answers {
  name: string;
  description: string;
  type: ActionType;
  seconds: number;
  who: Who;
  targetWho: "" | "friendly" | "enemy";
  count: "exactly" | "upto"; // several
  n: number;
  rangeFt: number; // one / several: how far; area (circle): how far away it can be aimed
  shape: "circle" | "cone" | "line";
  areaFt: number;
  lasts: boolean; // area: stays on the map
  affects: Affect[];
  damage: string;
  damageType: ActionFields["damage_type"];
  attackBonus: string; // an attack roll's to-hit (not an area: an area always uses a save)
  saveAttr: ActionFields["save_attr"];
  saveDc: number;
  saveHalf: boolean;
  defend: string; // +N defense
  heal: string; // dice
  aidTarget: ModifierTarget | "";
  aid: string;
  durationAmount: number; // defend, aid, a lasting area
  durationUnit: ActionFields["duration_unit"];
  effects: number[]; // catalog effects (each lasts as the catalog says)
  // Kept as they were (not asked): an older action's other bonuses, roll mode, when a lasting area catches.
  keep: Pick<ActionFields, "roll" | "area_fires" | "roll_grants" | "conditions"> & { boosts: Boost[] }; // conditions: on the other side (an attack that also helps its user)
}

export type Question =
  | "name" | "type" | "who" | "targetWho" | "count" | "range" | "shape" | "areaSize" | "lasts"
  | "affects" | "damage" | "toHit" | "defend" | "heal" | "aid" | "duration" | "effects";

const isSelf = (a: Answers) => a.type === "reaction" || a.who === "self";
/** What it can do to whoever it's on: anything but attack, on yourself (or a reaction, which is on yourself). */
export const affectsFor = (a: Answers): Affect[] => (isSelf(a) ? AFFECTS.filter((x) => x !== "attack") : AFFECTS);
/** What's ticked and still possible (attack falls away when it becomes something on yourself). */
const affected = (a: Answers) => a.affects.filter((x) => affectsFor(a).includes(x));

/** The questions, in order, for these answers (answering one can add or remove the ones after it). */
export function questions(a: Answers): Question[] {
  const q: Question[] = ["name", "type"];
  if (a.type !== "reaction") { // a reaction readies something on its user
    q.push("who");
    if (a.who === "one" || a.who === "several") q.push("targetWho", ...(a.who === "several" ? (["count"] as const) : []), "range");
    if (a.who === "area") q.push("shape", "areaSize", "lasts");
  }
  q.push("affects");
  const has = (x: Affect) => affected(a).includes(x);
  // An area only decides who is caught: its damage always lands (saves belong to the effects it applies).
  if (has("attack")) q.push("damage", ...(a.who === "area" && a.type !== "reaction" ? [] : (["toHit"] as const)));
  if (has("defend")) q.push("defend");
  if (has("heal")) q.push("heal");
  if (has("aid")) q.push("aid");
  if (has("defend") || has("aid") || (a.who === "area" && a.lasts && a.type !== "reaction")) q.push("duration");
  if (has("effect")) q.push("effects");
  return q;
}

const plus = (v: string) => (/^[+-]/.test(v) ? v : `+${v}`);
/** The action's saved fields from the answers. */
export function fieldsFromAnswers(a: Answers): ActionFields {
  const on = isSelf(a) ? ("self" as const) : ("target" as const);
  const has = (x: Affect) => affected(a).includes(x);
  const asked: Boost[] = [
    ...(has("heal") && a.heal ? [{ target: "health" as const, value: plus(a.heal), on }] : []),
    ...(has("defend") && a.defend ? [{ target: "defense" as const, value: plus(a.defend), on }] : []),
    ...(has("aid") && a.aid && a.aidTarget ? [{ target: a.aidTarget, value: plus(a.aid), on }] : []),
  ];
  // Bonuses this interview asks about come from it; any other (an older action's) are kept.
  const askedTargets = new Set<string>(["health", "defense", ...(a.aidTarget ? [a.aidTarget] : [])]);
  const area = !isSelf(a) && a.who === "area";
  const several = !isSelf(a) && a.who === "several";
  const attack = has("attack");
  return {
    name: a.name, description: a.description, kind: a.type, seconds: a.seconds,
    roll: a.keep.roll, attack: attack && !area && a.attackBonus ? a.attackBonus : null,
    damage: attack && a.damage ? a.damage : null, damage_type: attack ? a.damageType : "",
    radius: 0, split: 0,
    boosts: [...asked, ...a.keep.boosts.filter((b) => !askedTargets.has(b.target))], roll_grants: a.keep.roll_grants,
    duration_amount: a.durationAmount, duration_unit: a.durationUnit,
    range_ft: isSelf(a) || (area && a.shape !== "circle") ? 0 : a.rangeFt,
    area_shape: area ? a.shape : "", area_ft: area ? a.areaFt : 0,
    save_attr: a.saveAttr, save_dc: area ? NO_SAVE_DC : a.saveDc, save_half: area ? 0 : a.saveHalf ? 1 : 0,
    area_lasts: area && a.lasts ? 1 : 0, area_fires: a.keep.area_fires,
    target_who: isSelf(a) ? "" : a.targetWho, target_count: several ? a.count : "one", target_n: several ? a.n : 1,
    targets: isSelf(a) ? "self" : a.targetWho === "enemy" || attack ? "others" : "anyone",
    conditions: [...(has("effect") ? a.effects.map((id) => ({ id, on })) : []), ...a.keep.conditions.filter((c) => c.on !== on)],
  };
}

/** The answers for a saved action (or a new one, from nothing). */
export function answersFromAction(f?: Partial<ActionFields>): Answers {
  const boosts = f?.boosts ?? [];
  const find = (t: (x: ModifierTarget) => boolean) => boosts.find((b) => t(b.target));
  const heal = find((t) => t === "health"), defend = find((t) => t === "defense");
  const aid = find((t) => t.startsWith("skill:") || t.startsWith("attribute:") || t === "check" || t.startsWith("save"));
  const area = !!f?.area_shape && (f.area_ft ?? 0) > 0;
  const self = f?.targets === "self" || f?.kind === "reaction";
  const several = !area && (f?.target_count === "exactly" || f?.target_count === "upto");
  const affects = AFFECTS.filter((x) =>
    x === "attack" ? !!f?.damage : x === "heal" ? !!heal : x === "defend" ? !!defend : x === "aid" ? !!aid : !!f?.conditions?.some((c) => c.on === (self ? "self" : "target")));
  const used = new Set([heal, defend, aid]);
  return {
    name: f?.name ?? "", description: f?.description ?? "", type: (f?.kind ?? "action") as ActionType, seconds: f?.seconds ?? 2,
    who: self ? "self" : area ? "area" : several ? "several" : "one",
    targetWho: f?.target_who ?? "", count: f?.target_count === "upto" ? "upto" : "exactly", n: f?.target_n && f.target_n > 1 ? f.target_n : 2,
    rangeFt: f?.range_ft ?? 5, shape: f?.area_shape || "circle", areaFt: f?.area_ft || 10, lasts: !!f?.area_lasts,
    affects, damage: f?.damage ?? "", damageType: f?.damage_type ?? "", attackBonus: f?.attack ?? "",
    saveAttr: f?.save_attr ?? "agility", saveDc: f?.save_dc ?? 12, saveHalf: f ? !!f.save_half : true,
    defend: defend?.value.replace(/^\+/, "") ?? "", heal: heal?.value.replace(/^\+/, "") ?? "",
    aidTarget: aid?.target ?? "", aid: aid?.value.replace(/^\+/, "") ?? "",
    durationAmount: f?.duration_amount ?? 1, durationUnit: f?.duration_unit || "minute",
    effects: (f?.conditions ?? []).filter((c) => c.on === (self ? "self" : "target")).map((c) => c.id),
    keep: { roll: f?.roll ?? "normal", area_fires: f?.area_fires ?? "", roll_grants: f?.roll_grants ?? [], boosts: boosts.filter((b) => !used.has(b)), conditions: (f?.conditions ?? []).filter((c) => c.on !== (self ? "self" : "target")) },
  };
}

const TYPE_WORDS: Record<ActionType, string> = { action: "Action", bonus: "Bonus action", reaction: "Reaction", free: "Free" };
const WHO_WORDS: Record<Who, string> = { self: "Yourself", one: "One creature", several: "Several creatures", area: "Everyone in an area" };
const AFFECT_WORDS: Record<Affect, string> = { attack: "attack", defend: "defend", heal: "heal", aid: "aid", effect: "apply an effect" };

/** Each answer in a few words, for the list of answers (click one to go back to it). effectName: a catalog effect's name. */
export function answerLine(q: Question, a: Answers, effectName: (id: number) => string = (id) => `#${id}`): [string, string] {
  switch (q) {
    case "name": return ["Name", a.name || "—"];
    case "type": return ["Type", `${TYPE_WORDS[a.type]}, ${a.seconds} s`];
    case "who": return ["Applies to", WHO_WORDS[a.who]];
    case "targetWho": return ["Who can be picked", a.targetWho === "enemy" ? "Enemies" : a.targetWho === "friendly" ? "Friends" : "Anyone"];
    case "count": return ["How many", `${a.count === "upto" ? "Up to" : "Exactly"} ${a.n}`];
    case "range": return ["How far", a.rangeFt === 0 ? "As far as the item reaches" : `${a.rangeFt} feet`];
    case "shape": return ["Shape", a.shape[0].toUpperCase() + a.shape.slice(1)];
    case "areaSize": return ["Size", `${a.areaFt} feet${a.shape === "circle" ? `, aimed up to ${a.rangeFt} feet away` : ""}`];
    case "lasts": return ["Stays on the map", a.lasts ? "Yes" : "No"];
    case "affects": {
      const words = affected(a).map((x) => AFFECT_WORDS[x]).join(", ");
      return ["How it affects them", words ? words[0].toUpperCase() + words.slice(1) : "—"];
    }
    case "damage": return ["Damage", a.damage ? `${a.damage}${a.damageType ? ` ${a.damageType}` : ""}` : "—"];
    case "toHit": return ["Bonus to hit", a.attackBonus ? plus(a.attackBonus) : "None"];
    case "defend": return ["Defense", a.defend ? plus(a.defend) : "—"];
    case "heal": return ["Heals", a.heal || "—"];
    case "aid": return ["Aid", a.aidTarget && a.aid ? `${plus(a.aid)} ${a.aidTarget.replace(/^\w+:/, "")}` : "—"];
    case "duration": return ["How long", `${a.durationAmount} ${a.durationUnit}${a.durationAmount > 1 && !a.durationUnit.endsWith("rest") ? "s" : ""}`];
    case "effects": return ["Effects", a.effects.map(effectName).join(", ") || "—"];
  }
}
