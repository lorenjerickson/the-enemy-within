"use client";

import { useOptimistic, useTransition } from "react";
import { MAP_LAYERS, type MapLayer } from "@/lib/maps";
import { toggleLayer } from "../actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * The location's map: a stage of stacked layers (base at the bottom, controls on top)
 * and a layer panel to show or hide each one. Layer contents come later.
 */
export default function MapView({ locationId, hidden }: { locationId: number; hidden: MapLayer[] }) {
  const [, startTransition] = useTransition();
  const [hiddenSet, setHidden] = useOptimistic(new Set(hidden), (set: Set<MapLayer>, [layer, visible]: [MapLayer, boolean]) => {
    const next = new Set(set);
    if (visible) next.delete(layer);
    else next.add(layer);
    return next;
  });

  function onToggle(layer: MapLayer, visible: boolean) {
    startTransition(async () => {
      setHidden([layer, visible]);
      await toggleLayer(locationId, layer, visible);
    });
  }

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Map</h3>
      <div className="flex gap-4">
        <div className="relative flex-1 aspect-video rounded-box bg-base-300 overflow-hidden">
          {MAP_LAYERS.map((layer, z) => (
            <div key={layer} data-layer={layer} className="absolute inset-0" style={{ zIndex: z, display: hiddenSet.has(layer) ? "none" : undefined }} />
          ))}
          <div className="absolute inset-0 flex items-center justify-center text-sm opacity-50 pointer-events-none">
            All layers are empty
          </div>
        </div>
        <ul className="w-44 shrink-0 bg-base-200 rounded-box p-2 text-sm">
          <li className="text-xs opacity-60 px-1 pb-1">Layers (top first)</li>
          {[...MAP_LAYERS].reverse().map((layer) => (
            <li key={layer}>
              <label className="flex items-center gap-2 px-1 py-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={!hiddenSet.has(layer)}
                  onChange={(e) => onToggle(layer, e.target.checked)}
                />
                {capitalize(layer)}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
