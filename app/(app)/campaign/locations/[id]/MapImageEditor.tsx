"use client";

import { useState } from "react";
import type { MapImage } from "@/lib/maps";
import ImagePicker from "../../ImagePicker";
import { submitMapImage } from "../actions";

/** Map layer editor: the map image (uploaded or generated). */
export default function MapImageEditor({ locationId, levelId, mapImage }: { locationId: number; levelId: number; mapImage: MapImage }) {
  const [description, setDescription] = useState("");

  return (
    <form action={submitMapImage.bind(null, locationId, levelId)} className="space-y-3">
      <div className="flex gap-4">
        <ImagePicker kind="map" name="map" description={description} initial={mapImage.image} freeUpload />
        <div className="flex-1 space-y-3">
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
