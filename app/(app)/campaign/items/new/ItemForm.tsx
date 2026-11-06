"use client";

import { useState } from "react";
import { DICE_PATTERN, EQUIP_SLOTS, ITEM_TYPES, MODIFIER_PATTERN, RARITIES } from "@/lib/itemTypes";
import ImagePicker from "../../ImagePicker";
import type { Item } from "@/lib/db";
import { submitItem } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function ItemForm({ initial }: { initial?: Item }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<string>(initial?.type ?? "");
  const [stackable, setStackable] = useState((initial?.max_stack ?? 1) > 1);

  return (
    <form action={submitItem.bind(null, initial?.id ?? null)} className="space-y-3 max-w-2xl">
      <h2 className="text-xl font-semibold">{initial ? "Edit item" : "New item"}</h2>
      <div className="flex gap-4">
        <ImagePicker kind="item" name={name} description={description} initial={initial?.image} />
        <div className="flex-1 space-y-3">
          <input name="name" placeholder="Name" required className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea name="description" placeholder="Short description" className="textarea w-full h-[6.5rem]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select name="type" required value={type} onChange={(e) => setType(e.target.value)} className="select w-full">
          <option value="" disabled>Type</option>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>{capitalize(t)}</option>
          ))}
        </select>
        <select name="rarity" required defaultValue={initial?.rarity ?? ""} className="select w-full">
          <option value="" disabled>Rarity</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>{capitalize(r)}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="floating-label"><span>Weight (kg)</span>
          <input name="weight" type="number" step="any" min="0" placeholder="Weight (kg)" defaultValue={initial?.weight} className="input" /></label>
        <label className="floating-label"><span>Value</span>
          <input name="value" type="number" min="0" placeholder="Value" defaultValue={initial?.value} className="input" /></label>
        <label className="floating-label"><span>Durability (1–100)</span>
          <input name="durability" type="number" min="1" max="100" required placeholder="Durability (1–100)" defaultValue={initial?.durability} className="input" /></label>
      </div>
      {type === "armor" && (
        <label className="floating-label"><span>Defense dice (e.g. 1d4)</span>
          <input name="defense" required pattern={DICE_PATTERN} placeholder="Defense dice (e.g. 1d4)" defaultValue={initial?.defense ?? ""} className="input w-full" /></label>
      )}
      {type === "weapon" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="floating-label"><span>Damage dice (e.g. 2d6)</span>
            <input name="damage" required pattern={DICE_PATTERN} placeholder="Damage dice (e.g. 2d6)" defaultValue={initial?.damage ?? ""} className="input w-full" /></label>
          <label className="floating-label"><span>To-hit modifier (e.g. 1d4 or -2)</span>
            <input name="attack" pattern={MODIFIER_PATTERN} placeholder="To-hit modifier (e.g. 1d4 or -2)" defaultValue={initial?.attack ?? ""} className="input w-full" /></label>
          <label className="floating-label col-span-2"><span>Effective range in feet (5 = melee reach)</span>
            <input name="range_ft" type="number" min="5" step="5" placeholder="Effective range in feet (5 = melee reach)" defaultValue={initial?.range_ft ?? 5} className="input w-full" /></label>
        </div>
      )}
      {type === "consumable" && (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input name="stackable" type="checkbox" className="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
            Stackable
          </label>
          {stackable && (
            <div className="flex-1">
              <label className="floating-label"><span>Max stack size</span>
                <input name="max_stack" type="number" min="2" required placeholder="Max stack size" defaultValue={initial?.max_stack ?? undefined} className="input w-full" /></label>
            </div>
          )}
        </div>
      )}
      {type === "container" && (
        <label className="floating-label"><span>Capacity (number of items or stacks)</span>
          <input name="capacity" type="number" min="1" required placeholder="Capacity (number of items or stacks)" defaultValue={initial?.capacity ?? undefined} className="input w-full" /></label>
      )}
      <label className="floating-label"><span>Held in</span>
        <select name="hands" defaultValue={initial?.hands ?? 0} className="select w-full">
          <option value={0}>Not held</option>
          <option value={1}>One hand</option>
          <option value={2}>Both hands (the other hand stays free of anything else)</option>
        </select></label>
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Equipment slots (leave empty if not equippable)</legend>
        <div className="grid grid-cols-4 gap-2">
          {EQUIP_SLOTS.map((slot) => (
            <label key={slot} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="slots" value={slot} defaultChecked={initial?.slots.includes(slot)} className="checkbox checkbox-sm" />
              {capitalize(slot)}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn btn-primary">Save item</button>
    </form>
  );
}
