import { describeArea } from "@/lib/aoe";
import { describeStatus } from "@/lib/status";
import { describeTargeting } from "@/lib/sides";
import type { GearAction } from "@/lib/roundPlan";

const lasting = (minutes: number) => (minutes <= 0.1 ? "this round" : minutes < 1 ? `${Math.round(minutes * 10)} rounds` : minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`);

/** What an action from gear, a profession or a creature does, in a few plain lines (for its tooltip). */
export function gearSummary(g: GearAction & { damageType?: string }): string[] {
  const out: string[] = [`Takes ${g.seconds} s of the round.`];
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
    const parts = [...(heal.length ? [`heals ${heal.join(" + ")}`] : []), ...(rest.boosts.length || rest.grants.length ? [`${describeStatus(rest)} (${lasting(minutes)})`] : [])];
    return parts.length ? parts.join("; ") : null;
  };
  const st = g.statuses;
  const onMe = st && effect(st.self, st.minutes), onThem = st && effect(st.target, st.minutes);
  if (onMe) out.push(`On you: ${onMe}.`);
  if (onThem) out.push(`On the target${g.damage ? " if it hits" : ""}: ${onThem}.`);
  return out;
}
