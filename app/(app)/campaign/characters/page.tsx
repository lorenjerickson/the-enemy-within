import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listCharacters } from "@/lib/db";

export default async function Characters() {
  await connection();
  await requireGm();
  const characters = listCharacters();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Characters</h2>
        <Link href="/campaign/characters/new" className="btn btn-primary btn-sm">Add character</Link>
      </div>
      {characters.length === 0 ? (
        <p className="opacity-70">No characters yet.</p>
      ) : (
        <ul className="list bg-base-200 rounded-box">
          {characters.map((c) => (
            <li key={c.id}>
              <Link href={`/campaign/characters/${c.id}`} className="list-row hover:bg-base-300 rounded-box">
                {c.image ? (
                  <img src={c.image} alt="" className="size-12 rounded-box object-cover" />
                ) : (
                  <div className="size-12 rounded-box bg-base-300" />
                )}
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm opacity-70">{c.description}</div>
                </div>
                <div className="text-xs opacity-60 self-center">{c.template_name && `based on ${c.template_name}`}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
