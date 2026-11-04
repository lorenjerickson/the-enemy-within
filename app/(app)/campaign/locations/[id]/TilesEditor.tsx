"use client";

import { useEffect, useState } from "react";
import type { Asset, MapTile } from "@/lib/db";
import ImagePicker from "../../ImagePicker";
import { addTileAsset } from "../actions";
import AssetPicker from "./AssetPicker";

/** Tiles layer editor: choose (or upload / generate) the tile asset that clicks on the map will place. */
export default function TilesEditor({
  locationId,
  gridless,
  assets,
  asset,
  onAssetChange: setAsset,
  tiles,
  selectedTileId,
  onSelectTile,
  onDeleteTile,
}: {
  locationId: number;
  gridless: boolean; // placed anywhere, any size
  assets: Asset[];
  asset: Asset | null;
  onAssetChange: (asset: Asset) => void;
  tiles: MapTile[];
  selectedTileId: number | null;
  onSelectTile: (id: number) => void;
  onDeleteTile: (id: number) => void;
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

      {asset && (
        <p className="text-xs opacity-60">
          {gridless ? "Click and drag to cover an area with it." : "Click a grid cell to place it, or click and drag to cover several cells."}
        </p>
      )}

      <div className="space-y-1">
        <div className="text-sm font-semibold">Placed tiles</div>
        {tiles.length === 0 ? (
          <p className="text-xs opacity-60">None yet.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto rounded-box bg-base-100 text-sm">
            {tiles.map((t) => (
              <li key={t.id} className={`flex items-center gap-2 px-2 py-1 ${t.id === selectedTileId ? "bg-primary/20" : ""}`}>
                <button type="button" data-tile={t.id} onClick={() => onSelectTile(t.id)} className="flex flex-1 items-center gap-2 text-left">
                  <img src={t.url} alt="" className="size-6 rounded object-cover" />
                  <span>{t.name}</span>
                  <span className="text-xs opacity-60">
                    {gridless ? `x ${t.col}, y ${t.row} · ${t.cols}×${t.rows}` : `col ${t.col}, row ${t.row}`}
                    {!gridless && (t.cols > 1 || t.rows > 1) && ` · ${t.cols}×${t.rows}`}
                  </span>
                </button>
                {t.id === selectedTileId && (
                  <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => onDeleteTile(t.id)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {selectedTileId !== null && <p className="text-xs opacity-60">Drag the highlighted tile on the map to move it.</p>}
      </div>
    </div>
  );
}
