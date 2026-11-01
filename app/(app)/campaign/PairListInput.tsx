"use client";

import { useState } from "react";

type Groups = [string, [string, string][]][];

/**
 * Editable rows of (grouped select, second field), submitted as repeated paired fields.
 * The second field is a select when `secondOptions` is given, otherwise a text input.
 */
export default function PairListInput({
  title,
  addLabel,
  firstName,
  firstPlaceholder,
  groups,
  secondName,
  secondOptions,
  secondPattern,
  secondPlaceholder,
  initial = [],
}: {
  title: string;
  addLabel: string;
  firstName: string;
  firstPlaceholder: string;
  groups: Groups;
  secondName: string;
  secondOptions?: string[];
  secondPattern?: string;
  secondPlaceholder?: string;
  initial?: [string, string][];
}) {
  type Row = { key: number; first: string; second: string };
  const [rows, setRows] = useState<Row[]>(initial.map(([first, second], key) => ({ key, first, second })));
  const update = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex gap-2">
          <select name={firstName} value={r.first} onChange={(e) => update(r.key, { first: e.target.value })} className="select select-sm flex-1">
            <option value="">{firstPlaceholder}</option>
            {groups.map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {secondOptions ? (
            <select name={secondName} value={r.second} onChange={(e) => update(r.key, { second: e.target.value })} className="select select-sm w-36">
              {secondOptions.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input name={secondName} value={r.second} onChange={(e) => update(r.key, { second: e.target.value })} pattern={secondPattern} placeholder={secondPlaceholder} className="input input-sm w-28" />
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => setRows([...rows, { key: Date.now(), first: "", second: secondOptions?.[0] ?? "" }])}
      >
        {addLabel}
      </button>
    </div>
  );
}
