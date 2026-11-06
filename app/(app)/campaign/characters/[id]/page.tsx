import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { characterPlayers, getCharacter, getCharacterPlayer, isInParty, listCharacterProfessionIds, listPlayers } from "@/lib/db";
import DeleteCharacter from "../DeleteCharacter";
import CreatureForm from "../../creatures/new/CreatureForm";
import { submitCharacter } from "../actions";
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
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3" data-played-by>
        <span className={`badge ${player ? "badge-success" : "badge-ghost"}`}>{player ? `played by ${player}` : "no player"}</span>
        <span className="text-xs opacity-60">character #{character.id}</span>
        <span className="ml-auto"><DeleteCharacter id={character.id} name={character.name} player={player} /></span>
      </div>
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
