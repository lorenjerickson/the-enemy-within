import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import ItemForm from "./ItemForm";

export default async function NewItem() {
  await connection();
  await requireGm();
  return <ItemForm />;
}
