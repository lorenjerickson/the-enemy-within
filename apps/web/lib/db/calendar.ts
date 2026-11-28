import { db } from "@/lib/db/connection";

// ---------- Calendar ----------

/** Game time in minutes since the campaign began. */
export function getGameTime(): number {
  return db.prepare<[], { now: number }>("SELECT now FROM calendar WHERE id = 1").get()?.now ?? 0;
}

export function setGameTime(minutes: number): void {
  db.prepare<[number]>("UPDATE calendar SET now = ? WHERE id = 1").run(Math.max(0, minutes));
}

export interface Timer {
  name: string;
  started: number; // game time it started, in minutes
  duration: number | null; // minutes until it expires; null = never
}

export function listTimers(): Timer[] {
  return db.prepare<[], Timer>("SELECT name, started, duration FROM timers ORDER BY name").all();
}

/** Replaces all timers (scripts load them all, change them, and save them back). */
export function saveTimers(timers: Timer[]): void {
  db.transaction(() => {
    db.exec("DELETE FROM timers");
    const insert = db.prepare<[string, number, number | null]>("INSERT INTO timers (name, started, duration) VALUES (?, ?, ?)");
    for (const t of timers) insert.run(t.name, t.started, t.duration);
  })();
}
