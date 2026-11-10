"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ATTRIBUTES } from "@/lib/attributes";
import { EFFECT_SENTENCE, checkRule, compile, idsUnder, readRule, render, type Filled, type Next, type Option, type Slot } from "@/lib/effectGrammar";

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
  const [view, setView] = useState<"sentences" | "text">("sentences");
  const [text, setText] = useState("");
  const update = (i: number, next: Filled) => setRules((rs) => rs.map((r, j) => (j === i ? next : r)));
  const conditionId = (name: string) => conditions.find((c) => c.name === name)?.id ?? -1;
  const names = conditions.map((c) => c.name);
  /** The rules a text says, a line each (a line that isn't a whole rule yet keeps what it has, so saving says what's missing). */
  const fromText = (t: string) => t.split("\n").filter((l) => l.trim()).map((l) => readRule(l, names).filled);
  const switchTo = (v: "sentences" | "text") => {
    if (v === view) return;
    if (v === "text") setText(rules.filter((r) => Object.keys(r).length && !checkRule(r)).map(render).join("\n")); // an unfinished sentence doesn't carry over
    else { const rs = fromText(text); setRules(rs.length ? rs : [{}]); }
    setView(v);
  };
  const saved = view === "text" ? fromText(text) : rules.filter((r) => Object.keys(r).length);
  return (
    <fieldset className="space-y-2 rounded-box border border-base-300 p-2" data-effect-builder>
      <legend className="px-1 text-sm font-semibold">Rules</legend>
      <input type="hidden" name="rules" value={JSON.stringify(saved)} />
      <div className="join" data-view-toggle>
        {(["sentences", "text"] as const).map((v) => (
          <button key={v} type="button" className={`btn join-item btn-xs ${view === v ? "btn-active" : ""}`} data-view={v} onClick={() => switchTo(v)}>{v === "sentences" ? "Sentences" : "Text"}</button>
        ))}
      </div>
      {view === "text" ? <TextView text={text} setText={setText} conditions={names} conditionId={conditionId} /> : rules.map((rule, i) => {
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
      {view === "sentences" && <button type="button" className="btn btn-ghost btn-sm" data-add-rule onClick={() => setRules((rs) => [...rs, {}])}>+ Add rule</button>}
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

/**
 * The rules as text, a line each, with autocomplete: where the line the cursor is on stops, what could come next
 * (Tab or Enter takes the highlighted one, arrows move, Escape closes). Each line is read against the same grammar.
 */
function TextView({ text, setText, conditions, conditionId }: { text: string; setText: (t: string) => void; conditions: string[]; conditionId: (n: string) => number }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(text.length);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(false);
  const caret = useRef<number | null>(null); // where the caret goes after a suggestion is taken (set as the text renders)
  useLayoutEffect(() => {
    if (caret.current === null || !area.current) return;
    area.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  /** The line the caret is on, up to the caret, read against the grammar. */
  const at = (pos: number) => { const start = text.lastIndexOf("\n", pos - 1) + 1; return { start, read: readRule(text.slice(start, pos), conditions) }; };
  const { read } = at(cursor);
  const offers: Next[] = closed ? [] : read.next.filter((n) => !n.hint).slice(0, 12);
  const hints = read.next.filter((n) => n.hint).map((n) => n.text);
  const take = (n: Next) => {
    const pos = area.current?.selectionStart ?? cursor, here = at(pos);
    const cut = pos - here.read.partial.length, lead = cut > here.start && !/[\s(]$/.test(text.slice(0, cut)) ? " " : "";
    const word = n.text === "." ? "." : n.text === "DC" ? "(DC" : n.text === "up" ? "(up" : n.text;
    const add = `${n.text === "." ? "" : lead}${word}${n.text === "." ? "" : " "}`;
    const next = text.slice(0, cut) + add + text.slice(pos);
    caret.current = cut + add.length;
    setText(next);
    setCursor(cut + add.length);
    setPick(0);
    area.current?.focus();
  };
  const lines = text.split("\n");
  return (
    <div className="space-y-1" data-text-view>
      <textarea ref={area} className="textarea textarea-sm w-full font-mono leading-6" rows={Math.max(4, lines.length + 1)} value={text} spellCheck={false} data-rules-text
        placeholder="One rule a line, e.g. When you hit a creature, add 1d6 fire damage."
        onChange={(e) => { setText(e.target.value); setCursor(e.target.selectionStart); setClosed(false); setPick(0); }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (!offers.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => (p + 1) % offers.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => (p - 1 + offers.length) % offers.length); }
          else if (e.key === "Tab" || (e.key === "Enter" && read.partial)) { e.preventDefault(); take(offers[pick] ?? offers[0]); }
          else if (e.key === "Escape") setClosed(true);
        }} />
      {(offers.length > 0 || hints.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-suggestions>
          <span className="opacity-60">Next:</span>
          {offers.map((n, i) => <button key={n.text} type="button" className={`btn btn-xs ${i === pick ? "btn-primary" : "btn-ghost"}`} data-suggestion={n.text} onMouseDown={(e) => { e.preventDefault(); take(n); }}>{n.text === "." ? "(end)" : n.text}</button>)}
          {hints.map((h) => <span key={h} className="opacity-60">type {h === "2d6" || h === "1d6" ? `dice (${h})` : `a number (${h})`}</span>)}
        </div>
      )}
      <ul className="space-y-0.5 text-xs" data-line-status>
        {lines.map((l, i) => {
          if (!l.trim()) return null;
          const r = readRule(l, conditions), out = r.complete ? compile(r.filled, conditionId) : null;
          const bad = !r.complete ? (r.error ?? "unfinished") : !out!.modifiers.length && !out!.creates ? `can't be saved yet: ${out!.notes.join("; ")}` : "";
          return <li key={i} className={bad ? "text-error" : out!.notes.length ? "text-warning" : "opacity-60"}>Line {i + 1}: {bad || (out!.notes.length ? `note: ${out!.notes.join("; ")}` : "✓")}</li>;
        })}
      </ul>
    </div>
  );
}
