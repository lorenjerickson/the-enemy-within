import { formatGameTime } from "@/lib/calendar";
import { listJournal } from "@/lib/story";
import NotesForm from "./NotesForm";

/**
 * A character's journal, to go in the player's character sheet (not built yet; for now on the GM's character page): the discoveries revealed to them and the objectives
 * made known to them, as written when they learned them, each with room for the player's notes.
 */
export default function Journal({ characterId, name }: { characterId: number; name: string }) {
  const entries = listJournal(characterId);
  return (
    <section className="space-y-3" aria-label="Journal">
      <h3 className="text-lg font-semibold">Journal</h3>
      {entries.length === 0 ? (
        <p className="text-sm opacity-70">Nothing written yet. Discoveries and objectives appear here as {name} learns of them.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-box bg-base-200 p-4 space-y-2" data-journal-entry={e.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h4 className="font-semibold">{e.title}</h4>
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
