// Drops imports a file no longer uses (after scripts/move-exports.mjs).
import fs from "node:fs"; import ts from "typescript";
const F = process.argv[2], text = fs.readFileSync(F, "utf8"), src = ts.createSourceFile(F, text, ts.ScriptTarget.Latest, true);
const isProp = (n) => { const p = n.parent; return p && ((ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === n) || (ts.isQualifiedName(p) && p.right === n)); };
const used = new Set(); const v = (n) => { if (ts.isIdentifier(n) && !isProp(n)) used.add(n.text); ts.forEachChild(n, v); };
for (const s of src.statements) if (!ts.isImportDeclaration(s)) v(s);
let out = text;
for (const s of [...src.statements].reverse()) {
  if (!ts.isImportDeclaration(s) || !s.importClause) continue;
  const c = s.importClause, spec = s.moduleSpecifier.getText();
  const def = c.name && used.has(c.name.text) ? c.name.text : null;
  let named = [];
  if (c.namedBindings && ts.isNamedImports(c.namedBindings)) named = c.namedBindings.elements.filter((e) => used.has(e.name.text)).map((e) => e.getText());
  if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) { if (!used.has(c.namedBindings.name.text)) continue; else continue; }
  const repl = !def && !named.length ? "" : `import ${c.isTypeOnly ? "type " : ""}${[def, named.length ? `{ ${named.join(", ")} }` : null].filter(Boolean).join(", ")} from ${spec};`;
  out = out.slice(0, s.getStart()) + repl + out.slice(s.getEnd());
}
fs.writeFileSync(F, out.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n"));
