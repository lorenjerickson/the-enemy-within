import FilterableList from "@/app/(app)/FilterableList";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { connection } from "next/server";
import { createUser, listPlayers } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { sendMail } from "@/lib/mail";

async function addPlayer(formData: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "gm") return;
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const name = field("name");
  const email = field("contact");
  const password = field("password");
  // Players log in with their name as username.
  createUser({ name, username: name, contact: email, role: "player" }, password);

  const h = await headers();
  const base = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = `${base}/login`;
  await sendMail(
    email,
    "You've been invited to The Enemy Within",
    `Hi ${name},\n\nYou've been added to the game.\n\nLog in at: ${url}\nUsername: ${name}\nTemporary password: ${password}\n`
  );
  revalidatePath("/users");
}

export default async function Users() {
  await connection();
  const user = await requireUser();
  if (user.role !== "gm") redirect("/");

  return (
    <section className="space-y-3 max-w-xl">
      <h2 className="text-xl font-semibold">Players</h2>
      <FilterableList
        empty="No players yet."
        entries={listPlayers().map((p) => ({ id: p.id, href: `/users/${p.id}`, name: p.name, description: p.contact }))}
      />
      <form action={addPlayer} className="flex flex-wrap gap-2">
        <input name="name" placeholder="Name" required className="input" />
        <input name="contact" type="email" placeholder="Email" required className="input" />
        <input name="password" placeholder="Temporary password" required className="input" />
        <button className="btn btn-primary">Add player</button>
      </form>
    </section>
  );
}
