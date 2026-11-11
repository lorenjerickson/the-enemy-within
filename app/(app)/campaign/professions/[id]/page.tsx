import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getProfessionGroup, listRanks, startingRanks } from "@/lib/db";
import { addStartingRank } from "../actions";
import ProfessionFields from "../ProfessionFields";

/** A profession: its name and description, and its starting rank(s), each leading on to the next ranks. */
export default async function EditProfession({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const group = getProfessionGroup(Number((await params).id));
  if (!group) notFound();
  const first = startingRanks(group.id), total = listRanks(group.id).length;

  return (
    <section className="space-y-6 max-w-2xl">
      <Link href="/campaign/professions" className="link link-hover text-sm">← Back to professions</Link>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Edit profession</h2>
        <ProfessionFields initial={group} />
      </div>
      <div className="space-y-2" data-starting-ranks>
        <h3 className="font-semibold">Starting rank{first.length === 1 ? "" : "s"}</h3>
        <p className="text-xs opacity-60">Where a character in this profession usually begins ({total} rank{total === 1 ? "" : "s"} in all). Each rank's page lists the ranks it leads to.</p>
        {first.length === 0 ? <p className="text-sm opacity-60">None yet</p> : (
          <ul className="space-y-1">
            {first.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Link href={`/campaign/professions/ranks/${r.id}`} className="link link-hover font-medium">{r.name}</Link>
                <span className="text-sm opacity-70">{r.description}</span>
              </li>
            ))}
          </ul>
        )}
        <form key={first.length} action={addStartingRank.bind(null, group.id)} className="flex items-center gap-2 pt-2">
          <input name="name" required placeholder="New starting rank" className="input input-sm" />
          <button className="btn btn-primary btn-sm">Add starting rank</button>
        </form>
      </div>
    </section>
  );
}
