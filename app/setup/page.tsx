import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createUser, getGm } from "@/lib/db";
import Logo from "@/app/Logo";

async function createGm(formData: FormData) {
  "use server";
  if (getGm()) redirect("/");
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  createUser(
    { name: field("name"), username: field("username"), contact: field("contact") || null, role: "gm" },
    field("password")
  );
  redirect("/login");
}

export default async function Setup() {
  await connection();
  if (getGm()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <Logo variant="square" width={384} className="w-full h-auto" priority />
        <form action={createGm} className="card bg-base-200 w-full">
          <div className="card-body gap-3">
            <h1 className="card-title">Create GM account</h1>
            <input name="name" placeholder="Name" required className="input w-full" />
            <input name="username" placeholder="Username" required className="input w-full" />
            <input name="contact" placeholder="Contact info" className="input w-full" />
            <input name="password" type="password" placeholder="Password" required className="input w-full" />
            <button className="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </main>
  );
}
