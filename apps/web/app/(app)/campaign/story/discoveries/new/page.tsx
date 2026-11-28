import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import DiscoveryForm from "../../DiscoveryForm";

export default async function NewDiscovery() {
  await connection();
  await requireGm();
  return <DiscoveryForm />;
}
