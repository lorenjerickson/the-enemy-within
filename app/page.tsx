import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { createUser, getGm, listPlayers } from "@/lib/db";
import { requireUser } from "@/lib/auth";

async function addPlayer(formData: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "gm") return;
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  // Players log in with their name as username.
  createUser(
    { name: field("name"), username: field("name"), contact: field("contact") || null, role: "player" },
    field("password")
  );
  revalidatePath("/");
}

export default async function Home() {
  await connection();
  if (!getGm()) redirect("/setup");
  const user = await requireUser();

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">The Enemy Within</h1>
        <p className="mt-1">Logged in as {user.name} ({user.role})</p>
      </div>

      {user.role === "gm" && (
        <section className="space-y-3 max-w-xl">
          <h2 className="text-xl font-semibold">Players</h2>
          <ul className="list bg-base-200 rounded-box">
            {listPlayers().map((p) => (
              <li key={p.id} className="list-row">
                <span className="font-medium">{p.name}</span>
                <span className="opacity-70">{p.contact}</span>
              </li>
            ))}
          </ul>
          <form action={addPlayer} className="flex flex-wrap gap-2">
            <input name="name" placeholder="Name" required className="input" />
            <input name="contact" placeholder="Contact info" className="input" />
            <input name="password" placeholder="Temporary password" required className="input" />
            <button className="btn btn-primary">Add player</button>
          </form>
        </section>
      )}
    </main>
  );
}
