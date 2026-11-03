"use client";

import { useRef, useState, useTransition } from "react";
import type { MapControl } from "@/lib/db";
import { CONTROL_EDGES } from "@/lib/maps";
import { changeControlScript, removeControl, submitControl } from "../actions";
import GameIcon, { ICON_NAMES, iconWords } from "./GameIcon";
import ScriptEditor from "../../../ScriptEditor";
import type { ScriptNames } from "@/lib/scriptSchema";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Controls layer editor: add icon buttons (with a tooltip label) along each edge of the scene, remove them. */
export default function ControlsEditor({
  locationId,
  levelId,
  controls,
  names,
}: {
  locationId: number;
  levelId: number;
  controls: MapControl[];
  names: ScriptNames; // for the script editor's suggestions
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [icon, setIcon] = useState("GiClick");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = controls.find((c) => c.id === editingId);
  const q = query.trim().toLowerCase();
  const matches = ICON_NAMES.filter((n) => !q || iconWords(n).includes(q)).slice(0, 160);

  return (
    <div className="space-y-3">
      <form key={`add-${controls.length}`} action={submitControl.bind(null, locationId, levelId)} className="flex items-center gap-2">
        <input type="hidden" name="icon" value={icon} />
        <button type="button" title="Choose icon" className="btn btn-sm btn-square" onClick={() => dialog.current?.showModal()}>
          <GameIcon name={icon} className="size-5" />
        </button>
        <input name="label" required placeholder="Tooltip label" className="input input-sm w-48" />
        <select name="edge" aria-label="Edge" defaultValue="bottom" className="select select-sm w-32">
          {CONTROL_EDGES.map((e) => (
            <option key={e} value={e}>{capitalize(e)}</option>
          ))}
        </select>
        <button className="btn btn-sm">Add button</button>
      </form>

      <dialog ref={dialog} className="modal">
        <div className="modal-box max-w-3xl space-y-3">
          <h3 className="font-semibold">Icons</h3>
          <input type="search" placeholder="Search icons (e.g. door, sword, dice)…" value={query} onChange={(e) => setQuery(e.target.value)} className="input input-sm w-full" />
          <ul className="grid grid-cols-10 gap-1 max-h-96 overflow-y-auto">
            {matches.map((n) => (
              <li key={n}>
                <button
                  type="button"
                  data-icon={n}
                  title={iconWords(n)}
                  className={`btn btn-ghost btn-square ${n === icon ? "btn-active" : ""}`}
                  onClick={() => {
                    setIcon(n);
                    dialog.current?.close();
                  }}
                >
                  <GameIcon name={n} className="size-6" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-60">
            Showing {matches.length} of {ICON_NAMES.filter((n) => !q || iconWords(n).includes(q)).length} matching icons.
          </p>
          <div className="modal-action mt-0">
            <form method="dialog">
              <button className="btn btn-sm">Close</button>
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* One list, in edge order (top, right, bottom, left), each row labelled with its position. */}
      {controls.length === 0 ? (
        <p className="text-xs opacity-60">No buttons yet.</p>
      ) : (
        <ul className="rounded-box bg-base-100 text-sm">
          {CONTROL_EDGES.flatMap((edge) => controls.filter((c) => c.edge === edge)).map((c) => (
            <li key={c.id} data-control={c.label} className={`flex items-center gap-2 px-2 py-1 ${c.id === editingId ? "bg-primary/25" : ""}`}>
              <GameIcon name={c.icon} className="size-4 shrink-0" />
              <button type="button" title="Edit this button's script" className="flex-1 truncate text-left hover:underline" onClick={() => setEditingId(c.id === editingId ? null : c.id)}>
                {c.label}
              </button>
              {c.script.trim() && <span title="Has a script" className="text-xs opacity-60">ƒ</span>}
              <span className="badge badge-ghost badge-sm" title="Edge of the map">{capitalize(c.edge)}</span>
              <form action={removeControl.bind(null, locationId, c.id)}>
                <button title="Remove this button" className="btn btn-ghost btn-xs text-error">✕</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ScriptForm key={`script-${editing.id}`} locationId={locationId} control={editing} names={names} />
      ) : (
        controls.length > 0 && <p className="text-xs opacity-60">Click a button&apos;s label to edit the script it runs.</p>
      )}
    </div>
  );
}

/** Edit the script a button runs when clicked on the map. */
function ScriptForm({ locationId, control, names }: { locationId: number; control: MapControl; names: ScriptNames }) {
  const [script, setScript] = useState(control.script);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const error = await changeControlScript(locationId, control.id, script);
          setMessage(error ? { ok: false, text: error } : { ok: true, text: "Saved" });
        });
      }}
    >
      <div className="text-sm font-semibold">Script for “{control.label}”</div>
      <ScriptEditor
        label="Button script"
        placeholder="game.vars.alarm = true"
        defaultValue={control.script}
        names={names}
        minLines={6}
        onChange={(text) => {
          setScript(text);
          setMessage(null);
        }}
      />
      <div className="flex items-center gap-3">
        <button className="btn btn-sm btn-primary" disabled={pending || script === control.script}>Save script</button>
        {message && <span data-script-message className={`text-xs ${message.ok ? "text-success" : "text-error"}`}>{message.text}</span>}
        <span className="text-xs opacity-60 ml-auto">See docs/scripting.md</span>
      </div>
    </form>
  );
}
