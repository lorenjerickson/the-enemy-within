import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { listConditionDefs, listEffectDefs } from "@/lib/db";
import { describeEffect } from "@/lib/conditions";

export default async function Effects() {
  await connection();
  await requireGm();
  const effects = listEffectDefs(), conditions = listConditionDefs();
  const usedBy = (id: number) => conditions.filter((c) => c.effects.includes(id)).map((c) => c.name);
  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Effects</h2>
        <Link href="/campaign/effects/new" className="btn btn-primary btn-sm">Add effect</Link>
      </div>
      <p className="text-sm opacity-70">Named sets of modifiers (Incapacitated: no actions or reactions). Conditions apply them; one effect can serve several conditions.</p>
      <FilterableList empty="No effects yet." entries={effects.map((e) => ({ id: e.id, href: `/campaign/effects/${e.id}`, name: e.name, description: describeEffect(e) || e.description, type: e.builtin ? "built-in" : "custom", note: usedBy(e.id).length ? `in ${usedBy(e.id).join(", ")}` : "in no condition yet" }))} />
    </section>
  );
}
