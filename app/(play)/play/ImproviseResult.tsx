"use client";

import { useTransition } from "react";
import { seenImprovise } from "./actions";

/** How the player's improvisation went: shown over the map, whatever panel is open, until they've seen it. */
export default function ImproviseResult({ result }: { result: { id: number; text: string } | null }) {
  const [pending, startTransition] = useTransition();
  if (!result) return null;
  return (
    <div data-improvise-result className="fixed left-1/2 top-24 z-40 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-box bg-info p-3 text-sm text-info-content shadow-xl">
      <span>💡 {result.text}</span>
      <button type="button" className="btn btn-xs" disabled={pending} onClick={() => startTransition(() => seenImprovise(result.id))}>OK</button>
    </div>
  );
}
