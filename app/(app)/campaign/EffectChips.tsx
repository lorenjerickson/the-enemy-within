"use client";

import { useState } from "react";

export type EffectOption = { id: number; name: string; about: string; unavailable?: string };

/**
 * Picks catalog effects: type to find one, Enter or click adds it as a chip (✕ or Backspace takes it off). Each chip
 * is a hidden input `name` = its id. An option with `unavailable` is listed, greyed out with the reason, never added.
 */
export default function EffectChips({ name, options, initial }: { name: string; options: EffectOption[]; initial: number[] }) {
  const [picked, setPicked] = useState<number[]>(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !picked.includes(o.id) && (!q || o.name.toLowerCase().includes(q)));
  const pickable = matches.filter((o) => !o.unavailable);
  const add = (o: EffectOption) => { setPicked((p) => [...p, o.id]); setQuery(""); setActive(0); };
  const byId = new Map(options.map((o) => [o.id, o]));

  return (
    <div className="relative">
      <div className="input input-sm flex h-auto min-h-8 w-full flex-wrap items-center gap-1 py-1">
        {picked.map((id) => (
          <span key={id} className="badge badge-primary gap-1" title={byId.get(id)?.about}>
            {byId.get(id)?.name ?? `#${id}`}
            <button type="button" aria-label={`Remove ${byId.get(id)?.name}`} onClick={() => setPicked((p) => p.filter((x) => x !== id))}>✕</button>
            <input type="hidden" name={name} value={id} />
          </span>
        ))}
        <input
          value={query}
          placeholder={picked.length ? "" : "Type to add an effect…"}
          className="min-w-32 flex-1 bg-transparent outline-none"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, pickable.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); if (pickable[active]) add(pickable[active]); } // never submits the action form
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Backspace" && !query && picked.length) setPicked((p) => p.slice(0, -1));
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="menu absolute z-20 mt-1 max-h-64 w-full flex-nowrap overflow-y-auto rounded-box bg-base-100 p-1 shadow">
          {matches.map((o) => (
            <li key={o.id} className={o.unavailable ? "menu-disabled" : ""}>
              <button
                type="button"
                disabled={!!o.unavailable}
                className={`flex flex-col items-start gap-0 ${pickable[active]?.id === o.id ? "menu-active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); if (!o.unavailable) add(o); }}
              >
                <span>{o.name}{o.unavailable && <span className="ml-2 text-xs opacity-60">({o.unavailable})</span>}</span>
                {o.about && <span className="text-xs opacity-60">{o.about}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
