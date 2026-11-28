"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Someone's artwork in a movable window: dragged by its title bar, closed with ×, Escape or a click outside. */
export default function ArtModal({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [at, setAt] = useState(() => ({ x: Math.max(16, window.innerWidth / 2 - 260), y: 64 }));
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  // On the page itself (not inside a panel, whose transform would carry a fixed window along with it).
  return createPortal(
    <div className="fixed inset-0 z-50" onPointerDown={onClose} data-art-backdrop>
      <div
        role="dialog"
        aria-label={title}
        data-art-modal
        className="absolute w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-box bg-base-200 shadow-2xl"
        style={{ left: at.x, top: at.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex cursor-move select-none items-center gap-2 bg-base-300 px-3 py-1.5 text-sm"
          onPointerDown={(e) => {
            drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => drag.current && setAt({ x: e.clientX - drag.current.dx, y: Math.max(0, e.clientY - drag.current.dy) })}
          onPointerUp={() => (drag.current = null)}
        >
          <span className="font-semibold">{title}</span>
          <button type="button" className="btn btn-ghost btn-xs ml-auto" aria-label="Close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>✕</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} className="max-h-[75vh] w-full object-contain" draggable={false} />
      </div>
    </div>,
    document.body,
  );
}
