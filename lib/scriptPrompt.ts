/** A question a running script puts to the GM, e.g. select(game.locations.current.actors). Shared by server and client. */

/** What a choice is on the map, so it can be highlighted and clicked there (null: only from the list). */
export type PickEntity = "token" | "door" | "light" | "effect";

export interface SelectPrompt {
  kind: "select";
  text: string; // the instructions shown
  entity: PickEntity | null;
  options: { id: number; name: string }[];
}

/** The answers given so far, in the order the script asked: for select(), the chosen ids. */
export type ScriptAnswers = number[][];

/** Answers as sent by a client, checked. */
export function cleanAnswers(v: unknown): ScriptAnswers {
  if (!Array.isArray(v)) return [];
  return v.map((a) => (Array.isArray(a) ? a.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : []));
}
