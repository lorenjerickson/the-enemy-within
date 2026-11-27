"use client";

import { useState } from "react";
import type { Duration, Modifier } from "@/lib/conditions";
import { checkRule, render, type Filled } from "@/lib/effectGrammar";

import { ENDS_ON, answerLine, answersFromEffect, effectCard, lifecyclePosted, questions, type Answers, type Question } from "@/lib/effectWizard";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import { Choices, NumberBox } from "../interviewParts";
import EffectBuilder from "./EffectBuilder";

const DURATIONS: [Duration, string, string][] = [
  ["rounds", "A number of rounds", "Put on by an action, a trap or the GM; six seconds a round."],
  ["equipped", "While equipped", "What an item gives whoever wears or holds it."],
  ["always", "Always", "A creature's own: it never wears off."],
];

type Saved = Partial<Answers> & Record<string, unknown>;
const WHY: Partial<Record<Question, string>> = { name: "Give it a name.", rules: "Finish or remove the unfinished rule.", duration: "Say how many rounds." };

/** An ability to save with. */
function Ability({ value, onChange }: { value: Attribute; onChange: (a: Attribute) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value as Attribute)} className="select select-sm w-auto">{ATTRIBUTES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select>;
}

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
  const valid = (q: Question) => q === "name" ? !!a.name.trim()
    : q === "duration" ? a.duration !== "rounds" || a.rounds >= 1
    : q === "rules" ? !!builtinRules || a.rules.every((r) => !checkRule(r))
    : true;
  const ok = valid(at), allOk = qs.every(valid);
  const next = () => { if (ok && !last) setAt(qs[i + 1]); };

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
        {effectCard(a, builtinRules?.sentences ?? a.rules.filter((r) => !checkRule(r)).map((r) => render(r))).map((l, k) => <p key={k}>{l}</p>)}
      </div>
      <ol className="space-y-0.5 text-sm" data-answers>
        {qs.filter((q) => seen.has(q) && q !== at).length > 0 && qs.map((q) => {
          if (!seen.has(q)) return null;
          const [label, value] = q === "rules" && builtinRules ? ["What it does", builtinRules.sentences.join("; ") || "—"] : answerLine(q, a, ruleText);
          return (
            <li key={q}>
              <button type="button" onClick={() => setAt(q)} className={`flex w-full gap-2 rounded px-1 text-left hover:bg-base-300 ${q === at ? "bg-base-300 font-semibold" : ""}`}>
                <span className="w-40 shrink-0 opacity-60">{label}</span><span className={q === "rules" ? "" : "truncate"}>{value}</span>
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
        {at === "resist" && (
          <>
            <div className="text-sm font-semibold">Can they resist it as it lands?</div>
            <Choices value={a.resist ? "yes" : "no"} options={[["no", "No", "it always takes hold"], ["yes", "Yes", "a save the moment it's put on"]]} onPick={(v) => set({ resist: v === "yes" })} />
            {a.resist && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Ability value={a.resistAttr} onChange={(resistAttr) => set({ resistAttr })} /> save, DC
                <NumberBox min={1} max={40} value={a.resistDc} onChange={(resistDc) => set({ resistDc })} className="input input-sm w-20" />
                <select value={a.resistOutcome} onChange={(e) => set({ resistOutcome: e.target.value as Answers["resistOutcome"] })} className="select select-sm w-auto">
                  <option value="negates">a success keeps it off</option><option value="halves">a success halves how long it lasts</option>
                </select>
              </div>
            )}
            <p className="text-xs opacity-60">When something puts it on with damage that has its own save, that save decides it instead (it lands if the damage does).</p>
          </>
        )}
        {at === "shake" && (
          <>
            <div className="text-sm font-semibold">Can they shake it off before it runs out?</div>
            <Choices value={a.shake ? "yes" : "no"} options={[["no", "No", "it lasts its rounds"], ["yes", "Yes", "a save to end it"]]} onPick={(v) => set({ shake: v === "yes" })} />
            {a.shake && (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Ability value={a.shakeAttr} onChange={(shakeAttr) => set({ shakeAttr })} /> save, DC
                  <NumberBox min={1} max={40} value={a.shakeDc} onChange={(shakeDc) => set({ shakeDc })} className="input input-sm w-20" />
                  <select value={a.shakeWhen} onChange={(e) => set({ shakeWhen: e.target.value as Answers["shakeWhen"] })} className="select select-sm w-auto">
                    <option value="end">at the end of each round</option><option value="start">at the start of each round</option><option value="damaged">when they take damage</option>
                  </select>
                </div>
                <label className="flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-sm" checked={a.shakeAction} onChange={(e) => set({ shakeAction: e.target.checked })} />they can also spend their action on it (Shake off)</label>
              </div>
            )}
          </>
        )}
        {at === "ends" && (
          <>
            <div className="text-sm font-semibold">Does anything else end it early?</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {ENDS_ON.map(([k, label]) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-box border p-2 text-sm ${a.endsOn.includes(k) ? "border-primary" : "border-base-300"}`}>
                  <input type="checkbox" className="checkbox checkbox-sm" checked={a.endsOn.includes(k)} onChange={(e) => set({ endsOn: e.target.checked ? [...a.endsOn, k] : a.endsOn.filter((x) => x !== k) })} />
                  It ends when {label}
                </label>
              ))}
            </div>
            <p className="text-xs opacity-60">None ticked: it lasts its rounds (or until shaken off).</p>
          </>
        )}
        {at === "again" && (
          <>
            <div className="text-sm font-semibold">What if it's put on again while it's still on?</div>
            <Choices value={a.again} options={[["refresh", "It starts over", "its rounds count from the start again"], ["stack", "Another copy runs alongside", "each lasts its own rounds"], ["ignore", "Nothing happens", "the one already on carries on"]]} onPick={(again) => set({ again })} />
            {a.again === "stack" && (
              <label className="flex items-center gap-2 text-sm">at most <NumberBox min={0} max={99} value={a.stackLimit} onChange={(stackLimit) => set({ stackLimit })} className="input input-sm w-16" /> copies at once <span className="text-xs opacity-60">(0: no limit)</span></label>
            )}
          </>
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
        {!allOk && <span className="text-xs text-warning">{WHY[qs.find((q) => !valid(q))!]}</span>}
      </div>
    </form>
  );
}
