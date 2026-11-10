"use client";

import { Fragment, useState } from "react";
import { ATTRIBUTES } from "@/lib/attributes";
import { EFFECT_SENTENCE, checkRule, compile, idsUnder, type Filled, type Option, type Slot } from "@/lib/effectGrammar";

/** First-blank choices, grouped as the editor shows them. */
const GROUPS: [string, string[]][] = [
  ["While it lasts", ["you", "are", "can", "autofail", "your", "nocrit", "aura"]],
  ["Rolls", ["roll", "attacked"]],
  ["When something happens", ["applied", "start", "end", "hitting", "hit", "hit_by_source", "damaged", "moves"]],
];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** What an optional part adds, on its button. */
const OPTIONAL_HINTS: Record<string, string> = { save: "a save", with: "melee only", limit: "a limit", plus: "plus a modifier", self: "and you" };

/**
 * An effect's rules as handbook sentences built blank by blank: each choice decides the blanks that follow, and a
 * sentence shows only as far as its first empty blank. Saved as the rules' blanks (JSON); the server compiles them.
 */
export default function EffectBuilder({ initial, conditions }: { initial: Filled[]; conditions: { id: number; name: string }[] }) {
  const [rules, setRules] = useState<Filled[]>(initial.length ? initial : [{}]);
  const update = (i: number, next: Filled) => setRules((rs) => rs.map((r, j) => (j === i ? next : r)));
  const conditionId = (name: string) => conditions.find((c) => c.name === name)?.id ?? -1;
  return (
    <fieldset className="space-y-2 rounded-box border border-base-300 p-2" data-effect-builder>
      <legend className="px-1 text-sm font-semibold">Rules</legend>
      <input type="hidden" name="rules" value={JSON.stringify(rules.filter((r) => Object.keys(r).length))} />
      {rules.map((rule, i) => {
        const problem = Object.keys(rule).length ? checkRule(rule) : null;
        const notes = Object.keys(rule).length && !problem ? compile(rule, conditionId) : null;
        const nothing = notes && !notes.modifiers.length && !notes.creates;
        return (
          <div key={i} className="rounded-box bg-base-200 p-2" data-rule={i}>
            <div className="flex items-start gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-8">
                <Blanks slots={EFFECT_SENTENCE} rule={rule} set={(r) => update(i, r)} conditions={conditions} />
              </div>
              <button type="button" className="btn btn-ghost btn-xs" aria-label="Remove rule" data-remove-rule onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>✕</button>
            </div>
            {problem && Object.keys(rule).length > 0 && <p className="text-xs opacity-60">{cap(problem)}.</p>}
            {notes?.notes.map((n, k) => <p key={k} className={`text-xs ${nothing ? "text-error" : "text-warning"}`} data-rule-note>{nothing ? "Can't be saved yet: " : "Note: "}{n}</p>)}
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" data-add-rule onClick={() => setRules((rs) => [...rs, {}])}>+ Add rule</button>
    </fieldset>
  );
}

/**
 * The blanks of a sentence in order, stopping after the first one still empty (what comes next depends on it).
 * Returns whether it got to the end.
 */
function Blanks({ slots, rule, set, conditions }: { slots: Slot[]; rule: Filled; set: (r: Filled) => void; conditions: { id: number; name: string }[] }) {
  const out: React.ReactNode[] = [];
  const walk = (list: Slot[]): boolean => {
    for (const s of list) {
      const key = out.length;
      if (s.kind === "word") { out.push(<span key={key}>{s.text}</span>); continue; }
      if (s.kind === "optional") {
        if (rule[s.id] === undefined) {
          out.push(<button key={key} type="button" className="btn btn-ghost btn-xs opacity-70" data-optional={s.id} onClick={() => set({ ...rule, [s.id]: 1 })}>+ {OPTIONAL_HINTS[s.id] ?? `${s.lead}…`}</button>);
          continue;
        }
        out.push(<button key={key} type="button" className="btn btn-ghost btn-xs px-1 opacity-50" title="Leave this part off" onClick={() => set(Object.fromEntries(Object.entries(rule).filter(([k]) => k !== s.id && !idsIn(s.slots).includes(k))))}>−</button>);
        out.push(<span key={`${key}l`}>{s.lead}</span>);
        if (!walk(s.slots)) return false;
        continue;
      }
      const v = rule[s.id];
      if (s.kind === "choice") {
        out.push(<ChoiceBlank key={key} slot={s} value={v === undefined ? undefined : String(v)} first={s === EFFECT_SENTENCE[0]} onPick={(value) => {
          const cleared = Object.fromEntries(Object.entries(rule).filter(([k]) => !idsUnder(s).includes(k)));
          set({ ...cleared, [s.id]: value });
        }} />);
        const o = s.options.find((x) => x.value === v);
        if (!o) return false;
        if (!walk(o.next ?? [])) return false;
        continue;
      }
      if (s.kind === "condition") {
        out.push(
          <select key={key} className="select select-xs w-auto" value={v === undefined ? "" : String(v)} data-blank={s.id} onChange={(e) => set({ ...rule, [s.id]: e.target.value })}>
            <option value="" disabled>{s.label}…</option>
            {conditions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>,
        );
        if (v === undefined || v === "") return false;
        continue;
      }
      if (s.kind === "amount") {
        const mod = typeof v === "string" && /^(your|its):/.test(v);
        out.push(
          <span key={key} className="inline-flex items-center gap-1">
            <select className="select select-xs w-auto" value={mod ? String(v).split(":")[0] : "n"} data-blank={`${s.id}_kind`} onChange={(e) => set({ ...rule, [s.id]: e.target.value === "n" ? "" : `${e.target.value}:${ATTRIBUTES[0]}` })}>
              <option value="n">dice or number</option>
              <option value="your">your … modifier</option>
              <option value="its">its … modifier</option>
            </select>
            {mod ? (
              <select className="select select-xs w-auto" value={String(v).split(":")[1]} onChange={(e) => set({ ...rule, [s.id]: `${String(v).split(":")[0]}:${e.target.value}` })}>
                {ATTRIBUTES.map((a) => <option key={a} value={a}>{cap(a)}</option>)}
              </select>
            ) : (
              <input className="input input-xs w-20" placeholder="1d6" value={v === undefined ? "" : String(v)} data-blank={s.id} onChange={(e) => set({ ...rule, [s.id]: e.target.value.replace(/\s/g, "") })} />
            )}
            {mod && <span>modifier</span>}
          </span>,
        );
        if (v === undefined || v === "") return false;
        continue;
      }
      // Dice or a number.
      out.push(
        <input key={key} className={`input input-xs ${s.kind === "dice" ? "w-20" : "w-16"}`} placeholder={s.kind === "dice" ? "2d6" : s.label} inputMode={s.kind === "number" ? "numeric" : undefined}
          value={v === undefined ? "" : String(v)} data-blank={s.id}
          onChange={(e) => { const t = e.target.value.replace(/\s/g, ""); set({ ...rule, [s.id]: s.kind === "number" && t !== "" && Number.isFinite(Number(t)) ? Number(t) : t }); }} />,
      );
      if (v === undefined || v === "") return false;
    }
    return true;
  };
  walk(slots);
  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}

/** Every blank id inside some slots (to clear an optional part as it's taken off). */
const idsIn = (slots: Slot[]): string[] => slots.flatMap((s) => (s.kind === "word" ? [] : s.kind === "optional" ? [s.id, ...idsIn(s.slots)] : s.kind === "choice" ? [s.id, ...s.options.flatMap((o) => idsIn(o.next ?? []))] : [s.id]));

/** A choice blank: a dropdown of its options (the sentence's first one grouped). */
function ChoiceBlank({ slot, value, first, onPick }: { slot: Extract<Slot, { kind: "choice" }>; value?: string; first: boolean; onPick: (v: string) => void }) {
  const opt = (o: Option) => <option key={o.value} value={o.value}>{o.text || "(untyped)"}</option>;
  return (
    <select className={`select select-xs w-auto ${value === undefined ? "select-primary" : ""}`} value={value ?? "__"} data-blank={slot.id} onChange={(e) => onPick(e.target.value)}>
      <option value="__" disabled>{slot.label}…</option>
      {first
        ? GROUPS.map(([label, values]) => <optgroup key={label} label={label}>{slot.options.filter((o) => values.includes(o.value)).map(opt)}</optgroup>)
        : slot.options.map(opt)}
    </select>
  );
}
