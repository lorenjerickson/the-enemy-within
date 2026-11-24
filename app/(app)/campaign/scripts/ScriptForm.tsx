import ScriptEditor from "../../ScriptEditor";
import { scriptNames } from "@/lib/scriptNames";
import type { LibraryScript } from "@/lib/scriptLibrary";
import { removeLibraryScript, submitLibraryScript } from "./actions";

/** A library script: its name (what run('…') calls it by), what it's for, and the script. */
export default function ScriptForm({ initial }: { initial?: LibraryScript }) {
  return (
    <div className="max-w-2xl space-y-3">
      <form id="script-form" action={submitLibraryScript.bind(null, initial?.id ?? null)} className="space-y-3">
        <h2 className="text-xl font-semibold">{initial ? "Edit script" : "New script"}</h2>
        <input name="name" required placeholder="Name (e.g. open the vault)" defaultValue={initial?.name} className="input w-full" data-script-name />
        <input name="description" placeholder="What it does (shown when picking it)" defaultValue={initial?.description} className="input w-full" />
        <ScriptEditor name="source" label="Script" placeholder={"e.g. game.doors['vault'].open = true"} defaultValue={initial?.source} names={scriptNames()} minLines={8} />
        <p className="text-xs opacity-60">Run it from any other script with <code>run(&apos;{initial?.name ?? "its name"}&apos;)</code>: it runs there, as part of that script.</p>
      </form>
      <div className="flex gap-2">
        <button form="script-form" className="btn btn-primary">Save script</button>
        {initial && (
          <form action={removeLibraryScript.bind(null, initial.id)}>
            <button className="btn btn-ghost text-error">Delete</button>
          </form>
        )}
      </div>
    </div>
  );
}
