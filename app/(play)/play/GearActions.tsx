"use client";

import { describeArea } from "@/lib/aoe";
import type { GearAction } from "@/lib/roundPlan";
import { gearSummary } from "@/lib/actionSummary";
import ActionTip from "./ActionTip";
import { describeTargeting } from "@/lib/sides";

type Gear = GearAction & { source: string };

/** The target mode for using a gear action: pick a token, or for an area, aim it at a spot. */
export const gearTargetMode = (g: Gear, tokenId: number | null) =>
  ({ action: "attack" as const, tokenId, use: g.id, label: g.name, targeting: g.targeting, range: g.range, ...(g.targets === "anyone" ? { canSelf: true } : {}), ...(g.area ? { area: { shape: g.area.shape, ft: g.area.ft, range: g.range } } : {}) });

/**
 * Actions from someone's gear, own abilities and professions (Aimed shot, Bite, Mesmerize…): one aimed at someone plans
 * it on a target (an attack if it does damage); one that only affects its user (Case the Scene) is planned straight away.
 */
export default function GearActions({ gear, enabled, onUse, blocked }: {
  gear: Gear[];
  enabled: boolean;
  onUse: (g: Gear) => void;
  blocked?: (g: Gear) => string | null; // why this one can't be planned now (action used, no time)
}) {
  if (!gear.length) return null;
  return (
    <div className="space-y-1" data-gear-actions>
      <div className="text-xs font-semibold opacity-80">From their gear and professions</div>
      <div className="grid grid-cols-3 gap-2">
        {gear.map((g) => (
          <ActionTip key={g.id} name={`${g.name} (${g.source})`} desc={g.description} lines={gearSummary(g)} why={!enabled ? "Only in an encounter" : blocked?.(g)}>
            <button
              type="button"
              data-gear-action={g.id}
              disabled={!enabled || !!blocked?.(g)}
              className="btn h-auto w-full flex-col gap-0 py-2 text-xs disabled:bg-base-100/60 disabled:text-base-content/80"
              onClick={() => onUse(g)}
            >
              <span className="font-semibold">{g.name}</span>
              <span className="opacity-60">{g.source}</span>
              <span className="opacity-60">{g.seconds} s · {g.area ? describeArea(g.area) : g.self ? "self" : g.range > 1 ? `${g.range * 5} ft` : "reach"}</span>
              {g.targeting && (g.targeting.count !== "one" || g.targeting.who) && <span className="opacity-60">{describeTargeting(g.targeting, !!g.area)}</span>}
            </button>
          </ActionTip>
        ))}
      </div>
    </div>
  );
}
