"use client";

import { useState } from "react";
import type { Sheet } from "@/lib/sheet";
import ArtModal from "./ArtModal";

/** A character (or creature) sheet: portrait (click for the artwork), health, active effects, equipment and what they carry. */
export default function CharacterSheet({ sheet }: { sheet: Sheet }) {
  const [art, setArt] = useState(false);
  const pic = sheet.image ?? sheet.token;
  const h = sheet.health;
  const pct = h && h.maximum > 0 ? Math.max(0, Math.min(1, h.current / h.maximum)) : 0;
  return (
    <div className="space-y-3 text-sm" data-character-sheet={sheet.tokenId}>
      <div className="flex items-center gap-3">
        {pic ? (
          <button type="button" className="shrink-0 overflow-hidden rounded-box ring-1 ring-base-content/20 hover:ring-primary" title="Show artwork" onClick={() => setArt(true)} data-portrait>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pic} alt="" className="size-20 object-cover" />
          </button>
        ) : (
          <div className="size-20 shrink-0 rounded-box bg-base-300" />
        )}
        <div className="min-w-0 space-y-1">
          <div className="truncate text-base font-semibold">{sheet.name}</div>
          {sheet.player && <div className="text-xs opacity-60">played by {sheet.player}</div>}
          {sheet.down ? (
            <span className="badge badge-error badge-sm">down</span>
          ) : h ? (
            <div className="space-y-0.5" data-sheet-health>
              <progress className={`progress w-36 ${pct > 0.5 ? "progress-success" : pct > 0.25 ? "progress-warning" : "progress-error"}`} value={h.current} max={h.maximum} />
              <div className="text-xs opacity-80">{h.current} / {h.maximum} health{h.temporary ? ` (+${h.temporary} temporary)` : ""}</div>
            </div>
          ) : null}
        </div>
      </div>
      <section className="space-y-1">
        <div className="text-xs font-semibold opacity-80">Active effects</div>
        {sheet.effects.length ? (
          <ul className="space-y-0.5" data-sheet-effects>
            {sheet.effects.map((e, i) => (
              <li key={i}><span className="badge badge-warning badge-sm mr-1">{e.source}</span>{e.text} <span className="opacity-60">({e.left} left)</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-xs opacity-60">None.</p>
        )}
      </section>
      <section className="space-y-1">
        <div className="text-xs font-semibold opacity-80">Equipped</div>
        {sheet.equipment.length ? (
          <ul className="grid grid-cols-2 gap-x-3 text-xs" data-sheet-equipment>
            {sheet.equipment.map((e) => (
              <li key={e.slot} className="truncate"><span className="capitalize opacity-60">{e.slot}:</span> {e.name}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs opacity-60">Nothing.</p>
        )}
      </section>
      {sheet.containers.map((c, i) => (
        <section key={i} className="space-y-1" data-sheet-container>
          <div className="text-xs font-semibold opacity-80">{c.name} <span className="font-normal opacity-60">({c.stacks.length}/{c.capacity})</span></div>
          {c.stacks.length ? (
            <ul className="flex flex-wrap gap-1 text-xs">
              {c.stacks.map((s, j) => <li key={j} className="badge badge-ghost badge-sm">{s.name}{s.qty > 1 ? ` ×${s.qty}` : ""}</li>)}
            </ul>
          ) : (
            <p className="text-xs opacity-60">Empty.</p>
          )}
        </section>
      ))}
      {art && pic && <ArtModal src={pic} title={sheet.name} onClose={() => setArt(false)} />}
    </div>
  );
}
