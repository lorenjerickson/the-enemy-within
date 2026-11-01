"use client";

import { useState } from "react";
import type { MapBackground } from "@/lib/maps";
import ImagePicker from "../../ImagePicker";
import { submitBackground } from "../actions";

/** Background layer editor: a solid colour, or a texture (uploaded or generated) that fills or tiles. */
export default function BackgroundEditor({
  locationId,
  levelId,
  background,
}: {
  locationId: number;
  levelId: number;
  background: MapBackground;
}) {
  const [mode, setMode] = useState(background.mode);
  const [textureDescription, setTextureDescription] = useState("");

  return (
    <form action={submitBackground.bind(null, locationId, levelId)} className="space-y-3">
      <div className="join">
        {(["color", "texture"] as const).map((m) => (
          <label key={m} className={`btn btn-sm join-item ${mode === m ? "btn-primary" : ""}`}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} hidden />
            {m === "color" ? "Colour" : "Texture"}
          </label>
        ))}
      </div>

      <div className={mode === "color" ? "flex items-center gap-2" : "hidden"}>
        <input type="color" name="color" defaultValue={background.color} className="h-9 w-16 cursor-pointer rounded" />
        <span className="text-sm opacity-70">Background colour</span>
      </div>

      <div className={mode === "texture" ? "flex gap-4" : "hidden"}>
        <ImagePicker kind="texture" name="texture" description={textureDescription} initial={background.image} freeUpload />
        <div className="flex-1 space-y-3">
          <input
            value={textureDescription}
            onChange={(e) => setTextureDescription(e.target.value)}
            placeholder="Describe a texture to generate (e.g. wet cobblestones)"
            className="input input-sm w-full"
          />
          <div className="flex gap-4 text-sm">
            {(["fill", "tile"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="fit" value={f} defaultChecked={background.fit === f} className="radio radio-sm" />
                {f === "fill" ? "Fill the map" : "Tile"}
              </label>
            ))}
          </div>
        </div>
      </div>

      <button className="btn btn-primary btn-sm">Save background</button>
    </form>
  );
}
