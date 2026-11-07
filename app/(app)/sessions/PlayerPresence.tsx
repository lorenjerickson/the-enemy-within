import { listPlayerCharacters, listPlayers, listPresentPlayers, sessionMembers } from "@/lib/db";
import { playAs, setMember } from "./actions";

/**
 * Every player, with the characters they play: here, not here yet, played by the GM (added while absent), or left out.
 * With `manage` (the GM), each has buttons to add them for the GM to play, leave them out, or undo that.
 */
export default function PlayerPresence({ sessionId, manage = false }: { sessionId: number; manage?: boolean }) {
  const present = new Set(listPresentPlayers(sessionId));
  const members = new Map(sessionMembers(sessionId).map((m) => [m.user_id, m.status]));
  const players = listPlayers();
  if (!players.length) return <p className="text-sm opacity-70">No players yet (Campaign › Players).</p>;
  return (
    <ul className="list bg-base-200 rounded-box">
      {players.map((p) => {
        const plays = listPlayerCharacters(p.id).map((c) => c.name);
        const status = members.get(p.id);
        const here = present.has(p.id);
        const state = status === "removed" ? "left out" : status === "gm" ? (here ? "here (GM was playing)" : "GM plays") : here ? "here" : "not here yet";
        const set = (s: "gm" | "removed" | null) => setMember.bind(null, sessionId, p.id, s);
        return (
          <li key={p.id} className="list-row items-center" data-player={p.name} data-present={here} data-member={status ?? ""}>
            <span className={`size-2.5 rounded-full ${status === "removed" ? "bg-error/60" : here ? "bg-success" : status === "gm" ? "bg-info" : "bg-base-content/20"}`} />
            <span className="font-medium">{p.name}</span>
            <span className="text-sm opacity-60">{plays.length ? plays.join(", ") : here ? "creating a character" : "no character yet"}</span>
            <span className={`badge badge-sm ${status === "removed" ? "badge-error" : here ? "badge-success" : status === "gm" ? "badge-info" : "badge-ghost"}`}>{state}</span>
            {manage && (
              <span className="flex gap-1">
                {status === "removed" ? (
                  <form action={set(null)}><button className="btn btn-xs">Let in</button></form>
                ) : (
                  <>
                    {!here && status !== "gm" && plays.length > 0 && <form action={set("gm")}><button className="btn btn-xs" title="They're away: you play their character">Add (GM plays)</button></form>}
                    {status === "gm" && <form action={playAs.bind(null, p.id)}><button className="btn btn-xs btn-info">Play as</button></form>}
                    <form action={set("removed")}><button className="btn btn-xs btn-ghost" title="Keep them out of this session">Remove</button></form>
                  </>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
