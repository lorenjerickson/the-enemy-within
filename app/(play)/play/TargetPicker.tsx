"use client";

/** Who to attack: the targets offered (those in sight, or for the GM anyone on the map). */
export default function TargetPicker({ targets, onPick, onCancel }: { targets: { id: number; name: string }[]; onPick: (id: number) => void; onCancel: () => void }) {
  return (
    <div className="space-y-1 rounded-box bg-base-100/70 p-2" data-target-picker>
      <div className="flex items-center text-xs">
        <span className="font-semibold">Attack who?</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={onCancel}>Cancel</button>
      </div>
      {targets.length === 0 ? (
        <p className="text-xs opacity-60">Nobody in sight.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {targets.map((t) => (
            <button key={t.id} type="button" data-target={t.id} className="btn btn-xs" onClick={() => onPick(t.id)}>{t.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
