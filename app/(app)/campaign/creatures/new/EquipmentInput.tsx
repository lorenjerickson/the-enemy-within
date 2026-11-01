"use client";

import { useState } from "react";
import { EQUIP_SLOTS, type EquipSlot } from "@/lib/itemTypes";
import type { Equipment } from "@/lib/db";

export interface EquippableItem {
  id: number;
  name: string;
  slots: EquipSlot[];
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Per slot: an "enabled" checkbox (slot:<slot>) and an item picker limited to compatible items (item:<slot>). */
export default function EquipmentInput({ items, initial = {} }: { items: EquippableItem[]; initial?: Equipment }) {
  const [enabled, setEnabled] = useState<Set<EquipSlot>>(new Set(Object.keys(initial) as EquipSlot[]));

  function toggle(slot: EquipSlot, on: boolean) {
    const next = new Set(enabled);
    if (on) next.add(slot);
    else next.delete(slot);
    setEnabled(next);
  }

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Equipment slots</legend>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {EQUIP_SLOTS.map((slot) => {
          const on = enabled.has(slot);
          const compatible = items.filter((i) => i.slots.includes(slot));
          return (
            <div key={slot} className="flex items-center gap-2">
              <label className="flex items-center gap-2 w-32 cursor-pointer">
                <input type="checkbox" name={`slot:${slot}`} className="checkbox checkbox-sm" checked={on} onChange={(e) => toggle(slot, e.target.checked)} />
                {capitalize(slot)}
              </label>
              <select name={`item:${slot}`} disabled={!on} defaultValue={initial[slot] ?? ""} className="select select-sm flex-1">
                <option value="">{compatible.length ? "Empty" : "No compatible items"}</option>
                {compatible.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
