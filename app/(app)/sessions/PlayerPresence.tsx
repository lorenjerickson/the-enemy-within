import { listPlayerCharacters, listPlayers, listPresentPlayers } from "@/lib/db";

/** Every player, with the characters they play, marked present or not yet here. */
export default function PlayerPresence({ sessionId }: { sessionId: number }) {
  const present = new Set(listPresentPlayers(sessionId));
  const players = listPlayers();
  if (!players.length) return <p className="text-sm opacity-70">No players yet (Campaign › Players).</p>;
  return (
    <ul className="list bg-base-200 rounded-box">
      {players.map((p) => {
        const plays = listPlayerCharacters(p.id).map((c) => c.name);
        const here = present.has(p.id);
        return (
          <li key={p.id} className="list-row items-center" data-player={p.name} data-present={here}>
            <span className={`size-2.5 rounded-full ${here ? "bg-success" : "bg-base-content/20"}`} />
            <span className="font-medium">{p.name}</span>
            <span className="text-sm opacity-60">{plays.length ? plays.join(", ") : "no character yet"}</span>
            <span className={`badge badge-sm ${here ? "badge-success" : "badge-ghost"}`}>{here ? "here" : "not here yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}
