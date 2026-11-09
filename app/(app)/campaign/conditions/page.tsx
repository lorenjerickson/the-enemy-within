import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { getCondition, listConditionDefs } from "@/lib/db";
import { describeCondition } from "@/lib/conditions";

export default async function Conditions() {
  await connection();
  await requireGm();
  const conditions = listConditionDefs().flatMap((d) => getCondition(d.id) ?? []);
  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Conditions</h2>
        <Link href="/campaign/conditions/new" className="btn btn-primary btn-sm">Add condition</Link>
      </div>
      <p className="text-sm opacity-70">What actions put on creatures (Poisoned, Mesmerized): the effects they apply, how long they last and the save that ends them.</p>
      <FilterableList empty="No conditions yet." entries={conditions.map((c) => ({ id: c.id, href: `/campaign/conditions/${c.id}`, name: c.name, description: c.description, type: c.builtin ? "built-in" : "custom", note: `${c.effects.map((e) => e.name).join(", ") || "no effects"} · ${describeCondition(c)}` }))} />
    </section>
  );
}
