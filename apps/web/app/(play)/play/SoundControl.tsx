"use client";

import { useEffect } from "react";
import { setAmbientGain } from "@/lib/ambientPlayer";
import { master, onSoundPrefs, setSoundPrefs, useSoundPrefs } from "@/lib/soundPrefs";

/**
 * A player's sound: "Enable sound" until they click it (browsers play nothing before a click on the page), then a
 * mute button and a volume slider, remembered in this browser.
 */
export default function SoundControl() {
  const p = useSoundPrefs();
  useEffect(() => { setAmbientGain(master()); return onSoundPrefs(() => setAmbientGain(master())); }, []);
  return (
    <div className="fixed bottom-3 left-3 z-30 flex items-center gap-2 rounded-box bg-base-100/90 px-2 py-1 text-sm shadow" data-sound-control>
      {!p.on ? (
        <button type="button" className="btn btn-primary btn-xs" onClick={() => setSoundPrefs({ on: true })}>🔊 Enable sound</button>
      ) : (
        <>
          <button type="button" className="btn btn-ghost btn-xs" aria-label={p.muted ? "Unmute" : "Mute"} onClick={() => setSoundPrefs({ muted: !p.muted })}>{p.muted ? "🔇" : "🔊"}</button>
          <input type="range" min={0} max={1} step={0.05} value={p.volume} aria-label="Volume" className="range range-xs w-24" onChange={(e) => setSoundPrefs({ volume: Number(e.target.value), muted: false })} />
        </>
      )}
    </div>
  );
}
