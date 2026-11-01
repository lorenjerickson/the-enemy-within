import type { Profession } from "@/lib/db";
import { submitProfession } from "./actions";

export default function ProfessionFields({ initial }: { initial?: Profession }) {
  return (
    <form action={submitProfession.bind(null, initial?.id ?? null)} className="space-y-3 max-w-2xl">
      <input name="name" placeholder="Profession name (e.g. Infantryman)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="Description" defaultValue={initial?.description} className="textarea w-full" />
      <button className="btn btn-primary btn-sm">{initial ? "Save profession" : "Create profession"}</button>
    </form>
  );
}
