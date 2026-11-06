import Link from "next/link";
import FilterableList from "@/app/(app)/FilterableList";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { characterPlayers, listCharacters } from "@/lib/db";

export default async function Characters() {
  await connection();
  await requireGm();
  const characters = listCharacters();
  const players = characterPlayers();

  return (
    <section className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Characters</h2>
        <Link href="/campaign/characters/new" className="btn btn-primary btn-sm">Add character</Link>
      </div>
      <FilterableList empty="No characters yet." entries={characters.map((c) => ({ id: c.id, href: `/campaign/characters/${c.id}`, name: c.name, description: c.description, image: c.image, type: c.type, note: [players.has(c.id) ? `played by ${players.get(c.id)}` : "no player", c.template_name ? `based on ${c.template_name}` : ""].filter(Boolean).join(" · ") }))} />
    </section>
  );
}
