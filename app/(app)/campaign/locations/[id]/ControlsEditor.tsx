"use client";

import { useRef, useState } from "react";
import type { MapControl } from "@/lib/db";
import { CONTROL_EDGES } from "@/lib/maps";
import { removeControl, submitControl } from "../actions";
import GameIcon, { ICON_NAMES, iconWords } from "./GameIcon";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Controls layer editor: add icon buttons (with a tooltip label) along each edge of the scene, remove them. */
export default function ControlsEditor({ locationId, levelId, controls }: { locationId: number; levelId: number; controls: MapControl[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [icon, setIcon] = useState("GiClick");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = ICON_NAMES.filter((n) => !q || iconWords(n).includes(q)).slice(0, 160);

  return (
    <div className="space-y-3">
      <form key={controls.length} action={submitControl.bind(null, locationId, levelId)} className="flex items-center gap-2">
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

      <div className="grid grid-cols-4 gap-3 text-sm">
        {CONTROL_EDGES.map((edge) => (
          <div key={edge} className="space-y-1">
            <div className="font-semibold">{capitalize(edge)}</div>
            {controls.filter((c) => c.edge === edge).length === 0 && <p className="text-xs opacity-60">None</p>}
            {controls
              .filter((c) => c.edge === edge)
              .map((c) => (
                <div key={c.id} data-control={c.label} className="flex items-center gap-1">
                  <GameIcon name={c.icon} className="size-4" />
                  <span className="flex-1 truncate">{c.label}</span>
                  <form action={removeControl.bind(null, locationId, c.id)}>
                    <button title="Remove this button" className="btn btn-ghost btn-xs text-error">✕</button>
                  </form>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
