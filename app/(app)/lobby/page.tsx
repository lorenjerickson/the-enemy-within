import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOpenGameSession, isRemovedFrom, listPlayerCharacters, markPresent } from "@/lib/db";
import AutoRefresh from "../AutoRefresh";
import PlayerPresence from "../sessions/PlayerPresence";
import { checkIn } from "./actions";

/** A player waiting for the session to begin: they're present while this page is open. */
export default async function Lobby() {
  await connection();
  const user = await requireUser();
  if (user.role === "gm") redirect("/sessions");
  const session = getOpenGameSession();
  // Joining without a character: make one first.
  if (session && !listPlayerCharacters(user.id).length) redirect("/character/new");
  if (session?.began_at && !isRemovedFrom(session.id, user.id)) redirect("/play"); // the session is played full screen
  if (session && !user.playedBy) markPresent(session.id, user.id);
  return (
    <div className="max-w-xl space-y-4">
      <AutoRefresh checkIn={checkIn} />
      {!session ? (
        <p className="opacity-70">There&apos;s no session right now.</p>
      ) : (
        <>
          <h2 className="text-xl font-semibold">Session {session.number}</h2>
          {isRemovedFrom(session.id, user.id) ? <p className="opacity-80" data-left-out>The GM has left you out of this session.</p> : <p className="opacity-80">Waiting for everyone to join. The GM will begin the session.</p>}
          <PlayerPresence sessionId={session.id} />
        </>
      )}
    </div>
  );
}

