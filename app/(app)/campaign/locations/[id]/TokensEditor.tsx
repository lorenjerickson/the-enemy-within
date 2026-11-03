"use client";

import { useRef, useState } from "react";
import type { MapToken } from "@/lib/db";

/** Something that can be placed as a token: a creature (any number of times) or a character (once). */
export interface TokenCreature {
  kind: "creature" | "character";
  id: number;
  name: string;
  type: string;
  image: string | null;
  token_overhead: string | null;
  token_side: string | null;
}

/** Tokens layer editor: pick a character or creature from a modal to place, and list / delete placed tokens. */
export default function TokensEditor({
  creatures,
  creature,
  onCreatureChange,
  tokens,
  selectedId,
  onSelect,
  onDelete,
}: {
  creatures: TokenCreature[];
  creature: TokenCreature | null;
  onCreatureChange: (c: TokenCreature) => void;
  tokens: MapToken[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = creatures.filter((c) => !q || c.name.toLowerCase().includes(q) || c.type.includes(q) || c.kind.includes(q));
  const same = (a: TokenCreature | null, b: TokenCreature) => a?.kind === b.kind && a.id === b.id;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {creature && (creature.image ? <img src={creature.image} alt="" className="size-10 rounded-full object-cover" /> : <div className="size-10 rounded-full bg-base-300" />)}
        <span className="text-sm">{creature ? creature.name : "Nothing selected"}</span>
        <button type="button" className="btn btn-sm" onClick={() => dialog.current?.showModal()}>
          Select character or creature…
        </button>
      </div>
      <p className="text-xs opacity-60">
        {creature
          ? creature.kind === "character"
            ? `Click the map to place ${creature.name} (a character appears once, so this moves them if they're already on a map). `
            : `Click an empty grid cell to place a ${creature.name} token. `
          : ""}
        Drag any token to move it.
      </p>

      <dialog ref={dialog} className="modal">
        <div className="modal-box max-w-3xl space-y-3">
          <h3 className="font-semibold">Characters and creatures</h3>
          <input type="search" placeholder="Search by name, type, character or creature…" value={query} onChange={(e) => setQuery(e.target.value)} className="input input-sm w-full" />
          {shown.length === 0 ? (
            <p className="text-sm opacity-60">{creatures.length === 0 ? "No characters or creatures defined yet." : "Nothing matches."}</p>
          ) : (
            <ul className="grid grid-cols-4 gap-3 max-h-80 overflow-y-auto">
              {shown.map((c) => (
                <li key={`${c.kind}-${c.id}`}>
                  <button
                    type="button"
                    data-creature={c.name}
                    className={`w-full rounded-box p-2 text-left hover:bg-base-200 ${same(creature, c) ? "ring-2 ring-primary" : ""}`}
                    onClick={() => {
                      onCreatureChange(c);
                      dialog.current?.close();
                    }}
                  >
                    {c.image ? <img src={c.image} alt="" className="aspect-square w-full rounded object-cover" /> : <div className="aspect-square w-full rounded bg-base-300" />}
                    <div className="mt-1 truncate text-sm">{c.name}</div>
                    <div className="text-xs opacity-60">{c.kind === "character" ? `character · ${c.type}` : c.type}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
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

      <div className="space-y-1">
        <div className="text-sm font-semibold">Placed tokens</div>
        {tokens.length === 0 ? (
          <p className="text-xs opacity-60">None yet.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto rounded-box bg-base-100 text-sm">
            {tokens.map((t) => (
              <li key={t.id} className={`flex items-center gap-2 px-2 py-1 ${t.id === selectedId ? "bg-primary/20" : ""}`}>
                <button type="button" data-token={t.id} onClick={() => onSelect(t.id)} className="flex flex-1 items-center gap-2 text-left">
                  {t.image ? <img src={t.image} alt="" className="size-6 rounded-full object-cover" /> : <div className="size-6 rounded-full bg-base-300" />}
                  <span>{t.name}</span>
                  <span className="text-xs opacity-60">{t.character_id ? "character" : "creature"} · col {t.col}, row {t.row}</span>
                </button>
                {t.id === selectedId && (
                  <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => onDelete(t.id)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
