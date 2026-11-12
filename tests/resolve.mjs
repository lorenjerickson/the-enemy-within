// Resolve hook: "@/x" → <repo>/x, and extensionless TypeScript imports → .ts / .tsx / index.ts.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const tries = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), root);
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) base = new URL(specifier, context.parentURL);
  if (base) {
    const p = fileURLToPath(base);
    for (const t of tries) {
      if (fs.existsSync(p + t) && fs.statSync(p + t).isFile()) return next(pathToFileURL(p + t).href, context);
    }
  }
  return next(specifier, context);
}
