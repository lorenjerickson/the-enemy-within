// Coupling report: for each module under lib/ and app/, the modules it imports (runtime and type-only), the modules
// that import it, how many names it exports, and import cycles. Built on the TypeScript compiler (no extra packages).
//   node scripts/coupling.mjs            → a summary (biggest fan-in / fan-out / exports, cycles)
//   node scripts/coupling.mjs --json     → everything, as JSON
// The `graph()` export is used by tests (pure modules mustn't reach the database).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = [".ts", ".tsx"];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.includes(path.extname(e.name)) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const c of [base, ...EXT.map((x) => base + x), ...EXT.map((x) => path.join(base, "index" + x))]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** Every module's imports (runtime and type-only) and export count, keyed by path relative to the repo. */
export function graph(root = ROOT) {
  const files = [...walk(path.join(root, "lib")), ...walk(path.join(root, "app"))];
  const rel = (f) => path.relative(root, f);
  const mods = new Map();
  for (const f of files) {
    const src = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const runtime = new Set(), types = new Set();
    let exports = 0;
    const add = (spec, typeOnly) => { const r = resolve(f, spec); if (r) (typeOnly ? types : runtime).add(rel(r)); };
    for (const s of src.statements) {
      if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
        const c = s.importClause;
        const typeOnly = !!c && (c.isTypeOnly || (!c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
        add(s.moduleSpecifier.text, typeOnly);
      } else if (ts.isExportDeclaration(s)) {
        if (s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) add(s.moduleSpecifier.text, s.isTypeOnly);
        exports += s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements.length : 1;
      } else if (ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exports += ts.isVariableStatement(s) ? s.declarationList.declarations.length : 1;
      }
    }
    // Dynamic imports count as runtime (await import("…")).
    const visit = (n) => { if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) add(n.arguments[0].text, false); ts.forEachChild(n, visit); };
    visit(src);
    for (const r of runtime) types.delete(r);
    mods.set(rel(f), { runtime: [...runtime], types: [...types], exports });
  }
  for (const [name, m] of mods) m.importedBy = [...mods].filter(([, o]) => o.runtime.includes(name) || o.types.includes(name)).map(([n]) => n);
  return mods;
}

/** Every module a module reaches at runtime (following runtime imports only). */
export function reaches(mods, start) {
  const seen = new Set(), todo = [start];
  while (todo.length) { const m = todo.pop(); for (const n of mods.get(m)?.runtime ?? []) if (!seen.has(n)) { seen.add(n); todo.push(n); } }
  return seen;
}

/** Runtime import cycles (strongly connected groups of more than one module). */
export function cycles(mods) {
  let i = 0; const idx = new Map(), low = new Map(), stack = [], on = new Set(), out = [];
  const strong = (v) => {
    idx.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of mods.get(v)?.runtime ?? []) {
      if (!mods.has(w)) continue;
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const g = []; let w; do { w = stack.pop(); on.delete(w); g.push(w); } while (w !== v); if (g.length > 1) out.push(g.sort()); }
  };
  for (const v of mods.keys()) if (!idx.has(v)) strong(v);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const mods = graph(), cyc = cycles(mods);
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ modules: Object.fromEntries(mods), cycles: cyc }, null, 1)); process.exit(0); }
  const top = (key, n = 12) => [...mods].sort((a, b) => key(b[1]) - key(a[1])).slice(0, n).map(([k, m]) => `  ${String(key(m)).padStart(4)}  ${k}`).join("\n");
  const total = [...mods.values()];
  console.log(`Modules: ${mods.size} · runtime imports: ${total.reduce((s, m) => s + m.runtime.length, 0)} · exports: ${total.reduce((s, m) => s + m.exports, 0)} · cycles: ${cyc.length} (${cyc.reduce((s, g) => s + g.length, 0)} modules in them)`);
  console.log(`\nMost exports:\n${top((m) => m.exports)}`);
  console.log(`\nMost imported (fan-in):\n${top((m) => m.importedBy.length)}`);
  console.log(`\nMost imports (fan-out, runtime):\n${top((m) => m.runtime.length)}`);
  const db = "lib/db.ts";
  console.log(`\n${db}: ${mods.get(db)?.exports} exports, imported by ${mods.get(db)?.importedBy.length} modules (${mods.get(db)?.importedBy.filter((n) => n.startsWith("lib/")).length} in lib/)`);
  console.log(`\nCycles:\n${cyc.map((g) => `  ${g.length}: ${g.slice(0, 6).join(", ")}${g.length > 6 ? ", …" : ""}`).join("\n") || "  none"}`);
}
