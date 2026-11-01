"use client";

import Link from "next/link";
import { useState } from "react";

export interface ListEntry {
  id: number;
  href: string;
  name: string;
  description?: string | null;
  image?: string | null; // undefined = list has no images; null = placeholder
  type?: string;         // shown as a badge and used by the type filter
  note?: string;         // small text on the right
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Clickable list with a text search (name/description) and, when entries have types, a type filter. */
export default function FilterableList({ entries, empty }: { entries: ListEntry[]; empty: string }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const types = [...new Set(entries.map((e) => e.type).filter((t): t is string => !!t))].sort();
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      (!type || e.type === type) &&
      (!q || e.name.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q))
  );

  if (entries.length === 0) return <p className="opacity-70">{empty}</p>;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="input input-sm flex-1" />
        {types.length > 0 && (
          <select value={type} onChange={(e) => setType(e.target.value)} className="select select-sm w-48">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>{capitalize(t)}</option>
            ))}
          </select>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="opacity-70 text-sm">Nothing matches.</p>
      ) : (
        <ul className="list bg-base-200 rounded-box">
          {shown.map((e) => (
            <li key={e.id}>
              <Link href={e.href} className="list-row hover:bg-base-300 rounded-box">
                {e.image !== undefined &&
                  (e.image ? (
                    <img src={e.image} alt="" className="size-12 rounded-box object-cover" />
                  ) : (
                    <div className="size-12 rounded-box bg-base-300" />
                  ))}
                <div>
                  <div className="font-medium">
                    {e.name} {e.type && <span className="badge badge-ghost badge-sm ml-1">{e.type}</span>}
                  </div>
                  {e.description && <div className="text-sm opacity-70">{e.description}</div>}
                </div>
                {e.note && <div className="text-xs opacity-60 self-center">{e.note}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
