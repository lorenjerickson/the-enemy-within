"use client";

import { useRef } from "react";
import type { Asset } from "@/lib/db";
import { uploadTileAsset } from "../actions";
import MediaLibrary, { type MediaLibraryHandle } from "./MediaLibrary";

/** Shows the selected tile asset and a "Select asset…" button opening the media library (image · tile). */
export default function AssetPicker({
  locationId,
  assets,
  selected,
  onSelect,
}: {
  locationId: number;
  assets: Asset[];
  selected: Asset | null;
  onSelect: (asset: Asset) => void;
}) {
  const library = useRef<MediaLibraryHandle>(null);
  return (
    <>
      <div className="flex items-center gap-3">
        {selected && <img src={selected.url} alt="" className="size-10 rounded object-cover" />}
        <span className="text-sm">{selected ? selected.name : "No asset selected"}</span>
        <button type="button" className="btn btn-sm" onClick={() => library.current?.open()}>
          Select asset…
        </button>
      </div>
      <MediaLibrary
        ref={library}
        type="image"
        usage="tile"
        assets={assets}
        selectedId={selected?.id}
        onSelect={onSelect}
        upload={uploadTileAsset.bind(null, locationId)}
      />
    </>
  );
}
