"use client";

import { useState } from "react";
import { EDGES, type MapImage } from "@/lib/maps";
import ImagePicker from "../../ImagePicker";
import { submitMapImage } from "../actions";

/** Map layer editor: the map image (uploaded or generated) and padding around each edge. */
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
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Padding (image pixels)</legend>
            <div className="grid grid-cols-4 gap-2">
              {EDGES.map((e) => (
                <label key={e} className="floating-label">
                  <span>{e[0].toUpperCase() + e.slice(1)}</span>
                  <input name={`pad_${e}`} type="number" min="0" defaultValue={mapImage.padding[e]} placeholder={e} className="input input-sm" />
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
      <button className="btn btn-primary btn-sm">Save map</button>
    </form>
  );
}
