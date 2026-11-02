"use client";

import { useState } from "react";
import { PERSPECTIVE_PROMPTS, PERSPECTIVES, type MapImage, type Perspective } from "@/lib/maps";
import ImagePicker from "../../ImagePicker";
import { submitMapImage } from "../actions";

/** Map layer editor: the map image (uploaded or generated) and its perspective. */
export default function MapImageEditor({ locationId, levelId, mapImage }: { locationId: number; levelId: number; mapImage: MapImage }) {
  const [description, setDescription] = useState("");
  const [perspective, setPerspective] = useState<Perspective>(mapImage.perspective);
  // The perspective steers generation; only send a prompt once the GM has described the map.
  const prompt = description.trim() ? `${PERSPECTIVE_PROMPTS[perspective]} ${description}` : "";

  return (
    <form action={submitMapImage.bind(null, locationId, levelId)} className="space-y-3">
      <div className="flex gap-4">
        <ImagePicker kind="map" name="map" description={prompt} initial={mapImage.image} freeUpload />
        <div className="flex-1 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            Perspective
            {/* Uncontrolled: React resets forms after their action, and a controlled select would show its first option. */}
            <select name="perspective" defaultValue={mapImage.perspective} onChange={(e) => setPerspective(e.target.value as Perspective)} className="select select-sm w-40">
              {PERSPECTIVES.map((p) => (
                <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe a map to generate (e.g. ruined chapel in a swamp)"
            className="input input-sm w-full"
          />
          <p className="text-xs opacity-60">The image is centred in the background&apos;s padded area, keeping its aspect ratio.</p>
        </div>
      </div>
      <button className="btn btn-primary btn-sm">Save map</button>
    </form>
  );
}
