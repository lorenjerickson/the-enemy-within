import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import ScriptForm from "../ScriptForm";

export default async function NewScript() {
  await connection();
  await requireGm();
  return <ScriptForm />;
}
