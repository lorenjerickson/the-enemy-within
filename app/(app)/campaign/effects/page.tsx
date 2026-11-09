import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { listEffectDefs } from "@/lib/db";
import { describeEffect } from "@/lib/conditions";

export default async function Effects() {
  await connection();
  await requireGm();
  const effects = listEffectDefs();
  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Effects</h2>
        <Link href="/campaign/effects/new" className="btn btn-primary btn-sm">Add effect</Link>
      </div>
      <p className="text-sm opacity-70">Conditions such as Poisoned that actions put on creatures: damage or healing each round, boosts or penalties while they last, and a save that ends them.</p>
      <FilterableList empty="No effects yet." entries={effects.map((e) => ({ id: e.id, href: `/campaign/effects/${e.id}`, name: e.name, description: e.description, note: describeEffect(e) }))} />
    </section>
  );
}
