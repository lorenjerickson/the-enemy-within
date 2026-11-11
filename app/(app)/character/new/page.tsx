import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { listPlayerCharacters } from "@/lib/db";
import CreatureForm from "../../campaign/creatures/new/CreatureForm";
import { equippableItems, professionOptions } from "../../campaign/characters/formOptions";
import RankInput from "../../campaign/characters/RankInput";
import Heartbeat from "../../Heartbeat";
import { checkIn } from "../../lobby/actions";
import { createPlayerCharacter } from "../actions";
import { findHuman } from "../human";

/** A player creates their character (based on the Human creature), within their own pages. */
export default async function NewPlayerCharacter() {
  await connection();
  const user = await requireUser();
  if (user.role !== "player") redirect("/campaign/characters/new");
  if (listPlayerCharacters(user.id).length) redirect("/lobby");
  const human = findHuman();
  if (!human) {
    return <p className="opacity-70">Your GM hasn&apos;t set up characters yet (there&apos;s no Human creature). Check back soon.</p>;
  }
  const { id: _id, ...data } = human;
  return (
    <>
      <Heartbeat checkIn={checkIn} />
      <p className="mb-4 max-w-2xl opacity-80">Before you join, create your character.</p>
      <CreatureForm
        items={equippableItems()}
        initial={{ ...data, name: "", description: "", image: null, token_overhead: null, token_side: null }}
        action={createPlayerCharacter}
        title="Your character"
        submitLabel="Create character"
        extra={<RankInput professions={professionOptions()} startingOnly />}
      />
    </>
  );
}
