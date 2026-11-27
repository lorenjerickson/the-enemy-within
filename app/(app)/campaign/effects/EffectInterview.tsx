"use client";

import { useState } from "react";
import type { Condition, Duration, Modifier } from "@/lib/conditions";
import { checkRule, compile, render, type Filled } from "@/lib/effectGrammar";
import { conditionParts } from "@/lib/actionSummary";
import { answerLine, answersFromEffect, lifecycleFromAnswers, lifecyclePosted, questions, type Answers, type Question } from "@/lib/effectWizard";
import { Choices, NumberBox } from "../interviewParts";
import EffectBuilder from "./EffectBuilder";

const DURATIONS: [Duration, string, string][] = [
  ["rounds", "A number of rounds", "Put on by an action, a trap or the GM; six seconds a round."],
  ["equipped", "While equipped", "What an item gives whoever wears or holds it."],
  ["always", "Always", "A creature's own: it never wears off."],
];

type Saved = Partial<Answers> & Record<string, unknown>;

/**
 * The effect editor as an interview (backlog V): the effect's card on top in plain words, the answers so far (click
 * one to go back), then one question at a time. Posts what the old form posted: name, description, rules (from the
 * sentence builder) and the "how long it lasts" sentences.
 */
export default function EffectInterview({ action, initial, initialRules, builtinRules, conditions }: {
  action: (f: FormData) => void;
  initial?: Saved;
  initialRules: Filled[];
  builtinRules?: { sentences: string[]; modifiers: Modifier[] }; // a built-in effect's rules: shown, not changed
  conditions: { id: number; name: string }[];
}) {
  const [a, setA] = useState<Answers>(() => answersFromEffect(initial as never, initialRules));
  const [at, go] = useState<Question>("name");
  const [seen, setSeen] = useState<Set<Question>>(() => new Set(initial ? questions(answersFromEffect(initial as never, initialRules)) : ["name"]));
  const setAt = (q: Question) => { go(q); setSeen((x) => new Set(x).add(q)); };
  const set = (p: Partial<Answers>) => setA((x) => ({ ...x, ...p }));
  const qs = questions(a);
  const i = Math.max(0, qs.indexOf(at));
  const last = i === qs.length - 1;
  const conditionId = (name: string) => conditions.find((c) => c.name === name)?.id ?? -1;
  const valid = (q: Question) => q === "name" ? !!a.name.trim()
    : q === "duration" ? a.duration !== "rounds" || a.rounds >= 1
    : q === "rules" ? !!builtinRules || a.rules.every((r) => !checkRule(r))
    : true;
  const ok = valid(at), allOk = qs.every(valid);
  const next = () => { if (ok && !last) setAt(qs[i + 1]); };

  // The card: what it does and its save as it lands, in the words an action's card uses for it.
  const modifiers = builtinRules?.modifiers ?? a.rules.filter((r) => !checkRule(r)).flatMap((r) => compile(r, conditionId).modifiers);
  const c: Condition = { ...lifecycleFromAnswers(a), id: 0, name: a.name || "This effect", description: a.description, effects: [{ id: 0, name: a.name, description: a.description, modifiers }] };
  const { how, save } = conditionParts(c, "them");
  const ruleText = (r: Filled) => render(r);

  return (
    <form action={action} className="max-w-2xl space-y-3 rounded-box bg-base-200 p-3" data-effect-interview
      onKeyDown={(e) => {
        // Enter goes on to the next question; it saves only at the last one, with every answer good.
        const tag = (e.target as HTMLElement).tagName;
        if (e.key !== "Enter" || e.defaultPrevented || tag === "TEXTAREA" || tag === "BUTTON" || at === "rules") return;
        e.preventDefault();
        if (!last) next();
        else if (allOk) e.currentTarget.requestSubmit();
      }}>
      <input type="hidden" name="name" value={a.name} />
      <input type="hidden" name="description" value={a.description} />
      <input type="hidden" name="lifecycle" value={JSON.stringify(lifecyclePosted(a))} />
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm" aria-live="polite">
        <div className="mb-1 text-xs uppercase opacity-60">The card reads</div>
        <p className="font-semibold">{a.name || "This effect"}</p>
        <p>{how ? how[0].toUpperCase() + how.slice(1) : "Does nothing yet."}{save ? `, ${save}` : ""}.</p>
      </div>
      <ol className="space-y-0.5 text-sm" data-answers>
        {qs.filter((q) => seen.has(q) && q !== at).length > 0 && qs.map((q) => {
          if (!seen.has(q)) return null;
          const [label, value] = q === "rules" && builtinRules ? ["What it does", builtinRules.sentences.join("; ") || "—"] : answerLine(q, a, ruleText);
          return (
            <li key={q}>
              <button type="button" onClick={() => setAt(q)} className={`flex w-full gap-2 rounded px-1 text-left hover:bg-base-300 ${q === at ? "bg-base-300 font-semibold" : ""}`}>
                <span className="w-40 shrink-0 opacity-60">{label}</span><span className="truncate">{value}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="text-xs opacity-60">Question {i + 1} of {qs.length}</div>
      <div className="space-y-2" data-question={at}>
        {at === "name" && (
          <>
            <label className="block text-sm font-semibold">What's it called, and what is it, in your words?</label>
            <input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name (e.g. Poisoned, Enervated, Fire resistance)" className="input input-sm w-full" />
            <textarea value={a.description} onChange={(e) => set({ description: e.target.value })} placeholder="Description (optional): how it looks and feels" className="textarea textarea-sm w-full" />
          </>
        )}
        {at === "duration" && (
          <>
            <div className="text-sm font-semibold">How long does it last?</div>
            <Choices value={a.duration} options={DURATIONS} onPick={(duration) => set({ duration })} />
            {a.duration === "rounds" && (
              <label className="flex items-center gap-2 text-sm">
                <NumberBox min={1} max={600} value={a.rounds} onChange={(rounds) => set({ rounds })} className="input input-sm w-20" /> rounds
                <span className="text-xs opacity-60">(10 rounds is a minute)</span>
              </label>
            )}
          </>
        )}
        {at === "rules" && builtinRules && (
          <>
            <div className="text-sm font-semibold">What does it do? <span className="font-normal opacity-60">(built in: its rules can't be changed)</span></div>
            <ul className="list-inside list-disc text-sm">{builtinRules.sentences.map((t, k) => <li key={k}>{t}</li>)}</ul>
          </>
        )}
        {(at === "resist" || at === "shake" || at === "ends" || at === "again") && (
          <p className="text-sm">{answerLine(at, a).join(": ")}</p>
        )}
      </div>
      {/* The rules builder stays mounted (it keeps its own sentences and posts them), shown only at its question. */}
      {!builtinRules && (
        <div className={at === "rules" ? "space-y-2" : "hidden"}>
          <div className="text-sm font-semibold">What does it do while it lasts, or when something happens?</div>
          <EffectBuilder initial={initialRules} conditions={conditions} onChange={(rules) => set({ rules })} />
        </div>
      )}
      <div className="flex items-center gap-2">
        {i > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAt(qs[i - 1])}>Back</button>}
        {!last && <button type="button" className="btn btn-sm" disabled={!ok} onClick={next}>Next</button>}
        <button className="btn btn-primary btn-sm" disabled={!allOk}>{initial ? "Save effect" : "Create effect"}</button>
      </div>
    </form>
  );
}
