import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import ObjectiveForm from "../../ObjectiveForm";

export default async function NewObjective() {
  await connection();
  await requireGm();
  return <ObjectiveForm />;
}
