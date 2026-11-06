"use client";

/** Actions from someone's gear (an equipped weapon's, or a creature's own, e.g. Aimed shot or Bite): each plans an attack. */
export default function GearActions({ gear, enabled, onUse }: {
  gear: { id: number; name: string; source: string; seconds: number; range: number }[];
  enabled: boolean;
  onUse: (g: { id: number; name: string }) => void;
}) {
  if (!gear.length) return null;
  return (
    <div className="space-y-1" data-gear-actions>
      <div className="text-xs font-semibold opacity-80">From their gear</div>
      <div className="grid grid-cols-3 gap-2">
        {gear.map((g) => (
          <button
            key={g.id}
            type="button"
            data-gear-action={g.id}
            disabled={!enabled}
            title={enabled ? `${g.name} (${g.source}): ${g.seconds} s, ${g.range > 1 ? `range ${g.range * 5} ft` : "within reach"}. Then pick who.` : "Only in an encounter"}
            className="btn h-auto w-full flex-col gap-0 py-2 text-xs disabled:bg-base-100/60 disabled:text-base-content/80"
            onClick={() => onUse(g)}
          >
            <span className="font-semibold">{g.name}</span>
            <span className="opacity-60">{g.source}</span>
            <span className="opacity-60">{g.seconds} s · {g.range > 1 ? `${g.range * 5} ft` : "reach"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
