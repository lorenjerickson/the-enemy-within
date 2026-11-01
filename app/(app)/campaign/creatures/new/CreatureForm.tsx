"use client";

import { useState } from "react";
import { CREATURE_TYPES } from "@/lib/creatureTypes";
import ImagePicker from "../../ImagePicker";
import AttributesInput from "./AttributesInput";
import EquipmentInput, { type EquippableItem } from "./EquipmentInput";
import { addCreature } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function CreatureForm({ items }: { items: EquippableItem[] }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <form action={addCreature} className="space-y-3 max-w-2xl">
      <h2 className="text-xl font-semibold">New creature</h2>
      <div className="flex gap-4">
        <ImagePicker kind="creature" name={name} description={description} />
        <div className="flex-1 space-y-3">
          <input name="name" placeholder="Name" required className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea name="description" placeholder="Description" className="textarea w-full h-[6.5rem]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <select name="type" required defaultValue="" className="select w-full">
        <option value="" disabled>Creature type</option>
        {CREATURE_TYPES.map((t) => (
          <option key={t} value={t}>{capitalize(t)}</option>
        ))}
      </select>
      <AttributesInput />
      <EquipmentInput items={items} />
      <button className="btn btn-primary">Save creature</button>
    </form>
  );
}
