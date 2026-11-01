import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getBackground, getLocation, listHiddenLayers } from "@/lib/db";
import MapView from "./MapView";
import LocationForm from "../LocationForm";

export default async function EditLocation({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const location = getLocation(Number((await params).id));
  if (!location) notFound();
  return (
    <div className="space-y-8">
      <LocationForm initial={location} />
      <div className="max-w-4xl">
        <MapView locationId={location.id} hidden={listHiddenLayers(location.id)} background={getBackground(location.id)} />
      </div>
    </div>
  );
}
