import { listLocations, type Location } from "@/lib/db";
import { submitLocation } from "./actions";

/** Name, description and parent. A location can't be placed inside itself or one of its own sub-locations. */
export default function LocationForm({ initial }: { initial?: Location }) {
  const all = listLocations();
  const excluded = new Set<number>();
  if (initial) {
    excluded.add(initial.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of all) if (l.parent_id !== null && excluded.has(l.parent_id) && !excluded.has(l.id)) { excluded.add(l.id); grew = true; }
    }
  }

  return (
    <form action={submitLocation.bind(null, initial?.id ?? null)} className="space-y-3 max-w-2xl">
      <h2 className="text-xl font-semibold">{initial ? "Edit location" : "New location"}</h2>
      <input name="name" placeholder="Name (e.g. San Francisco)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="Description" defaultValue={initial?.description} className="textarea w-full" />
      <select name="parent_id" defaultValue={initial?.parent_id ?? ""} className="select w-full">
        <option value="">Top level (no parent)</option>
        {all
          .filter((l) => !excluded.has(l.id))
          .map((l) => (
            <option key={l.id} value={l.id}>{l.path ? `${l.path} › ${l.name}` : l.name}</option>
          ))}
      </select>
      <button className="btn btn-primary">Save location</button>
    </form>
  );
}
