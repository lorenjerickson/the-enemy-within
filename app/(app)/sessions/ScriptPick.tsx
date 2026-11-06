"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ScriptResult } from "@/lib/game";
import type { ScriptAnswer, ScriptAnswers, ScriptPrompt } from "@/lib/scriptPrompt";

/**
 * The questions a running script puts to the GM (select(), ask()), answered one step at a time in one overlay, like a
 * wizard. `owner` is the component that ran the script (the console, a map button…), which shows the overlay; the map
 * highlights a select()'s options and clicks pick them.
 */
type Reply = { answer: ScriptAnswer } | "back" | null;
type Pick = {
  owner: string;
  prompt: ScriptPrompt;
  step: number; // from 1
  selected: number[]; // select()
  value: string | boolean; // ask(): what's typed (or yes/no)
  busy: boolean; // the script is running again with the answer
  done: (r: Reply) => void;
};
let pick: Pick | null = null;
const listeners = new Set<() => void>();
const set = (p: Pick | null) => {
  pick = p;
  listeners.forEach((l) => l());
};

export function useScriptPick(): Pick | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pick,
    () => null
  );
}

/** Click picks just this one; shift+click adds it to (or takes it out of) the selection. */
export function choose(id: number, add: boolean) {
  if (!pick || pick.busy || pick.prompt.kind !== "select" || !pick.prompt.options.some((o) => o.id === id)) return;
  const has = pick.selected.includes(id);
  set({ ...pick, selected: add ? (has ? pick.selected.filter((x) => x !== id) : [...pick.selected, id]) : [id] });
}

function reply(r: Reply) {
  if (!pick || pick.busy) return;
  const p = pick;
  set({ ...p, busy: true });
  p.done(r);
}

function ask(owner: string, prompt: ScriptPrompt, step: number, previous?: ScriptAnswer): Promise<Reply> {
  if (pick && pick.owner !== owner) pick.done(null); // a script from elsewhere replaces one still waiting
  const initial = prompt.kind === "input" ? (previous ?? prompt.initial) : null;
  return new Promise((done) =>
    set({
      owner, prompt, step, busy: false, done,
      selected: prompt.kind === "select" && Array.isArray(previous) ? previous : [],
      value: typeof initial === "boolean" ? initial : initial === null ? (prompt.kind === "input" && prompt.input === "yes/no" ? false : "") : String(initial),
    })
  );
}

/** Runs a script, answering its questions as it asks them (it runs again from the start with the answers so far). */
export async function runWithPrompts(owner: string, run: (answers: ScriptAnswers) => Promise<ScriptResult>): Promise<ScriptResult> {
  const answers: ScriptAnswers = [];
  let previous: ScriptAnswer | undefined; // shown again after Back
  try {
    for (;;) {
      const r = await run(answers);
      if (r.ok || !r.prompt) return r;
      const got = await ask(owner, r.prompt, answers.length + 1, previous);
      previous = undefined;
      if (!got) return { ok: false, error: "Cancelled" };
      if (got === "back") previous = answers.pop();
      else answers.push(got.answer);
    }
  } finally {
    if (pick?.owner === owner) set(null);
  }
}

/** The overlay: this step's question, its choices or input, and Back / Cancel / Next (Confirm). */
export function ScriptPickOverlay({ owner }: { owner: string }) {
  const p = useScriptPick();
  const input = useRef<HTMLInputElement>(null);
  const key = p ? `${p.step}${p.prompt.text}` : "";
  useEffect(() => input.current?.focus(), [key]);
  if (!p || p.owner !== owner) return null;
  const { prompt, selected, busy } = p;
  const answer = (): ScriptAnswer | null => {
    if (prompt.kind === "select") return selected.length ? selected : null;
    if (prompt.input === "yes/no") return !!p.value;
    if (prompt.input === "number") return String(p.value).trim() !== "" && Number.isFinite(Number(p.value)) ? Number(p.value) : null;
    return String(p.value);
  };
  const ready = answer() !== null;
  const submit = () => {
    const a = answer();
    if (a !== null) reply({ answer: a });
  };
  // On <body>: inside the dock (blurred backdrop) "fixed" would be relative to the panel.
  return createPortal(
    <form
      data-script-pick
      onSubmit={(e) => (e.preventDefault(), submit())}
      onKeyDown={(e) => e.key === "Escape" && reply(null)}
      className={`fixed left-1/2 top-3 z-40 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 space-y-2 rounded-box border border-warning bg-base-100/95 p-3 text-sm shadow-xl ${busy ? "opacity-70" : ""}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{prompt.text}</span>
        <span className="ml-auto text-xs opacity-60">Step {p.step}</span>
      </div>
      {prompt.kind === "select" ? (
        <>
          <div className="text-xs opacity-70">
            {prompt.entity ? "Click one on the map (shift+click to choose several), or pick from the list." : "Pick from the list (several allowed)."}
          </div>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {prompt.options.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected.includes(o.id)}
                className={`btn btn-xs ${selected.includes(o.id) ? "btn-primary" : "btn-ghost border-base-300"}`}
                onClick={(e) => choose(o.id, e.shiftKey || !prompt.entity)}
              >
                {o.name}
              </button>
            ))}
          </div>
          <div data-script-pick-selected className="truncate text-xs">
            {selected.length ? <>Selected: <span className="font-semibold">{selected.map((id) => prompt.options.find((o) => o.id === id)?.name ?? `#${id}`).join(", ")}</span></> : <span className="opacity-60">Nothing selected</span>}
          </div>
        </>
      ) : prompt.input === "yes/no" ? (
        <div className="join" data-script-input>
          {[true, false].map((v) => (
            <button key={String(v)} type="button" aria-pressed={p.value === v} className={`btn btn-sm join-item ${p.value === v ? "btn-primary" : ""}`} onClick={() => set({ ...p, value: v })}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
      ) : (
        <input
          ref={input}
          data-script-input
          type={prompt.input === "number" ? "number" : "text"}
          step="any"
          value={String(p.value)}
          onChange={(e) => set({ ...p, value: e.target.value })}
          className="input input-sm w-full"
        />
      )}
      <div className="flex items-center justify-end gap-2">
        {p.step > 1 && <button type="button" className="btn btn-sm btn-ghost mr-auto" disabled={busy} onClick={() => reply("back")}>Back</button>}
        <button type="button" className="btn btn-sm" onClick={() => (busy ? undefined : reply(null))} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ready || busy}>{busy ? "…" : "Confirm"}</button>
      </div>
    </form>,
    document.body
  );
}
