import type { MapControl } from "@/lib/db";
import { CONTROL_EDGES } from "@/lib/maps";
import { removeControl, submitControl } from "../actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Controls layer editor: add buttons along each edge of the scene, remove them. */
export default function ControlsEditor({ locationId, levelId, controls }: { locationId: number; levelId: number; controls: MapControl[] }) {
  return (
    <div className="space-y-3">
      <form key={controls.length} action={submitControl.bind(null, locationId, levelId)} className="flex items-center gap-2">
        <input name="label" required placeholder="Button label" className="input input-sm w-48" />
        <select name="edge" aria-label="Edge" defaultValue="bottom" className="select select-sm w-32">
          {CONTROL_EDGES.map((e) => (
            <option key={e} value={e}>{capitalize(e)}</option>
          ))}
        </select>
        <button className="btn btn-sm">Add button</button>
      </form>
      <div className="grid grid-cols-4 gap-3 text-sm">
        {CONTROL_EDGES.map((edge) => (
          <div key={edge} className="space-y-1">
            <div className="font-semibold">{capitalize(edge)}</div>
            {controls.filter((c) => c.edge === edge).length === 0 && <p className="text-xs opacity-60">None</p>}
            {controls
              .filter((c) => c.edge === edge)
              .map((c) => (
                <div key={c.id} data-control={c.label} className="flex items-center gap-1">
                  <span className="flex-1 truncate">{c.label}</span>
                  <form action={removeControl.bind(null, locationId, c.id)}>
                    <button title="Remove this button" className="btn btn-ghost btn-xs text-error">✕</button>
                  </form>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
