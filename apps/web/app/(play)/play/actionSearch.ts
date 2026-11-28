/** Search in the planning panels: whether an action (its name, what it is, where it comes from) matches what's typed. */
export const matchesAction = (query: string, ...texts: (string | null | undefined)[]) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};
