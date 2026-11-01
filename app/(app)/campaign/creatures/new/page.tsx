import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import CreatureForm from "./CreatureForm";

export default async function NewCreature() {
  await connection();
  await requireGm();
  return <CreatureForm />;
}
