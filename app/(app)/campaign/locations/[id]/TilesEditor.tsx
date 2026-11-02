"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/db";
import ImagePicker from "../../ImagePicker";
import { addTileAsset } from "../actions";
import AssetPicker from "./AssetPicker";

/** Tiles layer editor: choose (or upload / generate) the tile asset that clicks on the map will place. */
export default function TilesEditor({
  locationId,
  assets,
  asset,
  onAssetChange: setAsset,
}: {
  locationId: number;
  assets: Asset[];
  asset: Asset | null;
  onAssetChange: (asset: Asset) => void;
}) {
  const [newId, setNewId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formKey, setFormKey] = useState(0);

  // Select a newly added asset once it shows up in the refreshed library.
  useEffect(() => {
    const added = assets.find((a) => a.id === newId);
    if (added) {
      setAsset(added);
      setNewId(null);
    }
  }, [assets, newId, setAsset]);

  async function add(formData: FormData) {
    const id = await addTileAsset(locationId, formData);
    if (id) {
      setNewId(id);
      setName("");
      setDescription("");
      setFormKey((k) => k + 1);
    }
  }

  return (
    <div className="space-y-4">
      <AssetPicker locationId={locationId} assets={assets} selected={asset} onSelect={setAsset} />

      <details className="rounded-box border border-base-300 p-3">
        <summary className="cursor-pointer text-sm font-semibold">New tile asset</summary>
        <form key={formKey} action={add} className="mt-3 flex gap-4">
          <ImagePicker kind="tile" name={name} description={description} freeUpload />
          <div className="flex-1 space-y-2">
            <input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Mossy flagstone)" className="input input-sm w-full" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe it to generate" className="input input-sm w-full" />
            <button className="btn btn-primary btn-sm">Add to library</button>
          </div>
        </form>
      </details>

      {asset && <p className="text-xs opacity-60">Click a grid cell to place it, or click and drag to cover several cells.</p>}
    </div>
  );
}
