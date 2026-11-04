import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { formatGameTime } from "@/lib/calendar";
import { listGameSessions } from "@/lib/db";
import { startSession } from "./actions";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The campaign's sessions, most recent first, and starting a new one. */
export default async function Sessions() {
  await connection();
  await requireGm();
  const sessions = listGameSessions();
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-semibold">Sessions</h2>
        <form action={startSession} className="ml-auto">
          <button className="btn btn-primary btn-sm">Start new session</button>
        </form>
      </div>
      {sessions.length === 0 ? (
        <p className="opacity-70">No sessions yet.</p>
      ) : (
        <ul className="list bg-base-200 rounded-box">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/sessions/${s.id}`} className="list-row hover:bg-base-300 rounded-box" data-session={s.id}>
                <span className="font-medium">Session {s.number}</span>
                <span className="opacity-70">{formatDate(s.started_at)}</span>
                <span className="text-sm opacity-60">began at {formatGameTime(s.game_time)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
