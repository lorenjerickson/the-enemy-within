"use client";

import { useEffect, useRef, useState } from "react";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, bracketMatching, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { autocompletion, completionStatus, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { linter, lintGutter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { checkScript } from "@/lib/script";
import { formatScript } from "@/lib/scriptFormat";
import { CHAIN, HELPER_NAMES, KEYWORDS, aliasesIn, membersOf, typeOfChain, type ItemKind, type ScriptNames } from "@/lib/scriptSchema";

/** Syntax highlighting: a simple tokenizer for the game script language. */
const scriptLanguage = StreamLanguage.define({
  name: "gamescript",
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(#|\/\/).*/)) return "comment";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    if (stream.match(/^(with|as|if|then|else|and|or|not)\b/i)) return "keyword";
    if (stream.match(/^(true|false|null)\b/i)) return "atom";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      // A name straight after a dot is a property; otherwise a variable (game, a WITH name, a helper).
      const before = stream.string.slice(0, stream.start).trimEnd();
      return before.endsWith(".") ? "propertyName" : "variableName";
    }
    if (stream.match(/^(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||\+\+|--|[-+*/%<>=!?:])/)) return "operator";
    stream.next();
    return null;
  },
});

const colours = HighlightStyle.define([
  { tag: tags.keyword, color: "#c084fc", fontWeight: "600" },
  { tag: tags.string, color: "#86efac" },
  { tag: [tags.number, tags.atom], color: "#fbbf24" },
  { tag: tags.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.operator, color: "#94a3b8" },
  { tag: tags.propertyName, color: "#7dd3fc" },
  { tag: tags.variableName, color: "#e5e7eb" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--color-base-100)", border: "1px solid color-mix(in oklab, var(--color-base-content) 20%, transparent)", borderRadius: "0.5rem", fontSize: "13px" },
    "&.cm-focused": { outline: "2px solid var(--color-primary)", outlineOffset: "1px" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", caretColor: "var(--color-base-content)" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none" },
    ".cm-placeholder": { color: "color-mix(in oklab, var(--color-base-content) 40%, transparent)" },
    ".cm-tooltip-autocomplete": { backgroundColor: "var(--color-base-200)" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--color-error)" },
  },
  { dark: true }
);

/** Real-time syntax checking with the same parser that runs scripts: errors underline their line. */
const syntaxCheck = linter(
  (view) => {
    const error = checkScript(view.state.doc.toString());
    if (!error) return [];
    const m = error.match(/^Line (\d+): (.*)$/);
    const line = view.state.doc.line(Math.min(Math.max(1, Number(m?.[1] ?? 1)), view.state.doc.lines));
    return [{ from: line.from, to: line.to, severity: "error", message: m ? m[2] : error }];
  },
  { delay: 250 }
);

const isIdentifier = (s: string) => /^[A-Za-z_]\w*$/.test(s);

/** Autocomplete from the scripting model (lib/scriptSchema.ts) and the game's real names. */
function completions(names: () => ScriptNames) {
  return (ctx: CompletionContext) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const n = names();
    const aliases = aliasesIn(ctx.state.doc.toString(), n);

    // Inside brackets after a collection: lights['la|  → names, closing the bracket.
    const bracket = before.match(new RegExp(`(${CHAIN})\\s*\\[\\s*(['"])([^'"]*)$`));
    if (bracket) {
      const type = typeOfChain(bracket[1], aliases, n);
      if (!type?.startsWith("coll:")) return null;
      const list = n[type.slice(5) as ItemKind] ?? [];
      const quote = bracket[2];
      return {
        from: ctx.pos - bracket[3].length,
        options: list.map((name): Completion => ({
          label: name,
          type: "constant",
          // Replace any closing quote / bracket the editor already added, so they aren't doubled.
          apply: (view, _c, from, to) => {
            const after = view.state.sliceDoc(to, to + 2);
            const extra = after.startsWith(`${quote}]`) ? 2 : after.startsWith(quote) || after.startsWith("]") ? 1 : 0;
            const insert = `${name}${quote}]`;
            view.dispatch({ changes: { from, to: to + extra, insert }, selection: { anchor: from + insert.length } });
          },
        })),
      };
    }

    // After a dot: the members of whatever's on the left.
    const dot = before.match(new RegExp(`(${CHAIN})\\s*\\.\\s*([A-Za-z_]\\w*)?$`));
    if (dot) {
      const type = typeOfChain(dot[1], aliases, n);
      if (!type) return null;
      const options: Completion[] = membersOf(type, n).map((m) => ({
        label: m.label,
        detail: m.detail,
        type: m.method ? "method" : "property",
        apply: m.method ? `${m.label}(` : m.label,
      }));
      // Names that aren't plain words (e.g. "Light 3") go in brackets instead of after the dot.
      if (type.startsWith("coll:")) {
        for (const name of n[type.slice(5) as ItemKind] ?? []) {
          if (isIdentifier(name)) continue;
          options.push({
            label: `['${name}']`,
            type: "constant",
            apply: (view, _c, from, to) => {
              const dotAt = view.state.sliceDoc(0, from).lastIndexOf(".");
              view.dispatch({ changes: { from: dotAt, to, insert: `['${name}']` } });
            },
          });
        }
      }
      return { from: ctx.pos - (dot[2]?.length ?? 0), options, validFor: /^\w*$/ };
    }

    // A word on its own: game, WITH … AS names, helpers and keywords.
    const word = ctx.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !ctx.explicit) return null;
    const options: Completion[] = [
      { label: "game", type: "variable", detail: "the game state" },
      ...Object.entries(aliases).map(([name, type]) => ({ label: name, type: "variable", detail: `WITH … AS (${type.replace(/^coll:/, "list of ")})` })),
      ...HELPER_NAMES.map((h) => ({ label: h.label, type: "function", detail: h.detail, apply: `${h.label}(` })),
      ...KEYWORDS.map((k) => ({ label: k, type: "keyword" })),
    ];
    return { from: word ? word.from : ctx.pos, options, validFor: /^\w*$/ };
  };
}

/**
 * The editor for game scripts: highlighting, real-time syntax checking, autocomplete from the game model,
 * and Format (also Shift+Alt+F). With `name` it submits its text as that form field.
 */
export default function ScriptEditor({
  name,
  defaultValue = "",
  onChange,
  onSubmit,
  names = {},
  placeholder = "",
  label = "Script",
  minLines = 3,
}: {
  name?: string;
  defaultValue?: string;
  onChange?: (source: string) => void;
  onSubmit?: () => void; // Cmd/Ctrl+Enter
  names?: ScriptNames;
  placeholder?: string;
  label?: string;
  minLines?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [source, setSource] = useState(defaultValue);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  // Kept in refs so the editor (created once) always sees the latest props.
  const latest = useRef({ names, onChange, onSubmit });
  latest.current = { names, onChange, onSubmit };

  const format = () => {
    const v = view.current;
    if (!v) return;
    const text = formatScript(v.state.doc.toString());
    if (text !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
  };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: defaultValue,
        extensions: [
          history(),
          indentUnit.of("   "),
          EditorState.tabSize.of(3),
          scriptLanguage,
          syntaxHighlighting(colours),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [completions(() => latest.current.names)], activateOnTyping: true }),
          syntaxCheck,
          lintGutter(),
          placeholderText(placeholder),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.theme({ ".cm-content, .cm-gutter": { minHeight: `${minLines * 1.45}em` } }),
          // Escape closes suggestions first, then the expanded editor.
          Prec.highest(
            keymap.of([{ key: "Escape", run: (v) => (expandedRef.current && !completionStatus(v.state) ? (setExpanded(false), true) : false) }])
          ),
          keymap.of([
            { key: "Mod-Enter", run: () => (latest.current.onSubmit?.(), true) },
            { key: "Shift-Alt-f", run: () => (format(), true) },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const text = u.state.doc.toString();
            setSource(text);
            latest.current.onChange?.(text);
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Created once; later defaultValue changes are handled by remounting (key) where needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={expanded ? "fixed inset-0 z-50 flex flex-col gap-2 bg-base-300/95 p-4 md:p-8" : "space-y-1"}
      data-script-editor={label}
      onClick={expanded ? (e) => e.target === e.currentTarget && setExpanded(false) : undefined}
    >
      {expanded && <div className="text-sm font-semibold">{label}</div>}
      {/* Drag the bottom-right corner to resize; Expand fills the window. */}
      <div ref={host} className={expanded ? "min-h-0 flex-1" : "resize-y overflow-auto"} />
      <div className="flex items-center gap-2 text-xs">
        <span className="opacity-60">Ctrl+Space suggests · Shift+Alt+F formats{expanded && " · Esc closes"}</span>
        <button type="button" className="btn btn-ghost btn-xs ml-auto opacity-60 hover:opacity-100" onClick={format}>Format</button>
        <button type="button" className="btn btn-ghost btn-xs opacity-60 hover:opacity-100" onClick={() => (setExpanded(!expanded), requestAnimationFrame(() => view.current?.focus()))}>
          {expanded ? "Done" : "Expand"}
        </button>
      </div>
      {name && <input type="hidden" name={name} value={source} />}
    </div>
  );
}
