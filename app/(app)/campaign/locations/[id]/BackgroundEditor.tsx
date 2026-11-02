"use client";

import { useState } from "react";
import { EDGES, type MapBackground } from "@/lib/maps";
import ImagePicker from "../../ImagePicker";
import { submitBackground } from "../actions";

/** Background layer editor: a colour or a filled/tiled texture, plus the padding that frames the map image. */
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
            <input type="radio" name="mode" value={m} defaultChecked={background.mode === m} onChange={() => setMode(m)} hidden />
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

      <fieldset className="fieldset">
        <legend className="fieldset-legend">Padding around the map (pixels)</legend>
        <div className="grid grid-cols-4 gap-2">
          {EDGES.map((e) => (
            <label key={e} className="floating-label">
              <span>{e[0].toUpperCase() + e.slice(1)}</span>
              <input name={`pad_${e}`} type="number" min="0" defaultValue={background.padding[e]} placeholder={e} className="input input-sm" />
            </label>
          ))}
        </div>
      </fieldset>

      <button className="btn btn-primary btn-sm">Save background</button>
    </form>
  );
}
