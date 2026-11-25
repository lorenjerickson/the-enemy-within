import { describeStatus, type ActionStatuses } from "@/lib/status";
import { describeCondition, lingers, modifiersOf, type Condition } from "@/lib/conditions";
import { describeTargeting } from "@/lib/sides";
import type { GearAction } from "@/lib/roundPlan";

const lasting = (minutes: number) => (minutes <= 0.1 ? "until the end of the round" : minutes < 1 ? `for ${Math.round(minutes * 10)} rounds` : minutes < 60 ? `for ${minutes} minute${minutes === 1 ? "" : "s"}` : `for ${Math.round(minutes / 60)} hour${minutes === 60 ? "" : "s"}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const feet = (squares: number) => `within ${Math.max(1, squares) * 5} feet`;
const seconds = (s: number) => (s === 1 ? "1 second" : `${s} seconds`);
/** A condition that only lands once (an instant heal): read as what it does, not by name. */
const once = (c: Condition) => !lingers(c) && modifiersOf(c).length > 0;
const an = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What a named condition does, in plain words: "-2 Intellect and disadvantage on attack rolls for 10 rounds". */
export function conditionInWords(c: Condition): string {
  const [effects = "", ...more] = describeCondition(c).split(" · ");
  const parts = effects.replace(/ \((attribute|skill)\)/g, "").replace(/ on their /g, " on ").replace(/([+-]\d+) ([a-z]+)/g, (_, n, w) => `${n} ${cap(w)}`).split(", ").filter(Boolean);
  const how = parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const time = more.find((m) => /^\d+ rounds?$/.test(m));
  const rest = more.filter((m) => m !== time);
  return [how + (time ? ` for ${time}` : ""), ...rest].filter(Boolean).join("; ");
}

/** What a status does to `on` ("you", "the target", "them", "one creature"), as verb phrases: heals, harms, conditions put on, boosts. */
function does(s: ActionStatuses["self"], on: string, minutes: number): string[] {
  if (!s) return [];
  const out: string[] = [];
  const heal = s.boosts.filter((x) => x.target === "health").map((x) => x.value.replace(/^\+/, ""));
  if (heal.length) out.push(`heals ${on} for ${heal.join(" + ")}`);
  const rest = { boosts: s.boosts.filter((x) => x.target !== "health"), grants: s.grants };
  if (rest.boosts.length || rest.grants.length) out.push(`gives ${on} ${describeStatus(rest)} ${lasting(minutes)}`);
  const conds = s.conditions ?? [];
  // A condition that only lands once (a healing draught) reads as what it does; one that stays, by its name.
  for (const c of conds.filter(once)) {
    for (const m of modifiersOf(c)) {
      if (m.kind === "instant") out.push(m.heal ? `heals ${on} for ${m.value}` : `deals ${m.value}${m.damage_type ? ` ${m.damage_type}` : ""} damage to ${on}`);
      else out.push(`${describeCondition(c)} (${on})`);
    }
  }
  const named = conds.filter((c) => !once(c)).map((c) => c.name);
  if (named.length) out.push(`applies ${list(named)} to ${on}`);
  return out;
}

/** The card: one or two plain sentences of what the action does and how long it takes, as the player reads it. */
export function actionSentence(g: GearAction & { damageType?: string }): string {
  const t = g.targeting && (g.targeting.count !== "one" || g.targeting.who) ? g.targeting : undefined;
  const who = t ? describeTargeting(t, !!g.area).replace(/ in (range|its area)$/, "") : g.targets === "anyone" ? "one target creature" : "one creature";
  const dmg = g.damage ? `${g.damage}${g.damageType ? ` ${g.damageType}` : ""} damage` : "";
  const st = g.statuses, minutes = st?.minutes ?? 0.1;
  const mine = does(st?.self, "you", minutes);
  const out: string[] = [];
  if (g.area) {
    const size = `${g.area.ft}-foot ${g.area.shape === "circle" ? "radius" : g.area.shape}`;
    out.push(g.area.shape === "circle" ? `Fills a ${size} up to ${g.range * 5} feet away.` : `Fills a ${size} from you.`);
    const caught = t ? cap(who) : "Everyone";
    const save = `${an(cap(g.area.save))} save (DC ${g.area.dc})`;
    const theirs = does(st?.target, "them", minutes);
    if (dmg) out.push(`${caught} in it ${t && t.count !== "one" ? "make" : "makes"} ${save} or takes ${dmg}${g.area.half ? ", half on a success" : ""}.`);
    else out.push(`${caught} in it ${t && t.count !== "one" ? "make" : "makes"} ${save}${theirs.length ? `; on a failure it ${list(theirs)}` : ""}.`);
    if (dmg && theirs.length) out.push(`A failed save also ${list(theirs)}.`);
    if (g.area.minutes) out.push(`The area stays ${lasting(g.area.minutes)}, catching whoever is in it.`);
  } else if (g.self) {
    out.push(mine.length ? `${cap(list(mine))}.` : "Used on yourself.");
  } else if (dmg) {
    const bonus = [g.attack ? (/^[+-]/.test(g.attack) ? g.attack : `+${g.attack}`) : "", g.roll !== "normal" ? `with ${g.roll}` : ""].filter(Boolean).join(", ");
    out.push(`On a successful attack roll${bonus ? ` (${bonus})` : ""}, strikes ${who} ${feet(g.range)} for ${dmg}.`);
    const theirs = does(st?.target, "the target", minutes);
    if (theirs.length) out.push(`A hit also ${list(theirs)}.`);
  } else {
    const theirs = does(st?.target, `${who} ${feet(g.range)}`, minutes);
    out.push(theirs.length ? `${cap(list(theirs))}, no roll needed.` : `Used on ${who} ${feet(g.range)}.`);
  }
  if (mine.length && !g.self) out.push(`It also ${list(mine)}.`);
  // Each condition the card names, said once in plain words.
  const named = [...(st?.target?.conditions ?? []), ...(st?.self?.conditions ?? [])].filter((c, i, all) => !once(c) && all.findIndex((x) => x.id === c.id) === i);
  for (const c of named) { const w = conditionInWords(c); if (w) out.push(`${c.name}: ${w}.`); }
  out.push(`Takes ${seconds(g.seconds)}.`);
  const text = out.join(" ");
  return g.kind === "reaction" ? `As a reaction: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** The card's lines (one paragraph: the sentence already explains every effect it names). */
export function gearSummary(g: GearAction & { damageType?: string }): string[] {
  return [actionSentence(g)];
}
