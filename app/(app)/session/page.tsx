import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { ScriptConsole } from "./ScriptConsole";
import { CalendarPanel } from "./CalendarPanel";
import { getGameTime, listTimers } from "@/lib/db";

export default async function Session() {
  await connection();
  const user = await requireUser();
  if (user.role !== "gm") redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Session</h2>
      <CalendarPanel now={getGameTime()} timers={listTimers()} />
      <ScriptConsole />
    </div>
  );
}
