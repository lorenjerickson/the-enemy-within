import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { listPartyMembers, listPlayerCharacters } from "@/lib/db";
import { listJournal } from "@/lib/story";
import { formatGameTime } from "@/lib/calendar";
import NotesForm from "./NotesForm";

/**
 * A character's journal: the discoveries revealed to them and the objectives made known to them, as written
 * when they learned them, each with room for the player's notes. Players see their own characters' journals;
 * the GM sees any party member's.
 */
export default async function Journal({ searchParams }: { searchParams: Promise<{ character?: string }> }) {
  await connection();
  const user = await requireUser();
  const characters = user.role === "gm" ? listPartyMembers() : listPlayerCharacters(user.id);
  const { character } = await searchParams;
  const current = characters.find((c) => c.id === Number(character)) ?? characters[0];

  if (!current) {
    return (
      <section className="max-w-3xl space-y-2">
        <h2 className="text-xl font-semibold">Journal</h2>
        <p className="opacity-70">
          {user.role === "gm" ? "No one is in the party yet." : "You don't have a character yet. Your GM sets who plays each character."}
        </p>
      </section>
    );
  }
  const entries = listJournal(current.id);
  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end gap-4 border-b border-base-300">
        <h2 className="text-xl font-semibold pb-2">Journal</h2>
        {characters.length > 1 && (
          <div role="tablist" className="tabs tabs-border">
            {characters.map((c) => (
              <Link key={c.id} role="tab" href={`/journal?character=${c.id}`} className={`tab ${c.id === current.id ? "tab-active" : ""}`}>
                {c.name}
              </Link>
            ))}
          </div>
        )}
        {characters.length === 1 && <span className="pb-2 opacity-70">{current.name}</span>}
      </div>
      {entries.length === 0 ? (
        <p className="opacity-70">Nothing written yet. Discoveries and objectives appear here as {current.name} learns of them.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-box bg-base-200 p-4 space-y-2" data-journal-entry={e.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-semibold">{e.title}</h3>
                <span className={`badge badge-sm ${e.objective_id !== null ? "badge-primary" : "badge-ghost"}`}>
                  {e.objective_id !== null ? "objective" : "discovery"}
                </span>
                <span className="ml-auto text-xs opacity-60">{formatGameTime(e.created)}</span>
              </div>
              {e.text && <p className="whitespace-pre-line text-sm opacity-80">{e.text}</p>}
              <NotesForm entryId={e.id} initial={e.notes} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
