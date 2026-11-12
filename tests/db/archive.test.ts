import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { character, item } from "./seed";
import { db, getCharacter, listCharacters, listItems } from "@/lib/db";
import { exportCampaign, importCampaignFile } from "@/lib/campaignArchive";
import { IMAGE_DIR } from "@/lib/images";
import { unzipSync, zipSync, strToU8 } from "fflate";

const zipAt = (name: string, bytes: Uint8Array) => {
  const p = path.join(process.env.DATA_DIR!, name);
  fs.writeFileSync(p, bytes);
  return p;
};

test("export then import gives back the same campaign, media included", async () => {
  const id = character("Annis", { attributes: { might: 15 } });
  item({ name: "Lantern" });
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMAGE_DIR, "portrait.png"), "not really a png");
  const zip = zipAt("campaign.zip", exportCampaign());

  // Change everything afterwards, then bring the export back.
  db.prepare("DELETE FROM characters").run();
  item({ name: "Crowbar" });
  fs.rmSync(path.join(IMAGE_DIR, "portrait.png"));
  const r = await importCampaignFile(zip);
  assert.ok(r.tables > 10 && r.rows > 0);
  assert.equal(r.files, 1);
  assert.equal(getCharacter(id)?.attributes.might, 15);
  assert.deepEqual(listItems().map((i) => i.name), ["Lantern"]);
  assert.equal(fs.readFileSync(path.join(IMAGE_DIR, "portrait.png"), "utf8"), "not really a png");
});

test("session data stays out of the export", () => {
  const json = JSON.parse(new TextDecoder().decode(unzipSync(exportCampaign())["campaign.json"]));
  for (const t of ["sessions", "roll_requests", "round_plans", "token_afflictions", "pings"]) assert.ok(!(t in json.tables), t);
  assert.ok("characters" in json.tables);
});

test("an import with extra or missing columns still loads; other formats are refused", async () => {
  const json = JSON.parse(new TextDecoder().decode(unzipSync(exportCampaign())["campaign.json"]));
  json.tables.characters = json.tables.characters.map((c: Record<string, unknown>) => ({ ...c, from_the_future: 1, description: undefined }));
  const ok = zipAt("odd.zip", zipSync({ "campaign.json": strToU8(JSON.stringify(json)) }));
  await importCampaignFile(ok);
  assert.equal(listCharacters().length, json.tables.characters.length);

  const wrong = zipAt("wrong.zip", zipSync({ "campaign.json": strToU8(JSON.stringify({ ...json, format: "someone-else/1" })) }));
  await assert.rejects(importCampaignFile(wrong), /Unknown export format/);
  const empty = zipAt("empty.zip", zipSync({ "readme.txt": strToU8("hi") }));
  await assert.rejects(importCampaignFile(empty), /campaign.json is missing/);
});
