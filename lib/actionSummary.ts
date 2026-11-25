import { describeArea } from "@/lib/aoe";
import { describeStatus } from "@/lib/status";
import { describeCondition } from "@/lib/conditions";
import { describeTargeting } from "@/lib/sides";
import type { GearAction } from "@/lib/roundPlan";
import type { ActionStatuses } from "@/lib/status";

const lasting = (minutes: number) => (minutes <= 0.1 ? "this round" : minutes < 1 ? `${Math.round(minutes * 10)} rounds` : minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ft = (squares: number) => (squares > 1 ? `within ${squares * 5} ft` : "within reach");

/** What a status puts on someone, by name: its conditions, else its boosts ("+2 defense"), plus any healing. */
function puts(s: ActionStatuses["self"]) {
  if (!s) return { heal: [] as string[], names: [] as string[] };
  const heal = s.boosts.filter((x) => x.target === "health").map((x) => x.value.replace(/^\+/, ""));
  const rest = { boosts: s.boosts.filter((x) => x.target !== "health"), grants: s.grants };
  const names = (s.conditions ?? []).map((c) => c.name);
  if (!names.length && (rest.boosts.length || rest.grants.length)) names.push(describeStatus(rest));
  return { heal, names };
}

/** The card's lead: one plain sentence of what the action does, as the player reads it. */
export function actionSentence(g: GearAction & { damageType?: string }): string {
  const who = g.targeting && (g.targeting.count !== "one" || g.targeting.who)
    ? describeTargeting(g.targeting, !!g.area).replace(/ in (range|its area)$/, "")
    : g.targets === "anyone" ? "you or one creature" : "one creature";
  const dmg = g.damage ? `${g.damage}${g.damageType ? ` ${g.damageType}` : ""}` : "";
  const onMe = puts(g.statuses?.self), onThem = puts(g.statuses?.target);
  const also = (p: ReturnType<typeof puts>, on: string) => [
    ...(p.heal.length ? [`heals ${on} ${p.heal.join(" + ")}`] : []),
    ...(p.names.length ? [`puts ${p.names.join(", ")} on ${on}`] : []),
  ];
  const mine = also(onMe, "you");
  const lead = g.kind === "reaction" ? "Reaction: " : "";
  let main: string;
  if (g.area) {
    const where = `a ${describeArea(g.area)}${g.area.shape === "circle" ? ` up to ${g.range * 5} ft away` : ""}`;
    const save = `${cap(g.area.save)} save DC ${g.area.dc}`;
    main = dmg
      ? `Hits ${who === "one creature" ? "everyone" : who} in ${where}: ${save}, ${dmg}${g.area.half ? ", half on a save" : ", none on a save"}.`
      : `Catches ${who === "one creature" ? "everyone" : who} in ${where}: ${save}.`;
    const theirs = also(onThem, "them");
    if (theirs.length) main += ` On a failed save: ${theirs.join("; ")}.`;
  } else if (g.self) {
    main = mine.length ? `${cap(mine.join("; "))}.` : "Used on yourself.";
    return lead + main;
  } else if (dmg) {
    const hit = g.attack ? `${/^[+-]/.test(g.attack) ? g.attack : `+${g.attack}`} to hit` : "an attack roll";
    main = `Strikes ${who} ${ft(g.range)}: ${hit}${g.roll !== "normal" ? ` with ${g.roll}` : ""}, ${dmg}.`;
    const theirs = also(onThem, "them");
    if (theirs.length) main += ` On a hit: ${cap(theirs.join("; "))}.`;
  } else {
    const theirs = also(onThem, who);
    main = theirs.length ? `${cap(theirs.join("; "))} ${ft(g.range)}. No roll.` : `Used on ${who} ${ft(g.range)}.`;
  }
  if (mine.length) main += ` Also ${mine.join("; ")}.`;
  return lead + main;
}

/** What an action from gear, a profession or a creature does, in a few plain lines (for its tooltip). */
export function gearSummary(g: GearAction & { damageType?: string }): string[] {
  const out: string[] = [actionSentence(g), `Takes ${g.seconds} s of the round.`];
  if (g.area) out.push(`Area: ${describeArea(g.area)}${g.area.shape === "circle" ? `, aimed up to ${g.range * 5} ft away` : ""}; ${g.area.save} save DC ${g.area.dc} (${g.area.half ? "half damage on a save" : "no damage on a save"})${g.area.minutes ? `, stays for ${lasting(g.area.minutes)}` : ""}.`);
  else if (g.self) out.push("Used on yourself.");
  else out.push(`Reach: ${g.range > 1 ? `${g.range * 5} ft` : "within reach (5 ft)"}${g.targets === "anyone" ? ", on yourself or others" : ""}.`);
  if (g.targeting && !g.self && (g.targeting.count !== "one" || g.targeting.who)) out.push(`Targets ${describeTargeting(g.targeting, !!g.area)}.`);
  if (g.damage) out.push(`Damage: ${g.damage}${g.damageType ? ` ${g.damageType}` : ""}${g.area ? "" : `; attack roll${g.attack ? ` ${/^[+-]/.test(g.attack) ? g.attack : `+${g.attack}`}` : ""}${g.roll !== "normal" ? ` with ${g.roll}` : ""}`}.`);
  // Health boosts heal straight away; anything else lasts a while.
  const effect = (s: NonNullable<typeof st>["self"], minutes: number) => {
    if (!s) return null;
    const heal = s.boosts.filter((x) => x.target === "health").map((x) => x.value.replace(/^\+/, ""));
    const rest = { boosts: s.boosts.filter((x) => x.target !== "health"), grants: s.grants };
    const parts = [
      ...(heal.length ? [`heals ${heal.join(" + ")}`] : []),
      ...(rest.boosts.length || rest.grants.length ? [`${describeStatus(rest)} (${lasting(minutes)})`] : []),
      ...(s.conditions ?? []).map((c) => (c.effects.every((e) => e.modifiers.every((m) => m.kind === "instant")) ? describeCondition(c) : `${c.name}: ${describeCondition(c)}`)),
    ];
    return parts.length ? parts.join("; ") : null;
  };
  const st = g.statuses;
  const onMe = st && effect(st.self, st.minutes), onThem = st && effect(st.target, st.minutes);
  if (onMe) out.push(`On you: ${onMe}.`);
  if (onThem) out.push(`On the target${g.damage ? " if it hits" : ""}: ${onThem}.`);
  return out;
}
