// Moves top-level declarations out of lib/db.ts into a lib/db/<area>.ts module (backlog U), keeping every caller working:
// lib/db.ts re-exports the module and imports what its own remaining code still uses.
//   node scripts/move-exports.mjs <area> name1 name2 …   (add --dry to only report)
// Private helpers used only by the moved code go along. If the moved code needs something that stays in lib/db.ts,
// it stops and lists it (move that too, or move a lower area first: area modules never import lib/db.ts).
import fs from "node:fs";
import ts from "typescript";

const [area, ...rest] = process.argv.slice(2);
const dry = rest.includes("--dry"), names = new Set(rest.filter((x) => x !== "--dry"));
const FILE = "lib/db.ts", text = fs.readFileSync(FILE, "utf8");
const src = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);

// Top-level declarations: name -> statement (a statement may declare one name; db.exec / addColumn calls have none).
const declOf = new Map(), stmts = src.statements;
const namesOf = (s) => {
  if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) return [s.name.text];
  if (ts.isVariableStatement(s)) return s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
};
for (const s of stmts) for (const n of namesOf(s)) declOf.set(n, s);
const isExported = (s) => ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
// Imported names -> the import declaration text for just that name.
const imported = new Map();
for (const s of stmts) if (ts.isImportDeclaration(s) && s.importClause) {
  const spec = s.moduleSpecifier.text, c = s.importClause;
  if (c.name) imported.set(c.name.text, { spec, line: `import ${c.isTypeOnly ? "type " : ""}${c.name.text} from "${spec}";` });
  if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) imported.set(e.name.text, { spec, type: c.isTypeOnly || e.isTypeOnly, text: e.getText().replace(/^type /, "") });
  if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) imported.set(c.namedBindings.name.text, { spec, line: `import * as ${c.namedBindings.name.text} from "${spec}";` });
}
// Names a declaration refers to (not property names: \`db.transaction\` isn't a reference to \`transaction\`).
const isPropName = (n) => { const p = n.parent; return !!p && ((ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === n) || (ts.isQualifiedName(p) && p.right === n)); };
const refsOf = (node) => { const out = new Set(); const v = (n) => { if (ts.isIdentifier(n) && !isPropName(n)) out.add(n.text); ts.forEachChild(n, v); }; v(node); return out; };

for (const n of names) if (!declOf.has(n)) { console.error(`not a top-level name in lib/db.ts: ${n}`); process.exit(1); }
// Pull in private helpers used only by moved code (repeat until stable).
const moving = new Set([...names].map((n) => declOf.get(n)));
for (let changed = true; changed; ) {
  changed = false;
  for (const s of moving) for (const r of refsOf(s)) {
    const d = declOf.get(r);
    if (!d || moving.has(d) || isExported(d)) continue;
    const usedElsewhere = stmts.some((o) => o !== d && !moving.has(o) && refsOf(o).has(r));
    if (!usedElsewhere) { moving.add(d); changed = true; }
  }
}
const movedNames = new Set([...moving].flatMap(namesOf));
// What the moved code needs: from imports, from connection, or (a problem) still in lib/db.ts.
const needImports = new Map(), blocked = new Set();
for (const s of moving) for (const r of refsOf(s)) {
  if (movedNames.has(r)) continue;
  if (imported.has(r)) needImports.set(r, imported.get(r));
  else if (declOf.has(r)) blocked.add(r);
}
if (blocked.size) { console.error(`moved code uses what stays in lib/db.ts: ${[...blocked].join(", ")}`); process.exit(2); }
const ordered = stmts.filter((s) => moving.has(s));
console.log(`${area}: ${ordered.length} declarations (${[...movedNames].filter((n) => !names.has(n)).length} private helpers along)`);
if (dry) process.exit(0);

// The new module: imports grouped by module, then the moved declarations in their original order (comments kept).
const bySpec = new Map();
for (const [, i] of needImports) { if (!bySpec.has(i.spec)) bySpec.set(i.spec, { lines: new Set(), names: [], types: [] }); const g = bySpec.get(i.spec); if (i.line) g.lines.add(i.line); else (i.type ? g.types : g.names).push(i.text); }
const importLines = [...bySpec].flatMap(([spec, g]) => [...g.lines, ...(g.names.length ? [`import { ${g.names.join(", ")} } from "${spec}";`] : []), ...(g.types.length ? [`import type { ${g.types.join(", ")} } from "${spec}";`] : [])]);
// A moved private declaration that lib/db.ts's remaining code still uses (its migrations, say) is exported for it.
const stillUsed = (() => { let rest = ""; let p = 0; for (const st of stmts.filter((x) => moving.has(x))) { rest += text.slice(p, st.getFullStart()); p = st.getEnd(); } rest += text.slice(p); const sf = ts.createSourceFile(FILE, rest, ts.ScriptTarget.Latest, true); const u = new Set(); const w = (n) => { if (ts.isIdentifier(n) && !isPropName(n)) u.add(n.text); ts.forEachChild(n, w); }; for (const st of sf.statements) if (!ts.isImportDeclaration(st)) w(st); return u; })();
const full = (s) => { const t = text.slice(s.getFullStart(), s.getEnd()).replace(/^\n+/, ""); return !isExported(s) && namesOf(s).some((n) => stillUsed.has(n)) ? t.replace(/^((?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*\n)*\s*)/, "$1export ") : t; };
const outPath = `lib/db/${area}.ts`;
const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
const body = ordered.map(full).join("\n\n");
fs.writeFileSync(outPath, existing ? existing.trimEnd() + "\n\n" + body + "\n" : `${importLines.join("\n")}\n\n${body}\n`);
if (existing && importLines.length) console.log(`(appended: check ${outPath}'s imports cover: ${[...needImports.keys()].join(", ")})`);

// lib/db.ts: cut the moved declarations, re-export the module, import what remaining code uses.
let out = "", pos = 0;
for (const s of ordered) { out += text.slice(pos, s.getFullStart()); pos = s.getEnd(); }
out += text.slice(pos);
const still = ts.createSourceFile(FILE, out, ts.ScriptTarget.Latest, true);
const usedHere = new Set(), v = (n) => { if (ts.isIdentifier(n) && !isPropName(n)) usedHere.add(n.text); ts.forEachChild(n, v); };
for (const s of still.statements) if (!ts.isImportDeclaration(s)) v(s);
const want = [...movedNames].filter((n) => usedHere.has(n));
const marker = `export * from "@/lib/db/${area}";`;
const lines = out.split("\n");
const lastImport = lines.reduce((at, l, i) => (/^import |^export \{ .* \};$|^export \* from /.test(l) ? i : at), 0);
const isType = (n) => { const d = declOf.get(n); return !!d && (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)); };
const add = [...(out.includes(marker) ? [] : [marker]), ...(want.length ? [`import { ${want.map((n) => (isType(n) ? `type ${n}` : n)).join(", ")} } from "@/lib/db/${area}";`] : [])];
lines.splice(lastImport + 1, 0, ...add);
fs.writeFileSync(FILE, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
console.log(`wrote ${outPath}; lib/db.ts re-exports it${want.length ? ` and imports ${want.length} names` : ""}`);
