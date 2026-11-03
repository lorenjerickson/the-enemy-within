import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getObjective } from "@/lib/story";
import ObjectiveForm from "../../ObjectiveForm";

export default async function EditObjective({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const objective = getObjective(Number((await params).id));
  if (!objective) notFound();
  return <ObjectiveForm initial={objective} />;
}
