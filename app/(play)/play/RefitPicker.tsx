"use client";

export type RefitOption = { slot: string; current: { id: number; name: string } | null; items: { id: number; name: string; hands: number }[] };

/** Refit: pick a slot's replacement from what they carry (as their gear will be at that point in the plan). */
export default function RefitPicker({ options, onPick, onCancel }: { options: RefitOption[]; onPick: (slot: string, item: number) => void; onCancel: () => void }) {
  return (
    <div className="space-y-1 rounded-box bg-base-100/70 p-2 text-xs" data-refit-picker>
      <div className="flex items-center">
        <span className="font-semibold">Refit (2 s): swap in</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={onCancel}>Cancel</button>
      </div>
      {options.length === 0 ? (
        <p className="opacity-60">Nothing they carry fits a slot.</p>
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
  );
}
