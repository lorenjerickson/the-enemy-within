"use client";

import { useState } from "react";
import { DICE_PATTERN, ITEM_TYPES, MODIFIER_PATTERN, RARITIES } from "@/lib/itemTypes";
import { addItem, generateItemImage } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function ItemForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const canPickImage = name.trim() !== "" && description.trim() !== "";

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setGeneratedUrl("");
    setPreview(URL.createObjectURL(file));
  }

  async function onGenerate(form: HTMLFormElement) {
    setGenerating(true);
    setError("");
    const result = await generateItemImage(name, description);
    setGenerating(false);
    if (result.error) return setError(result.error);
    (form.elements.namedItem("upload") as HTMLInputElement).value = "";
    setGeneratedUrl(result.url!);
    setPreview(result.url!);
  }

  return (
    <form action={addItem} className="space-y-3 max-w-2xl">
      <h2 className="text-xl font-semibold">New item</h2>
      <div className="flex gap-4">
        <div className="w-40 shrink-0 space-y-2">
          <div className="size-40 rounded-box bg-base-300 overflow-hidden flex items-center justify-center">
            {generating ? (
              <span className="loading loading-spinner" />
            ) : preview ? (
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-xs opacity-50 text-center px-2">
                {canPickImage ? "No image" : "Enter a name and description to add an image"}
              </span>
            )}
          </div>
          <label className={`btn btn-sm w-full ${canPickImage ? "" : "btn-disabled"}`}>
            Upload
            <input name="upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onUpload} disabled={!canPickImage} />
          </label>
          <button
            type="button"
            className="btn btn-sm w-full"
            disabled={!canPickImage || generating}
            onClick={(e) => onGenerate(e.currentTarget.form!)}
          >
            Generate
          </button>
          <input type="hidden" name="image" value={generatedUrl} />
        </div>
        <div className="flex-1 space-y-3">
          <input name="name" placeholder="Name" required className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea name="description" placeholder="Short description" className="textarea w-full h-[6.5rem]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      {error && <div className="alert alert-error text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <select name="type" required value={type} onChange={(e) => setType(e.target.value)} className="select w-full">
          <option value="" disabled>Type</option>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>{capitalize(t)}</option>
          ))}
        </select>
        <select name="rarity" required defaultValue="" className="select w-full">
          <option value="" disabled>Rarity</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>{capitalize(r)}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="floating-label"><span>Weight (kg)</span>
          <input name="weight" type="number" step="any" min="0" placeholder="Weight (kg)" className="input" /></label>
        <label className="floating-label"><span>Value</span>
          <input name="value" type="number" min="0" placeholder="Value" className="input" /></label>
        <label className="floating-label"><span>Durability (1–100)</span>
          <input name="durability" type="number" min="1" max="100" required placeholder="Durability (1–100)" className="input" /></label>
      </div>
      {type === "armor" && (
        <label className="floating-label"><span>Defense dice (e.g. 1d4)</span>
          <input name="defense" required pattern={DICE_PATTERN} placeholder="Defense dice (e.g. 1d4)" className="input w-full" /></label>
      )}
      {type === "weapon" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="floating-label"><span>Damage dice (e.g. 2d6)</span>
            <input name="damage" required pattern={DICE_PATTERN} placeholder="Damage dice (e.g. 2d6)" className="input w-full" /></label>
          <label className="floating-label"><span>To-hit modifier (e.g. 1d4 or -2)</span>
            <input name="attack" pattern={MODIFIER_PATTERN} placeholder="To-hit modifier (e.g. 1d4 or -2)" className="input w-full" /></label>
        </div>
      )}
      <button className="btn btn-primary">Save item</button>
    </form>
  );
}
