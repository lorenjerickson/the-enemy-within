import type { MapControl } from "@/lib/db";
import GameIcon from "./GameIcon";

/**
 * Icon buttons fixed to the viewport (the canvas), one row per edge, 12px in from the edge and
 * centred along it. They ignore zoom and pan so they're always in reach.
 */
export default function ControlButtons({
  controls,
  size,
  inset = { left: 0, right: 0 },
  onRun,
}: {
  controls: MapControl[];
  size: { w: number; h: number };
  inset?: { left: number; right: number }; // pixels covered by docked UI on each side; buttons stay clear of it
  onRun: (control: MapControl) => void;
}) {
  const MARGIN = 12, GAP = 6, B = 26;
  const placed = (["top", "right", "bottom", "left"] as const).flatMap((edge) => {
    const row = controls.filter((c) => c.edge === edge);
    const horizontal = edge === "top" || edge === "bottom";
    const total = row.length * B + Math.max(0, row.length - 1) * GAP;
    const free = size.w - inset.left - inset.right; // the visible width between docked UI
    const start = horizontal ? inset.left + (free - total) / 2 : (size.h - total) / 2;
    return row.map((c, i) => {
      const along = start + i * (B + GAP);
      const x = horizontal ? along : edge === "left" ? inset.left + MARGIN : size.w - inset.right - MARGIN - B;
      const y = horizontal ? (edge === "top" ? MARGIN : size.h - MARGIN - B) : along;
      return { c, x, y, edge };
    });
  });
  return (
    <>
      {placed.map(({ c, x, y, edge }) => (
        <div
          key={c.id}
          // Tooltips open towards the middle of the scene so they aren't cut off at the edge.
          className={`tooltip absolute z-10 ${{ top: "tooltip-bottom", bottom: "tooltip-top", left: "tooltip-right", right: "tooltip-left" }[edge]}`}
          data-tip={c.label}
          style={{ left: x, top: y }}
        >
          <button
            type="button"
            data-control-button={c.label}
            aria-label={c.label}
            onClick={() => onRun(c)}
            className="flex items-center justify-center rounded-md border border-white/70 bg-black/50 text-white/90 shadow hover:border-white hover:bg-black/70 hover:text-white"
            style={{ width: B, height: B }}
          >
            <GameIcon name={c.icon} className="size-4" />
          </button>
        </div>
      ))}
    </>
  );
}

/** The cells (with a cell's margin) taking in a contested move: the two creatures where they stand and where they
 * were when it happened, and the contested spot. */
