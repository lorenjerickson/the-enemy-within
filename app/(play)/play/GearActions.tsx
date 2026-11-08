"use client";

import { describeArea, type AreaSpec } from "@/lib/aoe";
import { describeTargeting, type Targeting } from "@/lib/sides";

type Gear = { id: number; name: string; source: string; seconds: number; range: number; area?: AreaSpec; self?: boolean; targets?: "self" | "others" | "anyone"; targeting?: Targeting };

/** The target mode for using a gear action: pick a token, or for an area, aim it at a spot. */
export const gearTargetMode = (g: Gear, tokenId: number | null) =>
  ({ action: "attack" as const, tokenId, use: g.id, label: g.name, targeting: g.targeting, ...(g.targets === "anyone" ? { canSelf: true } : {}), ...(g.area ? { area: { shape: g.area.shape, ft: g.area.ft, range: g.range } } : {}) });

/**
 * Actions from someone's gear, own abilities and professions (Aimed shot, Bite, Mesmerize…): one aimed at someone plans
 * it on a target (an attack if it does damage); one that only affects its user (Case the Scene) is planned straight away.
 */
export default function GearActions({ gear, enabled, onUse }: {
  gear: Gear[];
  enabled: boolean;
  onUse: (g: Gear) => void;
}) {
  if (!gear.length) return null;
  return (
    <div className="space-y-1" data-gear-actions>
      <div className="text-xs font-semibold opacity-80">From their gear and professions</div>
      <div className="grid grid-cols-3 gap-2">
        {gear.map((g) => (
          <button
            key={g.id}
            type="button"
            data-gear-action={g.id}
            disabled={!enabled}
            title={enabled ? `${g.name} (${g.source}): ${g.seconds} s, ${g.area ? `${describeArea(g.area)}, ${g.area.save} save DC ${g.area.dc}. Then aim it.` : g.self ? "on themselves" : `${g.range > 1 ? `range ${g.range * 5} ft` : "within reach"}. Then pick who.`}` : "Only in an encounter"}
            className="btn h-auto w-full flex-col gap-0 py-2 text-xs disabled:bg-base-100/60 disabled:text-base-content/80"
            onClick={() => onUse(g)}
          >
            <span className="font-semibold">{g.name}</span>
            <span className="opacity-60">{g.source}</span>
            <span className="opacity-60">{g.seconds} s · {g.area ? describeArea(g.area) : g.self ? "self" : g.range > 1 ? `${g.range * 5} ft` : "reach"}</span>
            {g.targeting && (g.targeting.count !== "one" || g.targeting.who) && <span className="opacity-60">{describeTargeting(g.targeting, !!g.area)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
