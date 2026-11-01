import Link from "next/link";
import FilterableList from "@/app/(app)/FilterableList";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listPrerequisites, listProfessions } from "@/lib/db";

const prerequisiteNames = (id: number) =>
  listPrerequisites(id).map((p) => `from ${p.name}`).join(", ");

export default async function Professions() {
  await connection();
  await requireGm();
  const professions = listProfessions();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Professions</h2>
        <Link href="/campaign/professions/new" className="btn btn-primary btn-sm">Add profession</Link>
      </div>
      <FilterableList empty="No professions yet." entries={professions.map((p) => { const from = prerequisiteNames(p.id); return { id: p.id, href: `/campaign/professions/${p.id}`, name: p.name, description: p.description, type: from ? "advancement" : "starting", note: from || undefined }; })} />
    </section>
  );
}
