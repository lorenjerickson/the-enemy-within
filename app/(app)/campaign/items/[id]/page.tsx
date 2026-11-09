import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getItem, listActions } from "@/lib/db";
import ActionsSection from "../../ActionsSection";
import StandingEffects from "../../StandingEffects";
import ItemForm from "../new/ItemForm";

export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const item = getItem(Number((await params).id));
  if (!item) notFound();
  return (
    <div className="space-y-8">
      <ItemForm initial={item} />
      <div className="max-w-2xl">
        <ActionsSection owner={{ item_id: item.id }} actions={listActions({ item_id: item.id })} />
      </div>
      <div className="max-w-2xl">
        <StandingEffects owner={{ item_id: item.id }} />
      </div>
    </div>
  );
}
