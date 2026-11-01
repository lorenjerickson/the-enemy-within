import { redirect } from "next/navigation";
import { connection } from "next/server";
import db, { getGm, hashPassword } from "@/lib/db";

async function createGm(formData) {
  "use server";
  if (getGm()) redirect("/");
  db.prepare(
    "INSERT INTO users (name, username, contact, password_hash, role) VALUES (?, ?, ?, ?, 'gm')"
  ).run(
    formData.get("name"),
    formData.get("username"),
    formData.get("contact"),
    hashPassword(formData.get("password"))
  );
  redirect("/");
}

export default async function Setup() {
  await connection();
  if (getGm()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={createGm} className="card bg-base-200 w-full max-w-sm">
        <div className="card-body gap-3">
          <h1 className="card-title">Create GM account</h1>
          <input name="name" placeholder="Name" required className="input w-full" />
          <input name="username" placeholder="Username" required className="input w-full" />
          <input name="contact" placeholder="Contact info" className="input w-full" />
          <input name="password" type="password" placeholder="Password" required className="input w-full" />
          <button className="btn btn-primary">Create</button>
        </div>
      </form>
    </main>
  );
}
