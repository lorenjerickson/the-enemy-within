/** Questions a running script puts to the GM: select() and ask(). Shared by server and client. */

/** What a choice is on the map, so it can be highlighted and clicked there (null: only from the list). */
export type PickEntity = "token" | "door" | "light" | "effect";

export interface SelectPrompt {
  kind: "select";
  text: string; // the instructions shown
  entity: PickEntity | null;
  options: { id: number; name: string }[];
}

/** ask('Health points', 'number'): a value typed in. */
export type InputType = "number" | "text" | "yes/no";
export interface InputPrompt {
  kind: "input";
  text: string;
  input: InputType;
  initial: number | string | boolean | null;
}

export type ScriptPrompt = SelectPrompt | InputPrompt;

/** One answer: chosen ids for select(), the value for ask(). */
export type ScriptAnswer = number[] | number | string | boolean;
/** The answers given so far, in the order the script asked. */
export type ScriptAnswers = ScriptAnswer[];

/** Answers as sent by a client, checked. */
export function cleanAnswers(v: unknown): ScriptAnswers {
  if (!Array.isArray(v)) return [];
  return v.map((a): ScriptAnswer => {
    if (Array.isArray(a)) return a.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    if (typeof a === "number" && Number.isFinite(a)) return a;
    if (typeof a === "boolean") return a;
    return String(a ?? "").slice(0, 1000);
  });
}
