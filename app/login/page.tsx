import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getGm } from "@/lib/db";
import { currentUser, login } from "@/lib/auth";
import Logo from "@/app/Logo";

async function doLogin(formData: FormData) {
  "use server";
  const ok = await login(String(formData.get("username") ?? ""), String(formData.get("password") ?? ""));
  redirect(ok ? "/" : "/login?error=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  if (!getGm()) redirect("/setup");
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <Logo variant="square" width={384} className="w-full h-auto" priority />
        <form action={doLogin} className="card bg-base-200 w-full">
          <div className="card-body gap-3">
            <h1 className="card-title">Log in</h1>
            {error && <div className="alert alert-error">Invalid username or password.</div>}
            <input name="username" placeholder="Username" required className="input w-full" />
            <input name="password" type="password" placeholder="Password" required className="input w-full" />
            <button className="btn btn-primary">Log in</button>
          </div>
        </form>
      </div>
    </main>
  );
}
