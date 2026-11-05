"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** One tool in the in-session dock: an icon on the rail, and what opens beside it. */
export interface DockTool {
  id: string;
  label: string;
  icon: DockIcon;
  content: ReactNode;
}

/**
 * The in-session UI surface, docked to one edge over the full-screen map.
 * Progressive disclosure: a slim rail of tool icons is always there; one tool's panel is open at a time,
 * and clicking the open tool again (or ») collapses back to the rail.
 */
export default function PlayDock({
  side,
  tools,
  initial = null,
  onWidth,
}: {
  side: "left" | "right";
  tools: DockTool[];
  initial?: string | null;
  onWidth?: (px: number) => void; // reports how wide the dock is (rail, plus the open panel), so map overlays can keep clear
}) {
  const [open, setOpen] = useState<string | null>(initial);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onWidth || !root.current) return;
    const el = root.current;
    const observer = new ResizeObserver(() => onWidth(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [onWidth]);
  const tool = tools.find((t) => t.id === open);
  const left = side === "left";
  return (
    <div ref={root} data-dock={side} className={`pointer-events-none fixed inset-y-0 z-20 flex ${left ? "left-0" : "right-0 flex-row-reverse"}`}>
      <nav className="pointer-events-auto flex w-12 flex-col items-center gap-1 bg-base-200/90 py-2 shadow-xl backdrop-blur">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={open === t.id}
            onClick={() => setOpen(open === t.id ? null : t.id)}
            className={`btn btn-ghost btn-square btn-sm ${open === t.id ? "btn-active text-primary" : ""}`}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </nav>
      {tool && (
        <section
          data-dock-panel={tool.id}
          className={`pointer-events-auto flex w-[26rem] max-w-[calc(100vw-3rem)] flex-col bg-base-200/85 shadow-xl backdrop-blur ${left ? "border-l" : "border-r"} border-base-300`}
        >
          <header className="flex items-center gap-2 px-3 py-2">
            <h2 className="font-semibold">{tool.label}</h2>
            <button type="button" className="btn btn-ghost btn-xs ml-auto" aria-label="Collapse" title="Collapse" onClick={() => setOpen(null)}>
              {left ? "«" : "»"}
            </button>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">{tool.content}</div>
        </section>
      )}
    </div>
  );
}

export type DockIcon = "layers" | "clock" | "bolt" | "code" | "flag" | "user" | "book" | "swords";

const PATHS: Record<DockIcon, ReactNode> = {
  layers: <path d="M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 18l10 5 10-5" />,
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>),
  swords: <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 21a2 2 0 0 1 2-2h13v2H6M8 7h7" />,
};

function Icon({ name }: { name: DockIcon }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
