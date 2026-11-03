import { TOKEN } from "./script";

/**
 * Auto-format for game scripts: re-indents blocks 3 spaces per level (keeping the structure the original
 * indentation gave them), spaces operators and commas consistently, and writes WITH / AS / IF / THEN / ELSE in
 * capitals and and / or / not / true / false / null in lower case. Comments and strings are kept as written.
 * A line that can't be read is left as it was.
 */
const BLOCK_KEYWORDS = new Set(["with", "as", "if", "then", "else"]);
const LOWER_WORDS = new Set(["and", "or", "not", "true", "false", "null"]);

type Tok = { t: "num" | "str" | "id" | "op"; v: string };

function tokens(code: string): Tok[] | null {
  const re = new RegExp(TOKEN.source, "y");
  const out: Tok[] = [];
  const end = code.trimEnd().length;
  while (re.lastIndex < end) {
    const m = re.exec(code);
    if (!m) return null;
    if (m[1]) out.push({ t: "num", v: m[1] });
    else if (m[2]) out.push({ t: "str", v: m[2] });
    else if (m[3]) out.push({ t: "id", v: m[3] });
    else out.push({ t: "op", v: m[4] });
  }
  return out;
}

/** Splits a line into code and a trailing comment (# or //), ignoring those inside strings. */
function splitComment(line: string): [string, string] {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" || (c === "/" && line[i + 1] === "/")) return [line.slice(0, i), line.slice(i).trim()];
  }
  return [line, ""];
}

/** Keywords that come before a value (WITH, IF, and, not …), unlike names and literals, which are values. */
const isWordOperator = (t: Tok) => t.t === "id" && (BLOCK_KEYWORDS.has(t.v.toLowerCase()) || ["and", "or", "not"].includes(t.v.toLowerCase()));

function formatLine(code: string): string | null {
  const toks = tokens(code);
  if (!toks) return null;
  let out = "";
  let prev: Tok | null = null;
  let prevUnary = false;
  for (const tok of toks) {
    let v = tok.v;
    const word = v.toLowerCase();
    if (tok.t === "id" && BLOCK_KEYWORDS.has(word)) v = word.toUpperCase();
    else if (tok.t === "id" && LOWER_WORDS.has(word)) v = word;
    // Does the previous token end a value? (Then "-" is subtraction and "(" / "[" are a call or an index.)
    const afterValue = !!prev && (prev.t === "op" ? [")", "]", "++", "--"].includes(prev.v) : !isWordOperator(prev));
    const unary = tok.t === "op" && (v === "-" || v === "!") && !afterValue;
    let space = out.length > 0;
    if (prev) {
      if (tok.t === "op" && [".", ")", "]", ","].includes(v)) space = false;
      else if (tok.t === "op" && (v === "(" || v === "[") && afterValue) space = false; // call or index
      else if (tok.t === "op" && (v === "++" || v === "--")) space = false;
      else if (prev.t === "op" && [".", "(", "["].includes(prev.v)) space = false;
      else if (prevUnary) space = false;
    }
    out += (space ? " " : "") + v;
    prevUnary = unary;
    prev = tok;
  }
  return out;
}

export function formatScript(source: string): string {
  const out: string[] = [];
  const indents = [0];
  for (const raw of source.replace(/\t/g, "    ").split("\n")) {
    const [code, comment] = splitComment(raw);
    if (!code.trim()) {
      out.push(comment ? "   ".repeat(indents.length - 1) + comment : "");
      continue;
    }
    const indent = code.length - code.trimStart().length;
    while (indents.length > 1 && indent < indents[indents.length - 1]) indents.pop();
    if (indent > indents[indents.length - 1]) indents.push(indent);
    const formatted = formatLine(code.trim()) ?? code.trim();
    out.push("   ".repeat(indents.length - 1) + formatted + (comment ? "  " + comment : ""));
  }
  return out.join("\n").replace(/\s+$/, "");
}
