import { effectText, CONDITION_SENTENCE, lifecycleSentences, render } from "@/lib/effectGrammar";
import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { listEffectDefs } from "@/lib/db";

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
      <p className="text-sm opacity-70">What changes a creature (Poisoned, Mesmerized, Fire resistance): its rules, and how long it lasts. Actions and the GM put them on for a number of rounds; items give them while equipped; creatures have them always.</p>
      <FilterableList empty="No effects yet." entries={effects.map((e) => ({ id: e.id, href: `/campaign/effects/${e.id}`, name: e.name, description: effectText(e) || e.description, type: e.builtin ? "built-in" : "custom", note: lifecycleSentences(e).map((f) => render(f, CONDITION_SENTENCE)).join(" ") }))} />
    </section>
  );
}
