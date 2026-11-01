import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getCreature, listActions, listItems } from "@/lib/db";
import ActionsSection from "../../ActionsSection";
import CreatureForm from "../new/CreatureForm";

export default async function EditCreature({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const creature = getCreature(Number((await params).id));
  if (!creature) notFound();
  const items = listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots }) => ({ id, name, slots }));
  return (
    <div className="space-y-8">
      <CreatureForm items={items} initial={creature} />
      <div className="max-w-2xl">
        <ActionsSection owner={{ creature_id: creature.id }} actions={listActions({ creature_id: creature.id })} />
      </div>
    </div>
  );
}
