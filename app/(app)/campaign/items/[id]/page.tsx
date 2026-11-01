import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getItem } from "@/lib/db";
import ItemForm from "../new/ItemForm";

export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const item = getItem(Number((await params).id));
  if (!item) notFound();
  return <ItemForm initial={item} />;
}
