import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import LocationForm from "../LocationForm";

export default async function NewLocation() {
  await connection();
  await requireGm();
  return <LocationForm />;
}
