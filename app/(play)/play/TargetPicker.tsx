"use client";

/** Who an action is aimed at (attack, evade, pursue): the targets offered (those in sight, or for the GM anyone on the map). */
// aiming: an area attack, aimed at a spot on the map, so no one to pick from the list.
// duration: for Evade / Pursue, how long to keep at it (1 s up to the time left, or the rest of the round).
// me: the one acting, offered first when the action can be used on themselves.
export default function TargetPicker({ targets, onPick, onCancel, title = "Attack who?", aiming = false, duration, me }: { me?: { id: number; name: string } | null; targets: { id: number; name: string }[]; onPick: (id: number) => void; onCancel: () => void; title?: string; aiming?: boolean; duration?: { left: number; seconds?: number; onChange: (s: number | undefined) => void } }) {
  return (
    <div className="space-y-1 rounded-box bg-base-100/70 p-2" data-target-picker>
      <div className="flex items-center text-xs">
        <span className="font-semibold">{title}</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={onCancel}>Cancel</button>
      </div>
      {duration && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-chase-seconds>
          <span className="opacity-70">For</span>
          {Array.from({ length: Math.max(0, Math.floor(duration.left + 1e-9) - 1) }, (_, i) => i + 1).map((s) => (
            <button key={s} type="button" data-seconds={s} className={`btn btn-xs ${duration.seconds === s ? "btn-primary" : ""}`} onClick={() => duration.onChange(s)}>{s} s</button>
          ))}
          <button type="button" data-seconds="rest" className={`btn btn-xs ${!duration.seconds ? "btn-primary" : ""}`} onClick={() => duration.onChange(undefined)}>rest of round</button>
        </div>
      )}
      {aiming ? null : targets.length === 0 && !me ? (
        <p className="text-xs opacity-60">Nobody in sight.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {me && <button type="button" data-target={me.id} data-target-self className="btn btn-xs btn-outline" onClick={() => onPick(me.id)}>Yourself ({me.name})</button>}
          {targets.map((t) => (
            <button key={t.id} type="button" data-target={t.id} className="btn btn-xs" onClick={() => onPick(t.id)}>{t.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
