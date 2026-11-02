"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { Asset, AssetType, AssetUsage } from "@/lib/db";

export interface MediaLibraryHandle {
  open: () => void;
}

/**
 * Modal media library, filtered to one asset type and usage, with search and an upload row.
 * Images show as thumbnails; audio shows a small player for previewing.
 */
const MediaLibrary = forwardRef<
  MediaLibraryHandle,
  {
    type: AssetType;
    usage: AssetUsage;
    assets: Asset[];
    selectedId?: number | null;
    onSelect: (asset: Asset) => void;
    upload: (formData: FormData) => Promise<void>; // form action; the file field is named "upload" (images) or "audio"
  }
>(function MediaLibrary({ type, usage, assets, selectedId, onSelect, upload }, ref) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useImperativeHandle(ref, () => ({ open: () => dialog.current?.showModal() }));
  const q = query.trim().toLowerCase();
  const shown = assets.filter((a) => !q || a.name.toLowerCase().includes(q));
  const accept = type === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "audio/mpeg,audio/ogg,audio/wav";

  return (
    <dialog ref={dialog} className="modal">
      <div className="modal-box max-w-3xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Media library</h3>
          <span className="text-xs opacity-60">Type: {type} · Usage: {usage}</span>
        </div>
        <input type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="input input-sm w-full" />
        {shown.length === 0 ? (
          <p className="text-sm opacity-60">{assets.length === 0 ? `No ${usage} ${type} assets yet — upload one below.` : "Nothing matches."}</p>
        ) : type === "image" ? (
          <ul className="grid grid-cols-4 gap-3 max-h-80 overflow-y-auto">
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  data-asset={a.name}
                  className={`w-full rounded-box p-2 text-left hover:bg-base-200 ${selectedId === a.id ? "ring-2 ring-primary" : ""}`}
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
        ) : (
          <ul className="max-h-80 overflow-y-auto space-y-1">
            {shown.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-box px-2 py-1 hover:bg-base-200">
                <span className="w-40 truncate text-sm">{a.name}</span>
                <audio src={a.url} controls preload="none" className="h-8 flex-1" />
                <button
                  type="button"
                  data-asset={a.name}
                  className="btn btn-sm"
                  onClick={() => {
                    onSelect(a);
                    dialog.current?.close();
                  }}
                >
                  Select
                </button>
              </li>
            ))}
          </ul>
        )}
        <form key={assets.length} action={upload} className="flex items-center gap-2 border-t border-base-300 pt-3">
          <input name="name" placeholder="New asset name" required className="input input-sm flex-1" />
          <input name={type === "image" ? "upload" : "audio"} type="file" accept={accept} required className="file-input file-input-sm" />
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
  );
});

export default MediaLibrary;
