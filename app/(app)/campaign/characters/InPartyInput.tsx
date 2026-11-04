/**
 * "In the party": a player character, as opposed to an NPC (scripts: game.characters.party); and the player
 * who plays it, who sees its journal.
 */
export default function InPartyInput({
  initial = false,
  players,
  player = null,
}: {
  initial?: boolean;
  players: { id: number; name: string }[];
  player?: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="in_party" defaultChecked={initial} className="checkbox checkbox-sm" />
        In the party (a player character, not an NPC)
      </label>
      <label className="flex items-center gap-2 text-sm">
        Played by
        <select name="player_id" defaultValue={player ?? ""} className="select select-sm w-48">
          <option value="">Nobody</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
