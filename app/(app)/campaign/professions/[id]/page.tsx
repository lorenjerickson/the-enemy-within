import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getProfession, listAdvancements, listPrerequisites, listProfessions, type Profession } from "@/lib/db";
import { addAdvancement, removeAdvancement } from "../actions";
import ProfessionFields from "../ProfessionFields";

function ProfessionLinks({ professions, onRemove }: { professions: Profession[]; onRemove?: (p: Profession) => () => Promise<void> }) {
  if (professions.length === 0) return <p className="text-sm opacity-60">None</p>;
  return (
    <ul className="space-y-1">
      {professions.map((p) => (
        <li key={p.id} className="flex items-center gap-2">
          <Link href={`/campaign/professions/${p.id}`} className="link link-hover font-medium">{p.name}</Link>
          <span className="text-sm opacity-70">{p.description}</span>
          {onRemove && (
            <form action={onRemove(p)}>
              <button className="btn btn-ghost btn-xs">Remove</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function EditProfession({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const profession = getProfession(Number((await params).id));
  if (!profession) notFound();
  const advancements = listAdvancements(profession.id);
  const linked = new Set([profession.id, ...advancements.map((a) => a.id)]);
  const candidates = listProfessions().filter((p) => !linked.has(p.id));

  return (
    <section className="space-y-6 max-w-2xl">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Edit profession</h2>
        <ProfessionFields initial={profession} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Prerequisites</h3>
        <p className="text-xs opacity-60">Professions that advance to this one.</p>
        <ProfessionLinks professions={listPrerequisites(profession.id)} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Advances to</h3>
        {advancements.length > 1 && <p className="text-xs opacity-60">Choose one of:</p>}
        <ProfessionLinks professions={advancements} onRemove={(p) => removeAdvancement.bind(null, profession.id, p.id)} />
        <form key={advancements.length} action={addAdvancement.bind(null, profession.id)} className="flex flex-wrap items-center gap-2 pt-2">
          <select name="to_id" defaultValue="" className="select select-sm">
            <option value="">Link existing profession…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-sm opacity-60">or</span>
          <input name="new_name" placeholder="New profession name" className="input input-sm" />
          <button className="btn btn-primary btn-sm">Add advancement</button>
        </form>
      </div>
    </section>
  );
}
