import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getGameSession, getGameTime, listTimers, listTriggers } from "@/lib/db";
import { triggerText } from "@/lib/game";
import { scriptNames } from "@/lib/scriptNames";
import { CalendarPanel } from "../CalendarPanel";
import { ScriptConsole } from "../ScriptConsole";
import { TriggersPanel } from "../TriggersPanel";
import { endSession } from "../actions";
import SessionSummary from "../SessionSummary";

/** One session. The calendar is here until it moves to the GM's control surface. */
export default async function Session({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const session = getGameSession(Number((await params).id));
  if (!session) notFound();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <Link href="/sessions" className="link link-hover text-sm opacity-70">Sessions</Link>
        <span className="opacity-40">/</span>
        <h2 className="text-xl font-semibold">Session {session.number}</h2>
        <span className="text-sm opacity-60">{new Date(session.started_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
        {session.ended_at ? (
          <span className="badge badge-ghost badge-sm">ended</span>
        ) : (
          <form action={endSession.bind(null, session.id)} className="ml-auto">
            <button className="btn btn-sm">End session</button>
          </form>
        )}
      </div>
      {session.ended_at && (
        <div className="rounded-box bg-base-200 p-4 max-w-3xl space-y-2">
          <h3 className="font-semibold">Summary</h3>
          <SessionSummary summary={session.summary} />
        </div>
      )}
      <CalendarPanel now={getGameTime()} timers={listTimers()} />
      <TriggersPanel triggers={listTriggers().map((t) => ({ id: t.id, text: triggerText(t), fired: t.fired, error: t.error }))} />
      <ScriptConsole names={scriptNames()} />
    </div>
  );
}
