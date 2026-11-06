"use client";

/** Who an action is aimed at (attack, evade, pursue): the targets offered (those in sight, or for the GM anyone on the map). */
// aiming: an area attack, aimed at a spot on the map, so no one to pick from the list.
export default function TargetPicker({ targets, onPick, onCancel, title = "Attack who?", aiming = false }: { targets: { id: number; name: string }[]; onPick: (id: number) => void; onCancel: () => void; title?: string; aiming?: boolean }) {
  return (
    <div className="space-y-1 rounded-box bg-base-100/70 p-2" data-target-picker>
      <div className="flex items-center text-xs">
        <span className="font-semibold">{title}</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={onCancel}>Cancel</button>
      </div>
      {aiming ? null : targets.length === 0 ? (
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
