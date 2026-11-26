// Client-safe: the catalog effects an action editor offers, and how typing finds one.
export type EffectOption = { id: number; name: string; about: string; description?: string; unavailable?: string };

/** Whether an effect matches what was typed: its name, what it does ("can't move"), or the GM's description of it. */
export const effectMatches = (o: EffectOption, q: string) => !q || [o.name, o.about, o.description ?? ""].some((t) => t.toLowerCase().includes(q));
