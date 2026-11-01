import type { MapGrid, Perspective } from "@/lib/maps";
import { submitGrid } from "../actions";

const HINTS: Record<Perspective, string> = {
  overhead: "Overhead map: square grid cells of this size.",
  portrait: "Portrait map: columns of this width mark horizontal movement distance.",
  scenic: "Scenic map: no grid is drawn.",
};

/** Grid layer editor: cell (or column) size and line colour. */
export default function GridEditor({
  locationId,
  levelId,
  grid,
  perspective,
}: {
  locationId: number;
  levelId: number;
  grid: MapGrid;
  perspective: Perspective;
}) {
  return (
    <form action={submitGrid.bind(null, locationId, levelId)} className="space-y-3">
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Size (pixels)
          <input name="size" type="number" min="5" defaultValue={grid.size} className="input input-sm w-24" />
        </label>
        <label className="flex items-center gap-2">
          Colour
          <input name="color" type="color" defaultValue={grid.color} className="h-8 w-14 cursor-pointer rounded" />
        </label>
      </div>
      <p className="text-xs opacity-60">{HINTS[perspective]}</p>
      <button className="btn btn-primary btn-sm">Save grid</button>
    </form>
  );
}
