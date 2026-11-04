import FilterableList from "@/app/(app)/FilterableList";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { listPlayers } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { invitePlayer } from "../campaign/players/actions";

export default async function Users() {
  await connection();
  const user = await requireUser();
  if (user.role !== "gm") redirect("/");

  return (
    <section className="space-y-3 max-w-xl">
      <h2 className="text-xl font-semibold">Players</h2>
      <FilterableList
        empty="No players yet."
        entries={listPlayers().map((p) => ({ id: p.id, href: `/users/${p.id}`, name: p.name, description: p.contact }))}
      />
      <form action={invitePlayer} className="flex flex-wrap gap-2">
        <input name="name" placeholder="Name" required className="input" />
        <input name="contact" type="email" placeholder="Email" required className="input" />
        <input name="password" placeholder="Temporary password" required className="input" />
        <button className="btn btn-primary">Add player</button>
      </form>
    </section>
  );
}
