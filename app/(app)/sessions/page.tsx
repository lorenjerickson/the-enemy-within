import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { formatGameTime } from "@/lib/calendar";
import { listGameSessions } from "@/lib/db";
import { startSession } from "./actions";
import SessionSummary from "./SessionSummary";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The campaign's sessions, most recent first: the running one, and earlier ones expandable to their summaries. */
export default async function Sessions() {
  await connection();
  await requireGm();
  const sessions = listGameSessions();
  const running = sessions.some((s) => !s.ended_at);
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-semibold">Sessions</h2>
        <form action={startSession} className="ml-auto flex items-center gap-2">
          {running && <span className="text-xs opacity-60">ends the running session</span>}
          <button className="btn btn-primary btn-sm">Start new session</button>
        </form>
      </div>
      {sessions.length === 0 ? (
        <p className="opacity-70">No sessions yet.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const heading = (
              <>
                <span className="font-medium">Session {s.number}</span>
                <span className="opacity-70">{formatDate(s.started_at)}</span>
                <span className="ml-auto text-sm opacity-60">began at {formatGameTime(s.game_time)}</span>
              </>
            );
            return (
              <li key={s.id} data-session={s.id} className="rounded-box bg-base-200">
                {s.ended_at ? (
                  <details>
                    <summary className="flex cursor-pointer items-center gap-3 p-4">{heading}</summary>
                    <div className="space-y-3 px-4 pb-4">
                      <SessionSummary summary={s.summary} />
                      <Link href={`/sessions/${s.id}`} className="link text-xs opacity-70">Open session</Link>
                    </div>
                  </details>
                ) : (
                  <Link href={`/sessions/${s.id}`} className="flex items-center gap-3 p-4 hover:bg-base-300 rounded-box">
                    {heading}
                    <span className={`badge badge-sm ${s.began_at ? "badge-success" : "badge-info"}`}>{s.began_at ? "in progress" : "lobby"}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
