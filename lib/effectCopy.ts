/**
 * Effects copied into each use (backlog W): a use (an action, an item, a creature, a hazard, an improvisation) holds a
 * literal copy of the catalog effect, and the GM may change only how strong it is, how long it lasts and how hard it
 * is to escape: its name, its rounds, its save DCs, and the numbers inside its rules (dice, amounts, how much). Never
 * which ability a save uses, whether it has one, its damage types, what ends it, stacking, or its rules' wording.
 * Pure: the tune-it form and the tests use it.
 */
import type { Condition, Effect, Modifier } from "@/lib/conditions";
import { effectSentences } from "@/lib/effectGrammar";
import { isDiceFormula } from "@/lib/itemTypes";

/** One thing a copy may change: where it is (`path`), what to call it, and its value now. */
export type Tunable = { path: string; label: string; kind: "text" | "dice" | "number"; value: string | number; min?: number; max?: number };

type Tuned = Pick<Effect, "name" | "modifiers"> & Partial<Pick<Effect, "rounds" | "duration" | "apply_save_attr" | "apply_save_dc" | "save_attr" | "save_dc">>;

/** The magnitude fields of a rule, by kind (dice / amounts / how much; never what kind, which target, or damage types). */
const FIELDS: Partial<Record<Modifier["kind"], [string, Tunable["kind"], string, number?, number?][]>> = {
  boost: [["value", "dice", "by how much"]],
  periodic: [["value", "dice", "each round"], ["save_dc", "number", "its save DC", 1, 40]],
  instant: [["value", "dice", "as it lands"]],
  extra: [["value", "dice", "extra dice"]],
  speed: [["factor", "number", "speed multiplied by", 0, 10]],
  set: [["value", "number", "becomes", -100, 1000]],
  multiply: [["factor", "number", "multiplied by", 0, 10]],
  temphp: [["value", "dice", "temporary health"]],
  maxhp: [["value", "number", "maximum health change", -1000, 1000]],
  strain: [["points", "number", "strain points", -20, 20]],
  sense: [["range", "number", "range (ft)", 0, 1000]],
  cap: [["value", "number", "at most", -100, 1000]],
  aura: [["radius", "number", "radius (ft)", 0, 300]],
  trigger: [["damage", "dice", "damage"], ["save_dc", "number", "its save DC", 1, 40]],
};

/** What this effect's copy may change, each labelled with the rule it sits in. */
export function tunablesOf(e: Tuned): Tunable[] {
  const out: Tunable[] = [{ path: "name", label: "Name", kind: "text", value: e.name }];
  if ((e.duration ?? "rounds") === "rounds" && e.rounds !== undefined) out.push({ path: "rounds", label: "Rounds it lasts", kind: "number", value: e.rounds, min: 1, max: 600 });
  if (e.apply_save_attr) out.push({ path: "apply_save_dc", label: "DC of the save as it lands", kind: "number", value: e.apply_save_dc ?? 12, min: 1, max: 40 });
  if (e.save_attr) out.push({ path: "save_dc", label: "DC of the save to shake it off", kind: "number", value: e.save_dc ?? 12, min: 1, max: 40 });
  e.modifiers.forEach((m, i) => {
    const said = effectSentences([m])[0] ?? m.kind;
    for (const [field, kind, what, min, max] of FIELDS[m.kind] ?? []) {
      const v = (m as Record<string, unknown>)[field];
      if (v === undefined || v === "" || (field === "save_dc" && !(m as { save_attr?: string }).save_attr)) continue; // no save there: no DC to tune
      out.push({ path: `modifiers.${i}.${field}`, label: `${said.replace(/\.$/, "")} (${what})`, kind, value: v as string | number, min, max });
    }
  });
  return out;
}

/** A literal copy (nothing shared with the catalog's). */
export const copyOf = <T extends Tuned | Condition>(e: T): T => JSON.parse(JSON.stringify(e));

/**
 * A copy with these changes (path → new value), each checked: only what `tunablesOf` lists, of its kind (dice a dice
 * formula, numbers in range, a name not blank). Anything else is refused.
 */
export function tune<T extends Tuned>(e: T, changes: Record<string, string | number>): T {
  const allowed = new Map(tunablesOf(e).map((t) => [t.path, t]));
  const out = copyOf(e) as T;
  const fields = out as unknown as Record<string, unknown>;
  for (const [path, raw] of Object.entries(changes)) {
    const t = allowed.get(path);
    if (!t) throw new Error(`"${path}" can't be changed in a copy`);
    let v: string | number;
    if (t.kind === "text") { v = String(raw).trim().slice(0, 80); if (!v) throw new Error("A name can't be blank"); }
    else if (t.kind === "dice") { v = String(raw).toLowerCase().replace(/\s/g, ""); if (!isDiceFormula(v.replace(/^[+-]/, "")) && !/^[+-]?\d+$/.test(v)) throw new Error(`${t.label}: dice (1d6) or a number`); }
    else { v = Number(raw); if (!Number.isFinite(v) || (t.min !== undefined && v < t.min) || (t.max !== undefined && v > t.max)) throw new Error(`${t.label}: a number${t.min !== undefined ? ` from ${t.min} to ${t.max}` : ""}`); }
    const parts = path.split(".");
    if (parts[0] === "modifiers") (out.modifiers[Number(parts[1])] as Record<string, unknown>)[parts[2]] = v;
    else fields[path] = v;
  }
  return out;
}

/** Whether a copy differs from the catalog effect it came from (in anything it may change). */
export const isTuned = (copy: Tuned, catalog: Tuned): boolean => tunablesOf(copy).some((t, i) => tunablesOf(catalog)[i]?.value !== t.value);

/**
 * A copy as the server keeps it from one a form sent: only what a copy may change is taken from `posted` (each checked
 * by `tune`), onto `base` (the use's copy so far, or the catalog's). Anything else in `posted` is ignored.
 */
export function retune<T extends Tuned>(base: T, posted: Tuned): T {
  const now = new Map(tunablesOf(posted).map((t) => [t.path, t.value]));
  const changes = Object.fromEntries(tunablesOf(base).filter((t) => now.has(t.path) && now.get(t.path) !== t.value).map((t) => [t.path, now.get(t.path)!]));
  return tune(base, changes);
}
