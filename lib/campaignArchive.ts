/**
 * Moving a campaign to another server: everything except session data (game nights, their log, logins, pings, roll
 * requests, round plans and encounters) goes into one .zip: campaign.json (every other table's rows) and the
 * uploaded media (images/). Importing it replaces the server's campaign with the archive's.
 */
import fs from "node:fs";
import path from "node:path";
import { Unzip, UnzipInflate, zipSync, strToU8 } from "fflate";
import { db } from "@/lib/db";
import { IMAGE_DIR } from "@/lib/images";

export const ARCHIVE_FORMAT = "the-enemy-within/campaign/1";

/** Tables left out: what happens at the table (and logins), not the campaign. */
const SESSION_TABLES = new Set([
  "game_sessions", "session_presence", "session_events", "sessions", // game nights, their log, logins
  "pings", "roll_requests", "round_plans", "encounters", "map_fx", "token_statuses", "gm_view", // in play
]);

const campaignTables = () =>
  db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((t) => t.name)
    .filter((t) => !SESSION_TABLES.has(t));

interface CampaignJson {
  format: string;
  exported: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** The whole campaign as a .zip. */
export function exportCampaign(): Uint8Array {
  const tables = Object.fromEntries(campaignTables().map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]]));
  const json: CampaignJson = { format: ARCHIVE_FORMAT, exported: new Date().toISOString(), tables };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { "campaign.json": strToU8(JSON.stringify(json)) };
  // Media is stored as-is (images and audio are compressed already).
  if (fs.existsSync(IMAGE_DIR)) for (const f of fs.readdirSync(IMAGE_DIR)) files[`images/${f}`] = [fs.readFileSync(path.join(IMAGE_DIR, f)), { level: 0 }];
  return zipSync(files);
}

/**
 * Replaces this server's campaign with an archive's, read from a .zip file on disk a piece at a time (so a large
 * export doesn't have to fit in memory): media files are written as they come, then every campaign table is emptied
 * and refilled from campaign.json (columns this server doesn't have are skipped, ones the archive lacks take their
 * defaults), and everyone is logged out (the user accounts were replaced too). Returns what was imported.
 */
export async function importCampaignFile(zipPath: string): Promise<{ tables: number; rows: number; files: number }> {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const jsonParts: Uint8Array[] = [];
  let files = 0;
  let failed: Error | null = null;
  const unzip = new Unzip((entry) => {
    const name = entry.name;
    if (name === "campaign.json") {
      entry.ondata = (err, data) => (err ? (failed = err) : jsonParts.push(data));
    } else if (name.startsWith("images/") && !name.endsWith("/")) {
      const fd = fs.openSync(path.join(IMAGE_DIR, path.basename(name)), "w");
      entry.ondata = (err, data, final) => {
        if (err) failed = err;
        else fs.writeSync(fd, data);
        if (final || err) {
          fs.closeSync(fd);
          if (!err) files++;
        }
      };
    } else return;
    entry.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of fs.createReadStream(zipPath, { highWaterMark: 1 << 20 })) unzip.push(chunk as Uint8Array);
  unzip.push(new Uint8Array(0), true);
  if (failed) throw failed;
  if (!jsonParts.length) throw new Error("Not a campaign export: campaign.json is missing");
  const json = JSON.parse(Buffer.concat(jsonParts).toString("utf8")) as CampaignJson;
  return { ...replaceTables(json), files };
}

/** Empties every campaign table and refills it from an export (and logs everyone out). */
function replaceTables(json: CampaignJson): { tables: number; rows: number } {
  if (json.format !== ARCHIVE_FORMAT) throw new Error(`Unknown export format "${json.format}"`);
  const here = new Set(campaignTables());
  const columnsOf = (t: string) => new Set(db.prepare<[], { name: string }>(`PRAGMA table_info("${t}")`).all().map((c) => c.name));
  let rows = 0, tables = 0;
  db.pragma("foreign_keys = OFF"); // tables are refilled in any order
  try {
    db.transaction(() => {
      for (const t of here) db.prepare(`DELETE FROM "${t}"`).run();
      for (const [t, list] of Object.entries(json.tables)) {
        if (!here.has(t)) continue;
        const cols = columnsOf(t);
        tables++;
        for (const row of list) {
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.length) continue;
          db.prepare(`INSERT INTO "${t}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k] as never));
          rows++;
        }
      }
      db.prepare("DELETE FROM sessions").run(); // logins: the accounts behind them were just replaced
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return { tables, rows };
}
