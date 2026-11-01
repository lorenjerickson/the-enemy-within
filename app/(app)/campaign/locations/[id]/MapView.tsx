"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { MAP_LAYERS, type MapLayer } from "@/lib/maps";
import { toggleLayer } from "../actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/** How each layer draws itself. Layers without an entry have nothing to draw yet. */
const LAYER_RENDERERS: Partial<Record<MapLayer, Draw>> = {
  base: (ctx, w, h) => {
    ctx.fillStyle = "#15191e";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("All layers are empty", w / 2, h / 2);
  },
};

/**
 * The location's map, drawn on a single canvas layer by layer (base first, controls last),
 * with a panel to show or hide each layer. Layer contents come later.
 */
export default function MapView({ locationId, hidden }: { locationId: number; hidden: MapLayer[] }) {
  const [, startTransition] = useTransition();
  const [hiddenSet, setHidden] = useOptimistic(new Set(hidden), (set: Set<MapLayer>, [layer, visible]: [MapLayer, boolean]) => {
    const next = new Set(set);
    if (visible) next.delete(layer);
    else next.add(layer);
    return next;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<MapLayer | null>(null);
  // On the light selected row a dark hover would hide the dark text, so darken the tint slightly instead.
  const hoverBg = (layer: MapLayer) => (selected === layer ? "hover:bg-black/15" : "hover:bg-base-300");

  // Redraw every visible layer, bottom to top, whenever visibility or the canvas size changes.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      for (const layer of MAP_LAYERS) {
        if (!hiddenSet.has(layer)) LAYER_RENDERERS[layer]?.(ctx, width, height);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hiddenSet]);

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
        <div className="flex-1 min-w-0 space-y-3">
          <canvas ref={canvasRef} className="w-full aspect-video rounded-box bg-base-300" />
          {selected && (
            <div className="rounded-box bg-base-200 p-3" data-editor={selected}>
              <div className="font-semibold">{capitalize(selected)} layer</div>
              <p className="text-sm opacity-60">No editing tools for this layer yet.</p>
            </div>
          )}
        </div>
        <ul className="w-44 shrink-0 bg-base-200 rounded-box p-2 text-sm">
          <li className="text-xs opacity-60 px-1 pb-1">Layers (top first)</li>
          {[...MAP_LAYERS].reverse().map((layer) => (
            <li key={layer}>
              <div className={`flex items-center gap-1 rounded ${selected === layer ? "bg-[color-mix(in_oklab,var(--color-primary)_60%,white)] text-base-100" : ""}`}>
                <button
                  type="button"
                  aria-pressed={!hiddenSet.has(layer)}
                  title={hiddenSet.has(layer) ? `Show ${layer}` : `Hide ${layer}`}
                  onClick={() => onToggle(layer, hiddenSet.has(layer))}
                  className={`p-1 rounded ${hoverBg(layer)} ${hiddenSet.has(layer) ? "opacity-30" : ""}`}
                >
                  <EyeIcon />
                </button>
                <button
                  type="button"
                  aria-current={selected === layer}
                  onClick={() => setSelected(layer)}
                  className={`flex-1 text-left px-1 py-0.5 rounded ${hoverBg(layer)} ${hiddenSet.has(layer) ? "opacity-30" : ""}`}
                >
                  {capitalize(layer)}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
