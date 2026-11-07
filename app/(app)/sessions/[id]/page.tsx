import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getGameSession, getGameTime, listTimers, listTriggers } from "@/lib/db";
import { triggerText } from "@/lib/game";
import { scriptNames } from "@/lib/scriptNames";
import { CalendarPanel } from "../CalendarPanel";
import { ScriptConsole } from "../ScriptConsole";
import { TriggersPanel } from "../TriggersPanel";
import { beginSession, endSession } from "../actions";
import AutoRefresh from "../../AutoRefresh";
import PlayerPresence from "../PlayerPresence";
import SessionSummary from "../SessionSummary";

/** One session. The calendar is here until it moves to the GM's control surface. */
export default async function Session({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const session = getGameSession(Number((await params).id));
  if (!session) notFound();
  // The lobby: everyone gathers before the GM begins.
  const lobby = !session.began_at && !session.ended_at;
  // A running session is played full screen.
  if (session.began_at && !session.ended_at) redirect("/play");
  return (
    <div className="flex flex-col gap-4">
      {lobby && <AutoRefresh />}
      <div className="flex items-baseline gap-3">
        <Link href="/sessions" className="link link-hover text-sm opacity-70">
          Sessions
        </Link>
        <span className="opacity-40">/</span>
        <h2 className="text-xl font-semibold">Session {session.number}</h2>
        <span className="text-sm opacity-60">
          {new Date(session.started_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </span>
        {lobby && <span className="badge badge-info badge-sm">lobby</span>}
        {session.ended_at ? (
          <span className="badge badge-ghost badge-sm">ended</span>
        ) : lobby ? (
          <form action={beginSession.bind(null, session.id)} className="ml-auto">
            <button className="btn btn-primary btn-sm">Begin session</button>
          </form>
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
      {lobby && (
        <div className="max-w-xl space-y-2">
          <p className="opacity-80">Waiting for the players to join. They join from their home page. Add anyone who can't make it and you'll play their character (Play as… once the session begins).</p>
          <PlayerPresence sessionId={session.id} manage />
        </div>
      )}
      {!lobby && (
        <>
          <CalendarPanel now={getGameTime()} timers={listTimers()} />
          <TriggersPanel triggers={listTriggers().map((t) => ({ id: t.id, text: triggerText(t), fired: t.fired, error: t.error }))} />
          <ScriptConsole names={scriptNames()} />
        </>
      )}
    </div>
  );
}

