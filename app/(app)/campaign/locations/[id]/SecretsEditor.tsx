"use client";

import type { MapSecret } from "@/lib/db";

export interface SecretDraft {
  name: string;
  text: string;
  discoveryId: number | null;
}

/** Secrets layer editor: describe a hidden thing (or pick a discovery), click the map to hide it there; list, reveal, remove. */
export default function SecretsEditor({
  draft,
  onDraftChange,
  discoveries,
  secrets,
  onReveal,
  onRemove,
}: {
  draft: SecretDraft;
  onDraftChange: (d: SecretDraft) => void;
  discoveries: { id: number; title: string; text: string; found: number }[];
  secrets: MapSecret[];
  onReveal: (s: MapSecret, revealed: boolean) => void;
  onRemove: (id: number) => void;
}) {
  const ready = draft.name.trim() !== "";
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs opacity-60">Hidden until a player searches within 10 ft and succeeds, or you reveal it. Players never see unrevealed secrets.</p>
      <select
        aria-label="Discovery"
        className="select select-sm w-full"
        value={draft.discoveryId ?? ""}
        onChange={(e) => {
          const d = discoveries.find((x) => x.id === Number(e.target.value));
          onDraftChange(d ? { name: d.title, text: d.text, discoveryId: d.id } : { ...draft, discoveryId: null });
        }}
      >
        <option value="">A hidden object (not a discovery)</option>
        {discoveries.map((d) => (
          <option key={d.id} value={d.id}>Discovery: {d.title}{d.found ? " (found)" : ""}</option>
        ))}
      </select>
      <input aria-label="Secret name" placeholder="What it is, e.g. a trapdoor" className="input input-sm w-full" value={draft.name} onChange={(e) => onDraftChange({ ...draft, name: e.target.value })} />
      <textarea aria-label="Secret text" placeholder="What the finder learns (optional)" className="textarea textarea-sm w-full" rows={2} value={draft.text} onChange={(e) => onDraftChange({ ...draft, text: e.target.value })} />
      <p className="text-xs opacity-70">{ready ? "Click the map to hide it there." : "Name it first, then click the map."}</p>

      <div className="space-y-1">
        <div className="font-semibold">Secrets on this level</div>
        {secrets.length === 0 ? (
          <p className="text-xs opacity-60">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {secrets.map((s) => (
              <li key={s.id} data-secret={s.id} className="flex items-center gap-2 rounded bg-base-100 px-2 py-1">
                <span className="flex-1 truncate" title={s.text}>
                  {s.name}
                  {s.discovery_id && <span className="opacity-60"> · discovery</span>}
                </span>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" className="toggle toggle-xs" aria-label="Revealed" checked={!!s.revealed} onChange={(e) => onReveal(s, e.target.checked)} />
                  {s.revealed ? "revealed" : "hidden"}
                </label>
                <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => onRemove(s.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
