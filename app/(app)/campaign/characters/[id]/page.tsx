import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { characterPlayers, getCharacter, getCharacterPlayer, isInParty, listCharacterProfessionIds, listPlayers } from "@/lib/db";
import DeleteCharacter from "../DeleteCharacter";
import CreatureForm from "../../creatures/new/CreatureForm";
import { setCharacterHealth, submitCharacter } from "../actions";
import { characterHealth } from "@/lib/health";
import HealthFields from "../../../HealthFields";
import { equippableItems, professionNodes } from "../formOptions";
import ProfessionsInput from "../ProfessionsInput";
import InPartyInput from "../InPartyInput";
import Journal from "../../../character/Journal";

export default async function EditCharacter({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const character = getCharacter(Number((await params).id));
  if (!character) notFound();

  const player = characterPlayers().get(character.id) ?? null;
  const health = characterHealth(character.id)!;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3" data-played-by>
        <span className={`badge ${player ? "badge-success" : "badge-ghost"}`}>{player ? `played by ${player}` : "no player"}</span>
        <span className="text-xs opacity-60">character #{character.id}</span>
        <span className="ml-auto"><DeleteCharacter id={character.id} name={character.name} player={player} /></span>
      </div>
      <form action={setCharacterHealth.bind(null, character.id)} className="flex flex-wrap items-end gap-2 rounded-box bg-base-200 p-3 text-sm" data-character-health>
        <span className="mr-2 self-center font-semibold">Health</span>
        <HealthFields health={health} />
        <button className="btn btn-sm">Save health</button>
        <button name="restore" value="1" className="btn btn-sm btn-success btn-outline" title="Current back to maximum">Restore to maximum</button>
      </form>
      <CreatureForm
        items={equippableItems()}
        initial={character}
        action={submitCharacter.bind(null, character.id, null)}
        title={`Edit character${character.template_name ? ` (based on ${character.template_name})` : ""}`}
        submitLabel="Save character"
        extra={
          <>
            <InPartyInput initial={isInParty(character.id)} players={listPlayers()} player={getCharacterPlayer(character.id)} />
            <ProfessionsInput professions={professionNodes()} initial={listCharacterProfessionIds(character.id)} />
          </>
        }
      />
      <div className="max-w-3xl">
        <Journal characterId={character.id} name={character.name} />
      </div>
    </div>
  );
}
