import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getDiscovery } from "@/lib/story";
import DiscoveryForm from "../../DiscoveryForm";

export default async function EditDiscovery({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const discovery = getDiscovery(Number((await params).id));
  if (!discovery) notFound();
  return <DiscoveryForm initial={discovery} />;
}
