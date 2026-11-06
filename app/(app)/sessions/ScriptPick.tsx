"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ScriptResult } from "@/lib/game";
import type { ScriptAnswers, SelectPrompt } from "@/lib/scriptPrompt";

/**
 * A script's select() prompt while the GM answers it. One at a time; `owner` is the component that ran the script
 * (the console, a map button…), which shows the overlay. The map highlights the options and clicks pick them.
 */
type Pick = { owner: string; prompt: SelectPrompt; selected: number[]; done: (ids: number[] | null) => void };
let pick: Pick | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useScriptPick(): Pick | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pick,
    () => null
  );
}

/** Click picks just this one; shift+click adds it to (or takes it out of) the selection. */
export function choose(id: number, add: boolean) {
  if (!pick || !pick.prompt.options.some((o) => o.id === id)) return;
  const has = pick.selected.includes(id);
  const selected = add ? (has ? pick.selected.filter((x) => x !== id) : [...pick.selected, id]) : [id];
  pick = { ...pick, selected };
  emit();
}

function finish(ids: number[] | null) {
  const p = pick;
  pick = null;
  emit();
  p?.done(ids);
}

function ask(owner: string, prompt: SelectPrompt): Promise<number[] | null> {
  if (pick) pick.done(null); // a new script replaces one still waiting
  return new Promise((done) => {
    pick = { owner, prompt, selected: [], done };
    emit();
  });
}

/** Runs a script, answering its prompts as it asks them (it runs again from the start with each answer). */
export async function runWithPrompts(owner: string, run: (answers: ScriptAnswers) => Promise<ScriptResult>): Promise<ScriptResult> {
  const answers: ScriptAnswers = [];
  for (;;) {
    const r = await run(answers);
    if (r.ok || !r.prompt) return r;
    const ids = await ask(owner, r.prompt);
    if (!ids) return { ok: false, error: "Cancelled" };
    answers.push(ids);
  }
}

/** The prompt's overlay: the instructions, the choices (selected ones highlighted), Confirm and Cancel. */
export function ScriptPickOverlay({ owner }: { owner: string }) {
  const p = useScriptPick();
  if (!p || p.owner !== owner) return null;
  const { prompt, selected } = p;
  const names = selected.map((id) => prompt.options.find((o) => o.id === id)?.name ?? `#${id}`);
  // On <body>: inside the dock (blurred backdrop) "fixed" would be relative to the panel.
  return createPortal(
    <div data-script-pick className="fixed left-1/2 top-3 z-40 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 space-y-2 rounded-box border border-warning bg-base-100/95 p-3 text-sm shadow-xl">
      <div className="font-semibold">{prompt.text}</div>
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
      <div className="flex items-center gap-2">
        <span data-script-pick-selected className="flex-1 truncate text-xs">
          {names.length ? <>Selected: <span className="font-semibold">{names.join(", ")}</span></> : <span className="opacity-60">Nothing selected</span>}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => finish(null)}>Cancel</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!selected.length} onClick={() => finish(selected)}>Confirm</button>
      </div>
    </div>,
    document.body
  );
}
