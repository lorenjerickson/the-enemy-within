import Link from "next/link";
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
      {creatures.length === 0 ? (
        <p className="opacity-70">No creatures yet.</p>
      ) : (
        <ul className="list bg-base-200 rounded-box">
          {creatures.map((c) => (
            <li key={c.id}>
              <Link href={`/campaign/creatures/${c.id}`} className="list-row hover:bg-base-300 rounded-box">
              {c.image ? (
                <img src={c.image} alt="" className="size-12 rounded-box object-cover" />
              ) : (
                <div className="size-12 rounded-box bg-base-300" />
              )}
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm opacity-70">{c.description}</div>
              </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
