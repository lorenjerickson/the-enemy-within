import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { listLibraryScripts } from "@/lib/scriptLibrary";

export default async function Scripts() {
  await connection();
  await requireGm();
  return (
    <section className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Scripts</h2>
        <Link href="/campaign/scripts/new" className="btn btn-primary btn-sm">Add script</Link>
      </div>
      <p className="text-sm opacity-70">Named scripts written once and run from anywhere else a script goes (map buttons, triggers, objectives, discoveries, the session console) with run(&apos;name&apos;).</p>
      <FilterableList empty="No scripts yet." entries={listLibraryScripts().map((s) => ({ id: s.id, href: `/campaign/scripts/${s.id}`, name: s.name, description: s.description }))} />
    </section>
  );
}
