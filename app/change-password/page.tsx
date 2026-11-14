import { redirect } from "next/navigation";
import { connection } from "next/server";
import { changePassword } from "@/lib/db";
import { loggedInUser } from "@/lib/auth";
import Logo from "@/app/Logo";

async function doChange(formData: FormData) {
  "use server";
  const user = await loggedInUser();
  if (!user) redirect("/login");
  const password = String(formData.get("password") ?? "");
  if (!password || password !== formData.get("confirm")) redirect("/change-password?error=1");
  changePassword(user.id, password);
  redirect("/");
}

export default async function ChangePassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const user = await loggedInUser();
  if (!user) redirect("/login");
  if (!user.must_change_password) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <Logo variant="square" width={384} className="w-full h-auto" priority />
        <form action={doChange} className="card bg-base-200 w-full">
          <div className="card-body gap-3">
            <h1 className="card-title">Choose a new password</h1>
            <p className="text-sm opacity-70">You must replace your temporary password before continuing.</p>
            {error && <div className="alert alert-error">Passwords don&apos;t match.</div>}
            <input name="password" type="password" placeholder="New password" required className="input w-full" />
            <input name="confirm" type="password" placeholder="Confirm new password" required className="input w-full" />
            <button className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </main>
  );
}
