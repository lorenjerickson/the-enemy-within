/** "In the party": a player character, as opposed to an NPC (scripts: game.characters.party). */
export default function InPartyInput({ initial = false }: { initial?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="in_party" defaultChecked={initial} className="checkbox checkbox-sm" />
      In the party (a player character, not an NPC)
    </label>
  );
}
