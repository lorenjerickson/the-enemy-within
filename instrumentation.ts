// Runs once when the server starts (Next.js): the database's one-time migrations (older campaigns' data brought up to
// date, built-in effects seeded). The tables themselves are created whenever the database is opened (lib/db/connection.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("@/lib/db/migrations")).runMigrations();
}
