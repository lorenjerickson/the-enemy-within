import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { listLocations } from "@/lib/db";

export default async function Locations() {
  await connection();
  await requireGm();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Locations</h2>
        <Link href="/campaign/locations/new" className="btn btn-primary btn-sm">Add location</Link>
      </div>
      <FilterableList
        empty="No locations yet."
        entries={listLocations().map((l) => ({
          id: l.id,
          href: `/campaign/locations/${l.id}`,
          name: l.name,
          description: l.description,
          note: l.path || undefined,
        }))}
      />
    </section>
  );
}
