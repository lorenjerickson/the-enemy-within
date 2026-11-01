import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { createItem, ITEM_TYPES, type ItemType } from "@/lib/db";

async function addItem(formData: FormData) {
  "use server";
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => Number(formData.get(k)) || 0;
  const type = text("type") as ItemType;
  if (!ITEM_TYPES.includes(type)) throw new Error("Invalid item type");

  createItem({
    name: text("name"),
    description: text("description"),
    type,
    weight: num("weight"),
    value: num("value"),
    rarity: text("rarity"),
    durability: num("durability"),
  });
  redirect("/campaign/items");
}

export default async function NewItem() {
  await connection();
  await requireGm();

  return (
    <form action={addItem} className="space-y-3 max-w-md">
      <h2 className="text-xl font-semibold">New item</h2>
      <input name="name" placeholder="Name" required className="input w-full" />
      <textarea name="description" placeholder="Short description" className="textarea w-full" />
      <select name="type" required defaultValue="" className="select w-full">
        <option value="" disabled>Type</option>
        {ITEM_TYPES.map((t) => (
          <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <label className="floating-label"><span>Weight</span>
          <input name="weight" type="number" step="any" min="0" placeholder="Weight" className="input" /></label>
        <label className="floating-label"><span>Value</span>
          <input name="value" type="number" min="0" placeholder="Value" className="input" /></label>
        <label className="floating-label"><span>Durability</span>
          <input name="durability" type="number" min="0" placeholder="Durability" className="input" /></label>
      </div>
      <input name="rarity" placeholder="Rarity" className="input w-full" />
      <button className="btn btn-primary">Save item</button>
    </form>
  );
}
