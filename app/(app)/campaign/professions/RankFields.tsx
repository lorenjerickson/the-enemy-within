import type { Profession } from "@/lib/db";
import { submitRank } from "./actions";

/** A rank's name and description. */
export default function RankFields({ initial }: { initial: Profession }) {
  return (
    <form action={submitRank.bind(null, initial.id)} className="space-y-3 max-w-2xl">
      <input name="name" placeholder="Rank name (e.g. Detective)" required defaultValue={initial.name} className="input w-full" />
      <textarea name="description" placeholder="Description" defaultValue={initial.description} className="textarea w-full" />
      <button className="btn btn-primary btn-sm">Save rank</button>
    </form>
  );
}
