"use client";

import { useState } from "react";
import type { Asset } from "@/lib/db";
import AssetPicker from "./AssetPicker";

/** Tiles layer editor. Step 1 of placing a tile: choose the asset to place. */
export default function TilesEditor({ locationId, assets }: { locationId: number; assets: Asset[] }) {
  const [asset, setAsset] = useState<Asset | null>(null);
  return (
    <div className="space-y-2">
      <AssetPicker locationId={locationId} assets={assets} selected={asset} onSelect={setAsset} />
      {asset && <p className="text-xs opacity-60">Placing tiles on the map comes next.</p>}
    </div>
  );
}
