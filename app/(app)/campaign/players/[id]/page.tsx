import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getPlayer, listPlayerCharacters } from "@/lib/db";
import { removePlayer, savePlayer } from "../actions";

export default async function EditPlayer({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const player = getPlayer(Number((await params).id));
  if (!player) notFound();
  const plays = listPlayerCharacters(player.id).map((c) => c.name);

  return (
    <div className="space-y-6 max-w-md">
      <form action={savePlayer.bind(null, player.id)} className="space-y-3">
        <h2 className="text-xl font-semibold">Edit player</h2>
        <input name="name" placeholder="Name" required defaultValue={player.name} className="input w-full" />
        <input name="contact" type="email" placeholder="Email" required defaultValue={player.contact ?? ""} className="input w-full" />
        <button className="btn btn-primary">Save player</button>
      </form>
      <form action={removePlayer.bind(null, player.id)} className="space-y-2 border-t border-base-300 pt-4">
        <p className="text-sm opacity-70">
          Removing {player.name} deletes their login.{plays.length > 0 && ` ${plays.join(" and ")} will no longer have a player; their journals are kept.`}
        </p>
        <button className="btn btn-outline btn-error btn-sm">Remove player</button>
      </form>
    </div>
  );
}
