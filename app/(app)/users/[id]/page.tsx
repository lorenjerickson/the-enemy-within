import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getPlayer, updatePlayer } from "@/lib/db";

async function savePlayer(id: number, formData: FormData) {
  "use server";
  await requireGm();
  updatePlayer(id, String(formData.get("name") ?? "").trim(), String(formData.get("contact") ?? "").trim());
  redirect("/users");
}

export default async function EditPlayer({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const player = getPlayer(Number((await params).id));
  if (!player) notFound();

  return (
    <form action={savePlayer.bind(null, player.id)} className="space-y-3 max-w-md">
      <h2 className="text-xl font-semibold">Edit player</h2>
      <input name="name" placeholder="Name" required defaultValue={player.name} className="input w-full" />
      <input name="contact" type="email" placeholder="Email" required defaultValue={player.contact ?? ""} className="input w-full" />
      <button className="btn btn-primary">Save player</button>
    </form>
  );
}
