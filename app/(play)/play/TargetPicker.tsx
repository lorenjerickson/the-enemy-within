"use client";

import { allegianceOf, fits, relation, type Allegiance, type TargetWho } from "@/lib/sides";

type Candidate = { id: number; name: string; allegiance?: string | null; character_id?: number | null };

/**
 * Who an action is aimed at (attack, evade, pursue, an ability): the targets offered (those in sight, or for the GM
 * anyone on the map), only the kind it's for (friendlies / enemies, as the one acting sees them), and only those in an
 * aimed area when there are more there than it may affect.
 * aiming: an area attack, aimed at a spot on the map, so no one to pick from the list (yet).
 * duration: for Evade / Pursue, how long to keep at it (1 s up to the time left, or the rest of the round).
 * me: the one acting, offered first when the action can be used on themselves.
 * several: picking more than one (exactly / up to N): toggle each, then Done.
 */
export default function TargetPicker({ targets, onPick, onCancel, title = "Attack who?", aiming = false, duration, me, who = "", actor, only, several }: {
  me?: { id: number; name: string } | null;
  targets: Candidate[];
  onPick: (id: number) => void;
  onCancel: () => void;
  title?: string;
  aiming?: boolean;
  duration?: { left: number; seconds?: number; onChange: (s: number | undefined) => void };
  who?: TargetWho;
  actor?: Allegiance;
  only?: number[];
  several?: { max: number; exact: boolean; picks: number[]; onToggle: (id: number) => void; onDone: () => void };
}) {
  const shown = targets.filter((t) => (!only || only.includes(t.id)) && (!who || !actor || fits(who, relation(actor, allegianceOf({ allegiance: t.allegiance, character_id: t.character_id ?? null })))));
  const self = me && (!only || only.includes(me.id)) ? me : null;
  const picked = (id: number) => several?.picks.includes(id);
  const pick = (id: number) => (several ? several.onToggle(id) : onPick(id));
  const ready = several && (several.exact ? several.picks.length === several.max : several.picks.length >= 1 && several.picks.length <= several.max);
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
      {aiming ? null : shown.length === 0 && !self ? (
        <p className="text-xs opacity-60">{who ? `No ${who === "enemy" ? "enemies" : "friendlies"} in sight.` : "Nobody in sight."}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {self && <button type="button" data-target={self.id} data-target-self className={`btn btn-xs ${picked(self.id) ? "btn-primary" : "btn-outline"}`} onClick={() => pick(self.id)}>Yourself ({self.name})</button>}
          {shown.map((t) => (
            <button key={t.id} type="button" data-target={t.id} aria-pressed={several ? picked(t.id) : undefined} className={`btn btn-xs ${picked(t.id) ? "btn-primary" : ""}`} onClick={() => pick(t.id)}>{t.name}</button>
          ))}
        </div>
      )}
      {several && !aiming && (
        <div className="flex items-center gap-2 text-xs">
          <span className="opacity-70">{several.picks.length} of {several.exact ? several.max : `up to ${several.max}`} picked</span>
          <button type="button" data-targets-done className="btn btn-primary btn-xs ml-auto" disabled={!ready} onClick={several.onDone}>Done</button>
        </div>
      )}
    </div>
  );
}
