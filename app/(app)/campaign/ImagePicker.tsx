"use client";

import { useRef, useState } from "react";
import { generateArtwork, type ArtworkKind } from "./actions";

/**
 * Image square with Upload / Generate buttons, enabled once name and description are filled.
 * Submits as form fields "upload" (file) and "image" (generated URL); read them with imageFromForm().
 */
export default function ImagePicker({ kind, name, description }: { kind: ArtworkKind; name: string; description: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const enabled = name.trim() !== "" && description.trim() !== "";

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setGeneratedUrl("");
    setPreview(URL.createObjectURL(file));
  }

  async function onGenerate() {
    setGenerating(true);
    setError("");
    const result = await generateArtwork(kind, name, description);
    setGenerating(false);
    if (result.error) return setError(result.error);
    if (fileInput.current) fileInput.current.value = "";
    setGeneratedUrl(result.url!);
    setPreview(result.url!);
  }

  return (
    <div className="w-40 shrink-0 space-y-2">
      <div className="size-40 rounded-box bg-base-300 overflow-hidden flex items-center justify-center">
        {generating ? (
          <span className="loading loading-spinner" />
        ) : preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-xs opacity-50 text-center px-2">
            {enabled ? "No image" : "Enter a name and description to add an image"}
          </span>
        )}
      </div>
      <label className={`btn btn-sm w-full ${enabled ? "" : "btn-disabled"}`}>
        Upload
        <input ref={fileInput} name="upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onUpload} disabled={!enabled} />
      </label>
      <button type="button" className="btn btn-sm w-full" disabled={!enabled || generating} onClick={onGenerate}>
        Generate
      </button>
      <input type="hidden" name="image" value={generatedUrl} />
      {error && <div className="text-error text-xs">{error}</div>}
    </div>
  );
}
