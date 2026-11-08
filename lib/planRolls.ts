import { formatModifier, modifier } from "@/lib/attributes";
import { getItem } from "@/lib/db";
import { tokenWho } from "@/lib/combat";
import { partDice, type RollPart, type RollSpec } from "@/lib/rolls";
import { DODGE_DC, afterRefits, type PlanStep, type StepDice } from "@/lib/roundPlan";

/**
 * The dice a player rolls with their plan, before Ready: for each planned attack its to-hit and damage, for a Dodge
 * its check. Modifiers are shown for reference; resolution adds them (and any statuses) when it happens. A to-hit or
 * check d20 is always thrown twice: advantage or disadvantage at the time picks which counts (else the first).
 */
export interface PlanRoll {
  step: number; // index in the plan
  key: keyof StepDice;
  spec: RollSpec;
}

/** A formula's terms as roll parts ("1d8+2" → 1d8, 2), from one source. */
const terms = (formula: string | null | undefined, source: string): RollPart[] =>
  (formula ?? "").replace(/\s/g, "").replace(/^\+/, "").match(/[+-]?[^+-]+/g)?.map((t) => ({ formula: t.replace(/^\+/, ""), source })) ?? [];

const flat = (n: number, source: string): RollPart[] => (n ? [{ formula: String(n), source }] : []);

export function planRolls(tokenId: number, plan: PlanStep[]): PlanRoll[] {
  const who = tokenWho(tokenId);
  if (!who) return [];
  const mod = (a: "might" | "agility") => modifier(who.attributes[a] ?? 10);
  const out: PlanRoll[] = [];
  plan.forEach((s, i) => {
    if (s.kind !== "action") return;
    const main = afterRefits(who.equipment ?? {}, plan.slice(0, i))["main hand"];
    const weapon = main ? getItem(main) : undefined;
    const what = s.use?.name ?? (weapon ? weapon.name : "Unarmed");
    const might = flat(mod("might"), `Might (${formatModifier(mod("might"))})`);
    const versus = s.target ? ` on ${s.target.name}` : "";
    if ((s.action === "attack" && s.target && (!s.use || s.use.damage)) || (s.use && s.use.damage && s.target && !s.use.area)) {
      out.push({ step: i, key: "hit", spec: { label: `${what}${versus}: to hit`, mode: "normal", parts: [{ formula: "1d20", source: "To hit (thrown twice)" }, ...might, ...terms(s.use ? s.use.attack : weapon?.attack, what)] } });
      out.push({ step: i, key: "damage", spec: { label: `${what}${versus}: damage`, mode: "normal", parts: [...terms(s.use?.damage || weapon?.damage || "1d4", s.use?.damage || weapon?.damage ? what : "Unarmed"), ...might] } });
    } else if (s.use?.area && s.use.damage) {
      out.push({ step: i, key: "damage", spec: { label: `${what}: damage`, mode: "normal", parts: terms(s.use.damage, what) } });
    } else if (s.action === "dodge") {
      out.push({ step: i, key: "check", spec: { label: `Dodge (Agility, DC ${DODGE_DC})`, mode: "normal", parts: [{ formula: "1d20", source: "Dodge (thrown twice)" }, ...flat(mod("agility"), `Agility (${formatModifier(mod("agility"))})`)] } });
    }
  });
  return out;
}

/** What to throw for a plan roll, part by part: the leading d20 twice; flat parts nothing. */
export function planDice(spec: RollSpec): ({ count: number; sides: number } | null)[] {
  return spec.parts.map((p, i) => {
    const d = partDice(p.formula);
    return d && { count: i === 0 && d.sides === 20 && d.count === 1 && spec.parts[0].source.includes("twice") ? 2 : d.count, sides: d.sides };
  });
}

/** The dice thrown for each plan roll, checked against what it asked for, onto the plan's steps; null if they don't fit. */
export function withThrownDice(plan: PlanStep[], rolls: PlanRoll[], thrown: number[][][]): PlanStep[] | null {
  if (thrown.length !== rolls.length) return null;
  const out = plan.map((s) => ({ ...s }));
  for (let r = 0; r < rolls.length; r++) {
    const want = planDice(rolls[r].spec), got = thrown[r];
    if (!Array.isArray(got) || got.length !== want.length) return null;
    const dice: number[] = [];
    for (let i = 0; i < want.length; i++) {
      const w = want[i], g = got[i] ?? [];
      if (!w ? g.length : g.length !== w.count || g.some((v) => !Number.isInteger(v) || v < 1 || v > w.sides)) return null;
      dice.push(...g);
    }
    const s = out[rolls[r].step];
    if (s.kind === "action") s.dice = { ...s.dice, [rolls[r].key]: dice };
  }
  return out;
}

/** A rolled plan roll for showing: the dice and what they come to (the first d20 counting, unless advantage says otherwise). */
export function rolledTotal(spec: RollSpec, dice: number[]): { total: number; text: string } {
  const want = planDice(spec);
  let k = 0, total = 0;
  const bits: string[] = [];
  spec.parts.forEach((p, i) => {
    const w = want[i];
    if (!w) {
      total += Number(p.formula) || 0;
      bits.push(formatModifier(Number(p.formula) || 0));
      return;
    }
    const got = dice.slice(k, k + w.count);
    k += w.count;
    const sign = partDice(p.formula)!.sign;
    if (w.count === 2 && i === 0 && w.sides === 20) {
      total += got[0];
      bits.push(`d20 ${got[0]} (or ${got[1]})`);
    } else {
      total += sign * got.reduce((a, v) => a + v, 0);
      bits.push(`${p.formula} [${got.join(", ")}]`);
    }
  });
  return { total, text: bits.join(" ") };
}
