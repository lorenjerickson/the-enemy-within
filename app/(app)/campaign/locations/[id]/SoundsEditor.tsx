"use client";

import { useRef, useState } from "react";
import type { AmbientSound, Asset, PositionalSound } from "@/lib/db";
import { CLIP_MODE_LABELS, CLIP_MODES, type ClipMode } from "@/lib/maps";
import { playOnce, playSequence, setAmbientVolume, stopAmbient, useAmbientNow } from "@/lib/ambientPlayer";
import { addClipToSound, changeSoundVolume, changePositionalRadius, removePositionalSound, changeClipMode, removeAmbientClip, removeAmbientSound, submitAmbientSound, uploadAudioAsset } from "../actions";
import MediaLibrary, { type MediaLibraryHandle } from "./MediaLibrary";

/** Sounds layer editor: ambient sounds made of clip playlists, with GM playback (one ambient sound at a time). */
/** What a click on the map places as a positional sound. */
export interface PositionalTool {
  asset: Asset | null;
  radius: number;
}

export default function SoundsEditor({
  locationId,
  levelId,
  sounds,
  audioAssets,
  positional,
  tool,
  onToolChange,
  selectedPositionalId,
  onSelectPositional,
}: {
  locationId: number;
  levelId: number;
  sounds: AmbientSound[];
  audioAssets: Asset[];
  positional: PositionalSound[];
  tool: PositionalTool;
  onToolChange: (tool: PositionalTool) => void;
  selectedPositionalId: number | null;
  onSelectPositional: (id: number) => void;
}) {
  const now = useAmbientNow();
  // One media library (audio · ambient) shared by every sound; remembers which sound/mode asked for a clip.
  const library = useRef<MediaLibraryHandle>(null);
  // The library is opened either to add a clip to an ambient sound, or to choose a positional sound's audio.
  const [adding, setAdding] = useState<{ soundId: number; mode: ClipMode } | "positional" | null>(null);
  const [modes, setModes] = useState<Record<number, ClipMode>>({});
  // Volumes being dragged (saved when released); falls back to the stored value.
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const vol = (key: string, stored: number) => volumes[key] ?? stored;

  /** Props for a volume slider: live updates while dragging, saved to the server on release. */
  const volumeProps = (kind: "ambient" | "positional", id: number, stored: number, onLive: (v: number) => void) => ({
    label: `${kind} volume`,
    value: vol(`${kind}:${id}`, stored),
    onLive: (v: number) => {
      setVolumes((vs) => ({ ...vs, [`${kind}:${id}`]: v }));
      onLive(v);
    },
    onCommit: (v: number) => changeSoundVolume(locationId, kind, id, v),
  });

  // Manual playback of a positional sound, separate from the ambient player so it doesn't interrupt ambience.
  const positionalAudio = useRef<HTMLAudioElement | null>(null);
  const [playingPositionalId, setPlayingPositionalId] = useState<number | null>(null);
  function togglePositional(p: PositionalSound) {
    positionalAudio.current ??= new Audio();
    const a = positionalAudio.current;
    if (playingPositionalId === p.id) {
      a.pause();
      setPlayingPositionalId(null);
      return;
    }
    a.src = p.url;
    a.volume = vol(`positional:${p.id}`, p.volume);
    a.onended = () => setPlayingPositionalId(null);
    void a.play().catch(() => setPlayingPositionalId(null));
    setPlayingPositionalId(p.id);
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">Ambient sounds</div>
      {sounds.length === 0 && <p className="text-sm opacity-60">No ambient sounds yet.</p>}
      {sounds.map((s) => {
        const looped = s.clips.filter((c) => c.mode === "loop");
        const layered = s.clips.filter((c) => c.mode === "layer");
        const playing = now?.soundId === s.id;
        return (
          <div key={s.id} data-sound={s.name} className={`rounded-box border p-3 space-y-2 ${playing ? "border-primary" : "border-base-300"}`}>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{s.name}</span>
              {playing && <span className="badge badge-primary badge-sm">playing</span>}
              <div className="ml-auto flex items-center gap-1">
                <VolumeSlider {...volumeProps("ambient", s.id, s.volume, (v) => playing && setAmbientVolume(v))} />
                {playing ? (
                  <button type="button" className="btn btn-sm" onClick={stopAmbient}>■ Stop</button>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={looped.length + layered.length === 0} onClick={() => playSequence(s.id, looped, vol(`ambient:${s.id}`, s.volume), layered)}>
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
                <li key={c.id} data-clip={c.name} className={`flex items-center gap-2 rounded px-2 py-1 ${now?.clipId === c.id || now?.layerIds.includes(c.id) ? "bg-primary/20" : ""}`}>
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
                  {c.mode !== "loop" && c.mode !== "layer" && (
                    <button type="button" className="btn btn-xs" title="Play this clip now" onClick={() => playOnce(s.id, c, vol(`ambient:${s.id}`, s.volume))}>▶</button>
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
        onSelect={(a) => {
          if (adding === "positional") onToolChange({ ...tool, asset: a });
          else if (adding) addClipToSound(locationId, adding.soundId, a.id, adding.mode);
        }}
        upload={uploadAudioAsset.bind(null, locationId)}
      />

      <form key={sounds.length} action={submitAmbientSound.bind(null, locationId, levelId)} className="flex items-center gap-2">
        <input name="name" required placeholder="New ambient sound (e.g. Dripping cellar)" className="input input-sm w-72" />
        <button className="btn btn-sm">Add ambient sound</button>
      </form>
      <p className="text-xs opacity-60">Only one ambient sound plays at a time: its sequence clips one after another, with its layer clips looping underneath together. Event-triggered clips will play once map events exist.</p>

      <div className="space-y-2 border-t border-base-300 pt-3">
        <div className="text-sm font-semibold">Positional sounds</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="truncate max-w-48">{tool.asset ? tool.asset.name : "No audio chosen"}</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => {
              setAdding("positional");
              library.current?.open();
            }}
          >
            Choose audio…
          </button>
          <label className="flex items-center gap-1">
            Range (cells)
            <input
              type="number"
              min="0.5"
              step="0.5"
              aria-label="Range"
              value={tool.radius}
              onChange={(e) => onToolChange({ ...tool, radius: Number(e.target.value) || 3 })}
              className="input input-xs w-16"
            />
          </label>
        </div>
        <p className="text-xs opacity-60">{tool.asset ? "Click the map to place it." : "Choose audio, then click the map to place it."}</p>
        {positional.length > 0 && (
          <ul className="rounded-box bg-base-100 text-sm">
            {positional.map((p) => (
              <li key={p.id} className={`flex items-center gap-2 px-2 py-1 ${p.id === selectedPositionalId ? "bg-primary/20" : ""}`}>
                <button type="button" data-positional={p.name} onClick={() => onSelectPositional(p.id)} className="flex-1 text-left">
                  🔊 {p.name} <span className="text-xs opacity-60">at {Math.floor(p.x)}, {Math.floor(p.y)}</span>
                </button>
                <label className="flex items-center gap-1 text-xs">
                  range
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    defaultValue={p.radius}
                    onBlur={(e) => Number(e.target.value) !== p.radius && changePositionalRadius(locationId, p.id, Number(e.target.value))}
                    className="input input-xs w-16"
                  />
                </label>
                <VolumeSlider
                  {...volumeProps("positional", p.id, p.volume, (v) => {
                    if (playingPositionalId === p.id && positionalAudio.current) positionalAudio.current.volume = v;
                  })}
                />
                <button
                  type="button"
                  title={playingPositionalId === p.id ? "Stop" : "Play this sound now"}
                  className="btn btn-xs"
                  onClick={() => togglePositional(p)}
                >
                  {playingPositionalId === p.id ? "■" : "▶"}
                </button>
                <button
                  type="button"
                  title="Remove this positional sound"
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => removePositionalSound(locationId, p.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Volume slider (0–100%): `onLive` while dragging, `onCommit` when released. */
function VolumeSlider({
  label,
  value,
  onLive,
  onCommit,
}: {
  label: string;
  value: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const commit = (e: { currentTarget: HTMLInputElement }) => onCommit(Number(e.currentTarget.value));
  return (
    <label className="flex items-center gap-1 text-xs" title="Volume">
      🔈
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        aria-label={label}
        value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className="range range-xs w-24"
      />
      <span className="w-8 text-right">{Math.round(value * 100)}%</span>
    </label>
  );
}
