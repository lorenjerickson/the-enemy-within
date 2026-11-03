import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getCreature, listCreatures } from "@/lib/db";
import CreatureForm from "../../creatures/new/CreatureForm";
import { submitCharacter } from "../actions";
import { equippableItems, professionNodes } from "../formOptions";
import ProfessionsInput from "../ProfessionsInput";
import InPartyInput from "../InPartyInput";

/** Step 1: pick a creature template. Step 2 (?template=id): the creature form, preloaded from it. */
export default async function NewCharacter({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  await connection();
  await requireGm();
  const template = getCreature(Number((await searchParams).template));

  if (!template) {
    const creatures = listCreatures();
    return (
      <section className="space-y-4 max-w-2xl">
        <h2 className="text-xl font-semibold">New character: choose a creature template</h2>
        {creatures.length === 0 && <p className="opacity-70">Define a creature first.</p>}
        <ul className="list bg-base-200 rounded-box">
          {creatures.map((c) => (
            <li key={c.id}>
              <Link href={`/campaign/characters/new?template=${c.id}`} className="list-row hover:bg-base-300 rounded-box">
                {c.image ? <img src={c.image} alt="" className="size-12 rounded-box object-cover" /> : <div className="size-12 rounded-box bg-base-300" />}
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm opacity-70">{c.description}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const { id, ...data } = template;
  return (
    <CreatureForm
      key={id}
      items={equippableItems()}
      initial={{ ...data, name: "" }}
      action={submitCharacter.bind(null, null, id)}
      title={`New character (based on ${template.name})`}
      submitLabel="Save character"
      extra={
        <>
          <InPartyInput />
          <ProfessionsInput professions={professionNodes()} />
        </>
      }
    />
  );
}
