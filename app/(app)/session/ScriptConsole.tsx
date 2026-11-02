"use client";

import { useState, useTransition } from "react";
import { runScript, type ScriptResult } from "./actions";

const EXAMPLE = `with game.players['annis'] as A
   IF A.attributes.might > 12
      THEN A.conditions.add('strong')
A.health += 10`;

/** Run a game script and see its result. Changes to game state are saved. */
export function ScriptConsole() {
  const [source, setSource] = useState("");
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-2 max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setResult(await runScript(source)));
      }}
    >
      <textarea
        aria-label="Script"
        className="textarea textarea-bordered w-full font-mono text-sm"
        rows={8}
        spellCheck={false}
        placeholder={EXAMPLE}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={pending || !source.trim()}>Run</button>
        <span className="text-xs opacity-60">⌘/Ctrl+Enter. See docs/scripting.md.</span>
      </div>
      {result && (
        <pre data-script-result className={`rounded-box bg-base-200 p-3 text-sm overflow-auto max-h-96 ${result.ok ? "" : "text-error"}`}>
          {result.ok ? result.value : result.error}
        </pre>
      )}
    </form>
  );
}
