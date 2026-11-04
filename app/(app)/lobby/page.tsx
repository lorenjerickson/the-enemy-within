import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getLevelPlace, getOpenGameSession, getPlayerTokenLevelId, listLevels, listPlayerCharacters, markPresent } from "@/lib/db";
import LevelMap from "../campaign/locations/[id]/LevelMap";
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
  if (session) markPresent(session.id, user.id);
  return (
    <div className="space-y-4">
      <AutoRefresh checkIn={checkIn} />
      {!session ? (
        <p className="opacity-70">There&apos;s no session right now.</p>
      ) : (
        <>
          <h2 className="text-xl font-semibold">Session {session.number}</h2>
          {session.began_at ? (
            <PlayerMap playerId={user.id} />
          ) : (
            <>
              <p className="opacity-80">Waiting for everyone to join. The GM will begin the session.</p>
              <PlayerPresence sessionId={session.id} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The map a player's character is on; hidden until the GM has placed their token. */
function PlayerMap({ playerId }: { playerId: number }) {
  const levelId = getPlayerTokenLevelId(playerId);
  const place = levelId === undefined ? undefined : getLevelPlace(levelId);
  if (!place) return <p className="opacity-80" data-waiting-placement>The session has begun. The GM is placing you on the map…</p>;
  const levels = listLevels(place.location_id);
  return (
    <div className="space-y-2" data-player-map>
      <div className="text-sm font-semibold">{place.location} › {place.level}</div>
      <LevelMap readOnly locationId={place.location_id} level={levels.find((l) => l.id === levelId)!} levels={levels} />
    </div>
  );
}
