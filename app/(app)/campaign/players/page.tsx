import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listPlayerCharacters, listPlayers } from "@/lib/db";
import FilterableList from "../../FilterableList";
import { invitePlayer } from "./actions";

/** The campaign's players, and inviting new ones (they're emailed their login). */
export default async function Players() {
  await connection();
  await requireGm();
  return (
    <section className="space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">Players</h2>
      <FilterableList
        empty="No players yet."
        entries={listPlayers().map((p) => {
          const plays = listPlayerCharacters(p.id).map((c) => c.name);
          return { id: p.id, href: `/users/${p.id}`, name: p.name, description: p.contact, note: plays.length ? `plays ${plays.join(", ")}` : undefined };
        })}
      />
      <form action={invitePlayer} className="space-y-2">
        <h3 className="font-semibold">Invite a player</h3>
        <div className="flex flex-wrap gap-2">
          <input name="name" placeholder="Name" required className="input" />
          <input name="contact" type="email" placeholder="Email" required className="input" />
          <input name="password" placeholder="Temporary password" required className="input" />
          <button className="btn btn-primary">Invite</button>
        </div>
        <p className="text-xs opacity-60">
          They&apos;re emailed a link to log in, with their name as username and this temporary password, which they change on first login.
          Choose who plays each character on the character&apos;s page.
        </p>
      </form>
    </section>
  );
}
