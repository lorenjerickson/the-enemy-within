"use client";

import { useState } from "react";
import type { Boost } from "@/lib/actions";
import { MODIFIER_PATTERN } from "@/lib/itemTypes";
import { MODIFIER_TARGET_GROUPS } from "@/lib/modifiers";

type Row = { key: number; target: string; value: string };

/** Editable list of boosts, submitted as paired "boost_target" / "boost_value" fields. */
export default function BoostsInput({ initial = [] }: { initial?: Boost[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map((b, i) => ({ key: i, ...b })));
  const update = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold">Temporary boosts</div>
      {rows.map((r) => (
        <div key={r.key} className="flex gap-2">
          <select name="boost_target" value={r.target} onChange={(e) => update(r.key, { target: e.target.value })} className="select select-sm flex-1">
            <option value="">Boosts…</option>
            {MODIFIER_TARGET_GROUPS.map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input name="boost_value" value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} pattern={MODIFIER_PATTERN} placeholder="+2 or 1d4" className="input input-sm w-28" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRows([...rows, { key: Date.now(), target: "", value: "" }])}>
        + Add boost
      </button>
    </div>
  );
}
