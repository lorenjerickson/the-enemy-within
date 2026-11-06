import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listItems } from "@/lib/db";
import CreatureForm from "./CreatureForm";

export default async function NewCreature() {
  await connection();
  await requireGm();
  const items = listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots, defense, hands }) => ({ id, name, slots, defense, hands }));
  return <CreatureForm items={items} />;
}
