import type { ProfessionGroup } from "@/lib/db";
import { submitProfessionGroup } from "./actions";

/** A profession's name and description (a new one: its starting rank too). */
export default function ProfessionFields({ initial }: { initial?: ProfessionGroup }) {
  return (
    <form action={submitProfessionGroup.bind(null, initial?.id ?? null)} className="space-y-3 max-w-2xl">
      <input name="name" placeholder="Profession name (e.g. Law Enforcement)" required defaultValue={initial?.name} className="input w-full" />
      <textarea name="description" placeholder="Description" defaultValue={initial?.description} className="textarea w-full" />
      {!initial && <input name="first_rank" placeholder="Starting rank (e.g. Beat Cop)" className="input w-full" />}
      <button className="btn btn-primary btn-sm">{initial ? "Save profession" : "Create profession"}</button>
    </form>
  );
}
