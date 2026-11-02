"use client";

import { useState, type ReactNode } from "react";
import { CREATURE_TYPES, MOVEMENT_TYPES } from "@/lib/creatureTypes";
import { DICE_PATTERN } from "@/lib/itemTypes";
import ImagePicker from "../../ImagePicker";
import AttributesInput from "./AttributesInput";
import EquipmentInput, { type EquippableItem } from "./EquipmentInput";
import type { Creature } from "@/lib/db";
import { submitCreature } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Creature editor. Characters reuse it with their own action, title and initial data. */
export default function CreatureForm({
  items,
  initial,
  action,
  title,
  submitLabel = "Save creature",
  extra,
}: {
  items: EquippableItem[];
  initial?: Partial<Creature>;
  action?: (formData: FormData) => Promise<void>;
  title?: string;
  submitLabel?: string;
  extra?: ReactNode; // additional fields rendered above the submit button
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  return (
    <form action={action ?? submitCreature.bind(null, initial?.id ?? null)} className="space-y-3 max-w-2xl">
      <h2 className="text-xl font-semibold">{title ?? (initial ? "Edit creature" : "New creature")}</h2>
      <div className="flex gap-4">
        <ImagePicker kind="creature" name={name} description={description} initial={initial?.image} label="Portrait" />
        <div className="flex-1 space-y-3">
          <input name="name" placeholder="Name" required className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea name="description" placeholder="Description" className="textarea w-full h-[6.5rem]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      {/* Map tokens: seen from above on overhead maps, side-on on portrait maps. */}
      <div className="flex gap-4">
        <ImagePicker kind="overhead token" field="tokenOverhead" label="Overhead token" small name={name} description={description} initial={initial?.token_overhead} />
        <ImagePicker kind="side token" field="tokenSide" label="Side-on token" small name={name} description={description} initial={initial?.token_side} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select name="type" required defaultValue={initial?.type ?? ""} className="select w-full">
          <option value="" disabled>Creature type</option>
          {CREATURE_TYPES.map((t) => (
            <option key={t} value={t}>{capitalize(t)}</option>
          ))}
        </select>
        <label className="floating-label"><span>Health dice (e.g. 2d8+4)</span>
          <input name="health" required pattern={DICE_PATTERN} placeholder="Health dice (e.g. 2d8+4)" defaultValue={initial?.health} className="input w-full" /></label>
      </div>
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Maximum movement range (metres, 0 = none)</legend>
        <div className="grid grid-cols-7 gap-2">
          {MOVEMENT_TYPES.map((m) => (
            <label key={m} className="floating-label">
              <span>{capitalize(m)}</span>
              <input name={`move:${m}`} type="number" min="0" step="any" placeholder={capitalize(m)} defaultValue={initial?.movement?.[m] ?? 0} className="input" />
            </label>
          ))}
        </div>
      </fieldset>
      <AttributesInput initial={initial?.attributes} />
      <EquipmentInput items={items} initial={initial?.equipment} />
      {extra}
      <button className="btn btn-primary">{submitLabel}</button>
    </form>
  );
}
