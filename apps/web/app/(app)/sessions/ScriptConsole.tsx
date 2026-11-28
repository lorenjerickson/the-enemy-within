"use client";

import { useState, useTransition } from "react";
import type { ScriptResult } from "@/lib/game";
import { runScript } from "./actions";
import { ScriptPickOverlay, runWithPrompts } from "./ScriptPick";
import ScriptEditor from "../ScriptEditor";
import type { ScriptNames } from "@/lib/scriptSchema";

const EXAMPLE = `with game.players['annis'] as A
   IF A.attributes.might > 12
      THEN A.conditions.add('strong')
A.health += 10`;

/** Run a game script and see its result. Changes to game state are saved. */
export function ScriptConsole({ names }: { names: ScriptNames }) {
  const [source, setSource] = useState("");
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [pending, startTransition] = useTransition();

  const runSource = (src: string) => startTransition(async () => setResult(await runWithPrompts("console", (answers) => runScript(src, answers))));
  const run = () => source.trim() && runSource(source);
  const library = names.script ?? [];
  return (
    <form
      className="flex flex-col gap-2 max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <ScriptEditor label="Script" placeholder={EXAMPLE} names={names} minLines={8} onChange={setSource} onSubmit={run} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={pending || !source.trim()}>Run</button>
        <span className="text-xs opacity-60">⌘/Ctrl+Enter. See docs/scripting.md.</span>
      </div>
      {library.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-console-library>
          <span className="opacity-60">Run from the library:</span>
          {library.map((s) => (
            <button key={s} type="button" className="btn btn-xs" disabled={pending} title={names.about?.[s]} onClick={() => runSource(`run(${s.includes("'") ? `"${s}"` : `'${s}'`})`)}>{s}</button>
          ))}
        </div>
      )}
      <ScriptPickOverlay owner="console" />
      {result && (
        <pre data-script-result className={`rounded-box bg-base-200 p-3 text-sm overflow-auto max-h-96 ${result.ok ? "" : "text-error"}`}>
          {result.ok ? result.value : result.error}
        </pre>
      )}
    </form>
  );
}
