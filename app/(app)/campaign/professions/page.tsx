import Link from "next/link";
import FilterableList from "@/app/(app)/FilterableList";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listProfessionGroups, listRanks, startingRanks } from "@/lib/db";

/** Professions (Law Enforcement, Military…); their ranks are on each one's page. */
export default async function Professions() {
  await connection();
  await requireGm();
  const groups = listProfessionGroups();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Professions</h2>
        <Link href="/campaign/professions/new" className="btn btn-primary btn-sm">Add profession</Link>
      </div>
      <FilterableList empty="No professions yet." entries={groups.map((g) => {
        const ranks = listRanks(g.id).length, first = startingRanks(g.id).map((r) => r.name).join(" or ");
        return { id: g.id, href: `/campaign/professions/${g.id}`, name: g.name, description: g.description, note: `${first ? `starts as ${first} · ` : ""}${ranks} rank${ranks === 1 ? "" : "s"}` };
      })} />
    </section>
  );
}
