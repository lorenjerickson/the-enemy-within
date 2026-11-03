import Link from "next/link";
import { connection } from "next/server";
import FilterableList from "@/app/(app)/FilterableList";
import { requireGm } from "@/lib/auth";
import { listDiscoveries, listObjectiveCharacters, listObjectives } from "@/lib/story";

const TABS = [
  { id: "discoveries", label: "Discoveries" },
  { id: "objectives", label: "Objectives" },
] as const;

/** The story: discoveries the party can make and objectives it can be given. */
export default async function Story({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await connection();
  await requireGm();
  const { tab: tabParam } = await searchParams;
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? "discoveries";

  return (
    <section className="space-y-4 max-w-3xl">
      <div className="flex items-end gap-6 border-b border-base-300">
        <h2 className="text-xl font-semibold pb-2">Story</h2>
        <div role="tablist" className="tabs tabs-border">
          {TABS.map((t) => (
            <Link key={t.id} role="tab" href={`/campaign/story?tab=${t.id}`} className={`tab ${tab === t.id ? "tab-active" : ""}`}>
              {t.label}
            </Link>
          ))}
        </div>
        <Link href={`/campaign/story/${tab}/new`} className="btn btn-primary btn-sm ml-auto mb-2">
          {tab === "discoveries" ? "Add discovery" : "Add objective"}
        </Link>
      </div>
      {tab === "discoveries" ? (
        <FilterableList
          empty="No discoveries yet."
          entries={listDiscoveries().map((d) => ({
            id: d.id,
            href: `/campaign/story/discoveries/${d.id}`,
            name: d.title,
            description: d.text,
            type: d.kind,
            note: [d.owner_name, d.found ? "found" : null].filter(Boolean).join(" · ") || undefined,
          }))}
        />
      ) : (
        <FilterableList
          empty="No objectives yet."
          entries={listObjectives().map((o) => ({
            id: o.id,
            href: `/campaign/story/objectives/${o.id}`,
            name: o.title,
            description: o.description,
            type: o.status,
            note: [listObjectiveCharacters(o.id).length ? "some characters" : "whole party", o.revealed ? "known to the party" : "hidden"].join(" · "),
          }))}
        />
      )}
    </section>
  );
}
