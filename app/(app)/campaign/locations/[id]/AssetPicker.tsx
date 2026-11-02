"use client";

import { useRef, useState } from "react";
import type { Asset } from "@/lib/db";
import { uploadTileAsset } from "../actions";

/**
 * "Select asset" button opening a modal asset library, already filtered to image tiles, with search.
 * The library can also take a new upload.
 */
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = assets.filter((a) => !q || a.name.toLowerCase().includes(q));

  return (
    <>
      <div className="flex items-center gap-3">
        {selected && <img src={selected.url} alt="" className="size-10 rounded object-cover" />}
        <span className="text-sm">{selected ? selected.name : "No asset selected"}</span>
        <button type="button" className="btn btn-sm" onClick={() => dialog.current?.showModal()}>
          Select asset…
        </button>
      </div>

      <dialog ref={dialog} className="modal">
        <div className="modal-box max-w-3xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Asset library</h3>
            <span className="text-xs opacity-60">Type: image · Usage: tile</span>
          </div>
          <input type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="input input-sm w-full" />
          {shown.length === 0 ? (
            <p className="text-sm opacity-60">{assets.length === 0 ? "No tile assets yet — upload one below." : "Nothing matches."}</p>
          ) : (
            <ul className="grid grid-cols-4 gap-3 max-h-80 overflow-y-auto">
              {shown.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    data-asset={a.name}
                    className={`w-full rounded-box p-2 text-left hover:bg-base-200 ${selected?.id === a.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => {
                      onSelect(a);
                      dialog.current?.close();
                    }}
                  >
                    <img src={a.url} alt="" className="aspect-square w-full rounded object-cover" />
                    <div className="mt-1 truncate text-sm">{a.name}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form action={uploadTileAsset.bind(null, locationId)} className="flex items-center gap-2 border-t border-base-300 pt-3">
            <input name="name" placeholder="New asset name" required className="input input-sm flex-1" />
            <input name="upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required className="file-input file-input-sm" />
            <button className="btn btn-sm">Upload</button>
          </form>
          <div className="modal-action mt-0">
            <form method="dialog">
              <button className="btn btn-sm">Close</button>
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
