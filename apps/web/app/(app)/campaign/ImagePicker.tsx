"use client";

import { useRef, useState } from "react";
import { generateArtwork, type ArtworkKind } from "./actions";

/**
 * Image square with Upload / Generate buttons, enabled once name and description are filled.
 * Submits as form fields "upload" (file) and "image" (generated URL), or "<field>Upload" and "<field>"
 * for another field name; read them with imageFromForm(formData, usage, name, field).
 */
export default function ImagePicker({
  kind,
  name,
  description,
  initial = null,
  freeUpload = false,
  field = "image",
  label,
  small = false,
}: {
  kind: ArtworkKind;
  name: string;
  description: string;
  initial?: string | null;
  freeUpload?: boolean; // allow upload before name/description are filled (they're only needed to generate)
  field?: string; // form field name, for several pickers in one form
  label?: string; // caption above the image
  small?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initial);
  const [generatedUrl, setGeneratedUrl] = useState(initial ?? "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const enabled = name.trim() !== "" && description.trim() !== "";
  const uploadEnabled = freeUpload || enabled;

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
    <div className={`${small ? "w-28" : "w-40"} shrink-0 space-y-2`}>
      {label && <div className="text-xs opacity-70">{label}</div>}
      <div className={`${small ? "size-28" : "size-40"} rounded-box bg-base-300 overflow-hidden flex items-center justify-center`}>
        {generating ? (
          <span className="loading loading-spinner" />
        ) : preview ? (
          <img src={preview} alt="" className={`size-full ${small ? "object-contain" : "object-cover"}`} />
        ) : (
          <span className="text-xs opacity-50 text-center px-2">
            {enabled ? "No image" : "Enter a name and description to add an image"}
          </span>
        )}
      </div>
      <label className={`btn btn-sm w-full ${uploadEnabled ? "" : "btn-disabled"}`}>
        Upload
        <input ref={fileInput} name={field === "image" ? "upload" : `${field}Upload`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onUpload} disabled={!uploadEnabled} />
      </label>
      <button type="button" className="btn btn-sm w-full" disabled={!enabled || generating} onClick={onGenerate}>
        Generate
      </button>
      <input type="hidden" name={field} value={generatedUrl} />
      {error && <div className="text-error text-xs">{error}</div>}
    </div>
  );
}
