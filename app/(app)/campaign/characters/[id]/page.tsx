import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getCharacter, isInParty, listCharacterProfessionIds } from "@/lib/db";
import CreatureForm from "../../creatures/new/CreatureForm";
import { submitCharacter } from "../actions";
import { equippableItems, professionNodes } from "../formOptions";
import ProfessionsInput from "../ProfessionsInput";
import InPartyInput from "../InPartyInput";

export default async function EditCharacter({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const character = getCharacter(Number((await params).id));
  if (!character) notFound();

  return (
    <CreatureForm
      items={equippableItems()}
      initial={character}
      action={submitCharacter.bind(null, character.id, null)}
      title={`Edit character${character.template_name ? ` (based on ${character.template_name})` : ""}`}
      submitLabel="Save character"
      extra={
        <>
          <InPartyInput initial={isInParty(character.id)} />
          <ProfessionsInput professions={professionNodes()} initial={listCharacterProfessionIds(character.id)} />
        </>
      }
    />
  );
}
