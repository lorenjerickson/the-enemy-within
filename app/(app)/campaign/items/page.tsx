import Link from "next/link";
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
      {items.length === 0 ? (
        <p className="opacity-70">No items yet.</p>
      ) : (
        <ul className="list bg-base-200 rounded-box">
          {items.map((item) => (
            <li key={item.id} className="list-row">
              {item.image ? (
                <img src={item.image} alt="" className="size-12 rounded-box object-cover" />
              ) : (
                <div className="size-12 rounded-box bg-base-300" />
              )}
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-sm opacity-70">{item.description}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
