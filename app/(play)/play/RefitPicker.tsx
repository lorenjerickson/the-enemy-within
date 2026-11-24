"use client";

import type { PutOptions } from "@/lib/combat";

export type RefitOption = { slot: string; current: { id: number; name: string } | null; items: { id: number; name: string; hands: number }[] };
export type PutRequest = { item: number; slot?: string; from?: number; into: number };

/**
 * Refit (2 s, bonus action), as their gear will be at that point in the plan: swap something carried into a slot,
 * put something equipped away (the slot's left empty), or bring one thing out of a pack onto the belt.
 */
export default function RefitPicker({ options, puts, onPick, onPut, onCancel }: {
  options: RefitOption[];
  puts?: PutOptions;
  onPick: (slot: string, item: number) => void;
  onPut: (put: PutRequest) => void;
  onCancel: () => void;
}) {
  const away = puts?.away ?? [];
  const packItems = puts?.fromPacks ?? [];
  return (
    <div className="space-y-2 rounded-box bg-base-100/70 p-2 text-xs" data-refit-picker>
      <div className="flex items-center">
        <span className="font-semibold">Refit (2 s, bonus action)</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={onCancel}>Cancel</button>
      </div>
      <div className="space-y-1">
        <div className="opacity-60">Swap in</div>
        {options.length === 0 ? (
          <p className="opacity-60">Nothing carried fits a slot.</p>
        ) : (
          options.map((o) => (
            <div key={o.slot} className="flex flex-wrap items-center gap-1">
              <span className="capitalize opacity-70">{o.slot}{o.current ? ` (${o.current.name})` : " (empty)"}:</span>
              {o.items.map((i) => (
                <button key={i.id} type="button" data-refit-item={i.id} className="btn btn-xs" onClick={() => onPick(o.slot, i.id)} title={i.hands === 2 ? "Held in both hands" : undefined}>
                  {i.name}{i.hands === 2 ? " (2h)" : ""}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
      {puts && (
        <div className="space-y-1" data-refit-away>
          <div className="opacity-60">Put away (the slot&apos;s left empty)</div>
          {away.length === 0 ? (
            <p className="opacity-60">Nothing equipped to put away.</p>
          ) : (
            away.map((a) => (
              <div key={a.slot} className="flex flex-wrap items-center gap-1">
                <span className="opacity-70">{a.item.name} <span className="capitalize">({a.slot})</span> into:</span>
                {a.into.length === 0 ? (
                  <span className="opacity-60">no room in anything you wear</span>
                ) : (
                  a.into.map((c) => (
                    <button key={c.id} type="button" data-put-away={`${a.slot}:${c.id}`} className="btn btn-xs" onClick={() => onPut({ item: a.item.id, slot: a.slot, into: c.id })}>{c.name}</button>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      )}
      {puts && (
        <div className="space-y-1" data-refit-to-belt>
          <div className="opacity-60">Pack → belt{puts.belt ? ` (${puts.belt.name})` : ""}</div>
          {!puts.belt ? (
            <p className="opacity-60">No belt: wear one to keep things at hand.</p>
          ) : packItems.length === 0 ? (
            <p className="opacity-60">Nothing in your packs.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {packItems.map((f) => (
                <button key={`${f.from.id}:${f.item.id}`} type="button" data-to-belt={f.item.id} className="btn btn-xs" disabled={!f.room} title={f.room ? `Out of ${f.from.name}` : `${puts.belt!.name} is full`} onClick={() => onPut({ item: f.item.id, from: f.from.id, into: puts.belt!.id })}>
                  {f.item.name}{f.room ? "" : " (belt full)"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
