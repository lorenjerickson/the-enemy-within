"use client";

import { useRouter } from "next/navigation";
import { deleteLevel, submitLevel } from "../actions";

/** One row: pick / remove the current level on the left, add a level above or below it on the right. */
export default function LevelBar({
  locationId,
  levels,
  currentId,
}: {
  locationId: number;
  levels: { id: number; name: string }[];
  currentId: number;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Level:</span>
      <select
        aria-label="Level"
        value={currentId}
        onChange={(e) => router.push(`/campaign/locations/${locationId}?level=${e.target.value}`)}
        className="select select-sm w-40"
      >
        {levels.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      {levels.length > 1 && (
        <form action={deleteLevel.bind(null, locationId, currentId)}>
          <button className="btn btn-sm btn-ghost text-error">Remove</button>
        </form>
      )}
      <form key={levels.length} action={submitLevel.bind(null, locationId, currentId)} className="ml-auto flex items-center gap-2">
        <span>Add level</span>
        <input name="name" required placeholder="Name" aria-label="New level name" className="input input-sm w-32" />
        <select name="where" aria-label="Position" defaultValue="above" className="select select-sm w-24">
          <option value="above">above</option>
          <option value="below">below</option>
        </select>
        <button className="btn btn-sm">Add</button>
      </form>
    </div>
  );
}
