"use client";

import type { AmbientSound, Asset } from "@/lib/db";
import { CLIP_MODE_LABELS, CLIP_MODES, type ClipMode } from "@/lib/maps";
import { playOnce, playSequence, stopAmbient, useAmbientNow } from "@/lib/ambientPlayer";
import { changeClipMode, removeAmbientClip, removeAmbientSound, submitAmbientClip, submitAmbientSound } from "../actions";

/** Sounds layer editor: ambient sounds made of clip playlists, with GM playback (one ambient sound at a time). */
export default function SoundsEditor({
  locationId,
  levelId,
  sounds,
  audioAssets,
}: {
  locationId: number;
  levelId: number;
  sounds: AmbientSound[];
  audioAssets: Asset[];
}) {
  const now = useAmbientNow();

  return (
    <div className="space-y-4">
      {sounds.length === 0 && <p className="text-sm opacity-60">No ambient sounds yet.</p>}
      {sounds.map((s) => {
        const looped = s.clips.filter((c) => c.mode === "loop");
        const playing = now?.soundId === s.id;
        return (
          <div key={s.id} data-sound={s.name} className={`rounded-box border p-3 space-y-2 ${playing ? "border-primary" : "border-base-300"}`}>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{s.name}</span>
              {playing && <span className="badge badge-primary badge-sm">playing</span>}
              <div className="ml-auto flex gap-1">
                {playing ? (
                  <button type="button" className="btn btn-sm" onClick={stopAmbient}>■ Stop</button>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={looped.length === 0} onClick={() => playSequence(s.id, looped)}>
                    ▶ Play loop
                  </button>
                )}
                <form action={removeAmbientSound.bind(null, locationId, s.id)}>
                  <button className="btn btn-ghost btn-sm text-error">Remove</button>
                </form>
              </div>
            </div>

            <ol className="space-y-1 text-sm">
              {s.clips.map((c, i) => (
                <li key={c.id} data-clip={c.name} className={`flex items-center gap-2 rounded px-2 py-1 ${now?.clipId === c.id ? "bg-primary/20" : ""}`}>
                  <span className="w-5 opacity-60">{i + 1}.</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <select
                    aria-label="Mode"
                    value={c.mode}
                    onChange={(e) => changeClipMode(locationId, c.id, e.target.value as ClipMode)}
                    className="select select-xs w-48"
                  >
                    {CLIP_MODES.map((m) => (
                      <option key={m} value={m}>{CLIP_MODE_LABELS[m]}</option>
                    ))}
                  </select>
                  {c.mode !== "loop" && (
                    <button type="button" className="btn btn-xs" title="Play this clip now" onClick={() => playOnce(s.id, c)}>▶</button>
                  )}
                  <button type="button" className="btn btn-ghost btn-xs" title="Remove clip" onClick={() => removeAmbientClip(locationId, c.id)}>✕</button>
                </li>
              ))}
            </ol>

            <form key={s.clips.length} action={submitAmbientClip.bind(null, locationId, s.id)} className="flex flex-wrap items-center gap-2 text-sm">
              <select name="asset_id" defaultValue="" className="select select-xs w-44">
                <option value="">Library clip…</option>
                {audioAssets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <span className="opacity-60">or</span>
              <input name="audio" type="file" accept="audio/mpeg,audio/ogg,audio/wav" className="file-input file-input-xs w-56" />
              <select name="mode" defaultValue="loop" className="select select-xs w-44">
                {CLIP_MODES.map((m) => (
                  <option key={m} value={m}>{CLIP_MODE_LABELS[m]}</option>
                ))}
              </select>
              <button className="btn btn-xs">Add clip</button>
            </form>
          </div>
        );
      })}

      <form key={sounds.length} action={submitAmbientSound.bind(null, locationId, levelId)} className="flex items-center gap-2">
        <input name="name" required placeholder="New ambient sound (e.g. Dripping cellar)" className="input input-sm w-72" />
        <button className="btn btn-sm">Add ambient sound</button>
      </form>
      <p className="text-xs opacity-60">Only one ambient sound plays at a time. Event-triggered clips will play once map events exist.</p>
    </div>
  );
}
