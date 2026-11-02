"use client";

import { useRef, useState } from "react";
import type { AmbientSound, Asset } from "@/lib/db";
import { CLIP_MODE_LABELS, CLIP_MODES, type ClipMode } from "@/lib/maps";
import { playOnce, playSequence, stopAmbient, useAmbientNow } from "@/lib/ambientPlayer";
import { addClipToSound, changeClipMode, removeAmbientClip, removeAmbientSound, submitAmbientSound, uploadAudioAsset } from "../actions";
import MediaLibrary, { type MediaLibraryHandle } from "./MediaLibrary";

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
  // One media library (audio · ambient) shared by every sound; remembers which sound/mode asked for a clip.
  const library = useRef<MediaLibraryHandle>(null);
  const [adding, setAdding] = useState<{ soundId: number; mode: ClipMode } | null>(null);
  const [modes, setModes] = useState<Record<number, ClipMode>>({});

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

            <div className="flex items-center gap-2 text-sm">
              <select
                aria-label="New clip mode"
                value={modes[s.id] ?? "loop"}
                onChange={(e) => setModes({ ...modes, [s.id]: e.target.value as ClipMode })}
                className="select select-xs w-48"
              >
                {CLIP_MODES.map((m) => (
                  <option key={m} value={m}>{CLIP_MODE_LABELS[m]}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  setAdding({ soundId: s.id, mode: modes[s.id] ?? "loop" });
                  library.current?.open();
                }}
              >
                Add clip from media library…
              </button>
            </div>
          </div>
        );
      })}

      <MediaLibrary
        ref={library}
        type="audio"
        usage="ambient"
        assets={audioAssets}
        onSelect={(a) => adding && addClipToSound(locationId, adding.soundId, a.id, adding.mode)}
        upload={uploadAudioAsset.bind(null, locationId)}
      />

      <form key={sounds.length} action={submitAmbientSound.bind(null, locationId, levelId)} className="flex items-center gap-2">
        <input name="name" required placeholder="New ambient sound (e.g. Dripping cellar)" className="input input-sm w-72" />
        <button className="btn btn-sm">Add ambient sound</button>
      </form>
      <p className="text-xs opacity-60">Only one ambient sound plays at a time. Event-triggered clips will play once map events exist.</p>
    </div>
  );
}
