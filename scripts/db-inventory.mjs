// Writes docs/db-inventory.md: every export of lib/db.ts by area, marked storage / pure / mixed? / type (backlog U).
import fs from "node:fs";
import ts from "typescript";
const file = "lib/db.ts", text = fs.readFileSync(file, "utf8");
const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const line = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const sections = [...text.matchAll(/^\/\/ ---------- (.+?) ----------/gm)].map((m) => ({ at: text.slice(0, m.index).split("\n").length, name: m[1] }));
const KEYS = [
  ["Users & logins", /user|login|password|player(?!Token)|role\b/i], ["Sessions", /session|presence|present\b/i],
  ["Tokens", /token|hp\b|health|follow|walk|hidden|assist/i], ["Maps: levels, structures, tiles", /level|structure|tile|door|wall|grid|background|mapImage|figure|perspective|layer|illumination|hideWalls|lock/i],
  ["Locations", /location/i], ["Lights, notes, controls", /light|note|control/i], ["Sounds & media", /sound|ambient|clip|positional|asset|audio|image/i],
  ["Catalog: creatures", /creature/i], ["Catalog: characters", /character|rank|sighting|explored/i], ["Catalog: professions", /profession|advancement/i],
  ["Catalog: items", /item|equip|stack|carried/i], ["Catalog: actions", /action/i], ["Story: discoveries, objectives, journal", /discover|objective|journal|story|secret/i],
  ["Encounters & rounds", /encounter|round|initiative|replay|waiting|plan|pending/i], ["Game time & vars", /game ?time|var|timer|calendar/i],
];
const exportsOf = [];
const topFns = new Map(); // name -> node (functions and const arrows), exported or not
for (const s of src.statements) {
  const exported = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (ts.isFunctionDeclaration(s) && s.name) { topFns.set(s.name.text, s); if (exported) exportsOf.push({ name: s.name.text, kind: "function", node: s }); }
  else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) { if (ts.isIdentifier(d.name)) { topFns.set(d.name.text, d); if (exported) exportsOf.push({ name: d.name.text, kind: d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? "function" : "const", node: d }); } }
  else if (exported && (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s))) exportsOf.push({ name: s.name.text, kind: "type", node: s });
}
const usesDb = new Map(), calls = new Map();
for (const [name, node] of topFns) {
  let db = false; const c = new Set();
  const v = (n) => { if (ts.isIdentifier(n)) { if (n.text === "db" && n !== node.name) db = true; if (topFns.has(n.text) && n.text !== name) c.add(n.text); } ts.forEachChild(n, v); };
  v(node); usesDb.set(name, db); calls.set(name, c);
}
const reachesDb = (n, seen = new Set()) => { if (usesDb.get(n)) return true; if (seen.has(n)) return false; seen.add(n); return [...(calls.get(n) ?? [])].some((m) => reachesDb(m, seen)); };
const rows = exportsOf.map((e) => {
  const at = line(e.node), lines = e.node.getText().split("\n").length;
  const sec = sections.filter((s) => s.at <= at).pop()?.name;
  const area = sec ?? KEYS.find(([, re]) => re.test(e.name))?.[0] ?? "Other";
  const kind = e.kind === "type" ? "type" : e.kind === "const" && !reachesDb(e.name) ? "pure" : !reachesDb(e.name) ? "pure" : usesDb.get(e.name) && lines > 14 ? "mixed?" : usesDb.get(e.name) ? "storage" : "mixed?";
  return { ...e, at, lines, area, cls: kind };
});
const areas = [...new Set(rows.map((r) => r.area))];
const count = (rs, c) => rs.filter((r) => r.cls === c).length;
let out = `# lib/db.ts inventory (backlog U, step 1)\n\nGenerated 2026-11-26 from lib/db.ts (${text.split("\n").length} lines, ${rows.length} exports). Each export is sorted into an area (the file's own section headings where it has them, else by name) and marked:\n\n- **storage**: reads or writes the database, little else: moves as is to \`lib/db/<area>.ts\`.\n- **pure**: no database (directly or through what it calls): moves to a rule module in \`lib/\`.\n- **mixed?**: reaches the database and has logic of its own (or only reaches it through other functions): to split into a pure core and a thin loader, or to confirm as storage, when its area moves.\n- **type**: a type or interface: moves with its area (domain types, later the shared model).\n\n| Area | storage | pure | mixed? | types | total |\n|---|---|---|---|---|---|\n`;
for (const a of areas) { const rs = rows.filter((r) => r.area === a); out += `| ${a} | ${count(rs, "storage")} | ${count(rs, "pure")} | ${count(rs, "mixed?")} | ${count(rs, "type")} | ${rs.length} |\n`; }
out += `| **All** | ${count(rows, "storage")} | ${count(rows, "pure")} | ${count(rows, "mixed?")} | ${count(rows, "type")} | ${rows.length} |\n\n`;
for (const a of areas) {
  out += `## ${a}\n\n`;
  for (const c of ["mixed?", "pure", "storage", "type"]) { const rs = rows.filter((r) => r.area === a && r.cls === c); if (rs.length) out += `- **${c}**: ${rs.map((r) => `\`${r.name}\` (${r.at}${r.lines > 14 ? `, ${r.lines} lines` : ""})`).join(", ")}\n`; }
  out += "\n";
}
fs.writeFileSync("docs/db-inventory.md", out);
console.log(out.split("\n").slice(0, 40).join("\n"));
