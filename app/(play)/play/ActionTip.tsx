"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A tile in an action palette with a hover card: what the action is (its description), a short summary of what it does,
 * and why it can't be planned right now, if it can't. The card sits beside the tile, drawn on the page itself so the
 * scrolling panel doesn't clip it.
 */
export default function ActionTip({ name, desc, lines = [], why, children }: { name: string; desc?: string | null; lines?: string[]; why?: string | null; children: ReactNode }) {
  const [at, setAt] = useState<{ right: number; top: number; left: number } | null>(null);
  return (
    <div
      className="relative"
      onPointerEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ right: window.innerWidth - r.left + 8, top: Math.min(r.top, window.innerHeight - 220), left: r.right + 8 });
      }}
      onPointerLeave={() => setAt(null)}
    >
      {children}
      {at &&
        createPortal(
          <div
            role="tooltip"
            data-action-tip
            className="pointer-events-none fixed z-50 w-72 space-y-1 rounded-box bg-base-100 p-3 text-xs shadow-2xl ring-1 ring-base-content/10"
            // Beside the tile, on whichever side has room (the palettes sit at the screen's edges).
            style={at.right + 288 < window.innerWidth ? { right: at.right, top: at.top } : { left: at.left, top: at.top }}
          >
            <div className="text-sm font-semibold">{name}</div>
            {desc && <p className="opacity-90">{desc}</p>}
            {lines.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 opacity-80">
                {lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            )}
            {why && <p className="font-semibold text-warning">{why}</p>}
          </div>,
          document.body,
        )}
    </div>
  );
}
