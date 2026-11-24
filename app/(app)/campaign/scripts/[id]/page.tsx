import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getLibraryScript } from "@/lib/scriptLibrary";
import ScriptForm from "../ScriptForm";

export default async function EditScript({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const script = getLibraryScript(Number((await params).id));
  if (!script) notFound();
  return <ScriptForm key={JSON.stringify(script)} initial={script} />;
}
