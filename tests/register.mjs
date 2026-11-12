// Loaded before every test file (see "test" in package.json). Each file runs in its own process with its own empty
// database in a temp folder, and TypeScript imports resolve as Next resolves them ("@/…", no file extensions).
import { register } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tew-test-"));
process.on("exit", () => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

register("./resolve.mjs", import.meta.url);
