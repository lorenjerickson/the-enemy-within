import Link from "next/link";
import FilterableList from "@/app/(app)/FilterableList";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listItems } from "@/lib/db";

export default async function Items() {
  await connection();
  await requireGm();
  const items = listItems();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Items</h2>
        <Link href="/campaign/items/new" className="btn btn-primary btn-sm">Add item</Link>
      </div>
      <FilterableList empty="No items yet." entries={items.map((i) => ({ id: i.id, href: `/campaign/items/${i.id}`, name: i.name, description: i.description, image: i.image, type: i.type, note: i.rarity }))} />
    </section>
  );
}
