import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getCreature, listItems } from "@/lib/db";
import CreatureForm from "../new/CreatureForm";

export default async function EditCreature({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const creature = getCreature(Number((await params).id));
  if (!creature) notFound();
  const items = listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots }) => ({ id, name, slots }));
  return <CreatureForm items={items} initial={creature} />;
}
