import Link from "next/link";
import FilterableList from "@/app/(app)/FilterableList";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listCreatures } from "@/lib/db";

export default async function Creatures() {
  await connection();
  await requireGm();
  const creatures = listCreatures();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Creatures</h2>
        <Link href="/campaign/creatures/new" className="btn btn-primary btn-sm">Add creature</Link>
      </div>
      <FilterableList empty="No creatures yet." entries={creatures.map((c) => ({ id: c.id, href: `/campaign/creatures/${c.id}`, name: c.name, description: c.description, image: c.image, type: c.type }))} />
    </section>
  );
}
