import db from "@/lib/db";

/**
 * The GM's library of named scripts (Campaign › Scripts): written once, run by name from any other script with
 * run('name'). Names are unique, case aside.
 */
db.exec(`CREATE TABLE IF NOT EXISTS library_scripts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT ''
)`);

export interface LibraryScript {
  id: number;
  name: string;
  description: string;
  source: string;
}

export const listLibraryScripts = (): LibraryScript[] =>
  db.prepare<[], LibraryScript>("SELECT id, name, description, source FROM library_scripts ORDER BY name COLLATE NOCASE").all();

export const getLibraryScript = (id: number): LibraryScript | undefined =>
  db.prepare<[number], LibraryScript>("SELECT id, name, description, source FROM library_scripts WHERE id = ?").get(id);

/** By name, case aside (what run('…') looks up). */
export const findLibraryScript = (name: string): LibraryScript | undefined =>
  db.prepare<[string], LibraryScript>("SELECT id, name, description, source FROM library_scripts WHERE name = ? COLLATE NOCASE").get(name.trim());

/** Adds (id null) or updates a script; returns its id, or an error to show (a name already taken). */
export function saveLibraryScript(id: number | null, s: Omit<LibraryScript, "id">): { id: number } | { error: string } {
  const name = s.name.trim();
  if (!name) return { error: "Give it a name" };
  const taken = findLibraryScript(name);
  if (taken && taken.id !== id) return { error: `There's already a script called ${taken.name}` };
  if (id === null) {
    const r = db.prepare<[string, string, string]>("INSERT INTO library_scripts (name, description, source) VALUES (?, ?, ?)").run(name, s.description.trim(), s.source);
    return { id: Number(r.lastInsertRowid) };
  }
  db.prepare<[string, string, string, number]>("UPDATE library_scripts SET name = ?, description = ?, source = ? WHERE id = ?").run(name, s.description.trim(), s.source, id);
  return { id };
}

export const deleteLibraryScript = (id: number): void => void db.prepare<[number]>("DELETE FROM library_scripts WHERE id = ?").run(id);
