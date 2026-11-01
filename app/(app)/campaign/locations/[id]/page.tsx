import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getLocation } from "@/lib/db";
import LocationForm from "../LocationForm";

export default async function EditLocation({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const location = getLocation(Number((await params).id));
  if (!location) notFound();
  return <LocationForm initial={location} />;
}
