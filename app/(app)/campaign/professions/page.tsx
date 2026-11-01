import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listProfessions } from "@/lib/db";

export default async function Professions() {
  await connection();
  await requireGm();
  const professions = listProfessions();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Professions</h2>
        <Link href="/campaign/professions/new" className="btn btn-primary btn-sm">Add profession</Link>
      </div>
      {professions.length === 0 ? (
        <p className="opacity-70">No professions yet.</p>
      ) : (
        <ul className="list bg-base-200 rounded-box">
          {professions.map((p) => (
            <li key={p.id}>
              <Link href={`/campaign/professions/${p.id}`} className="list-row hover:bg-base-300 rounded-box">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm opacity-70">{p.description}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
