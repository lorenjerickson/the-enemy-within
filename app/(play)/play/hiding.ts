import { clearHidden, isGridlessLevel, listHidden, listTokens, logSessionEvent, tokenLabels } from "@/lib/db";
import { allegianceOf, relation } from "@/lib/sides";
import { seenFrom } from "@/lib/sight";

/**
 * Hidden tokens (Hide) given away out of encounters. A hidden one who moves into an enemy's view, or has an enemy right
 * next to them, is revealed; so is one who acts on someone. Returns who was revealed (for the walker's message).
 */
export function reveal(levelId: number, tokenId: number, why: string): boolean {
  if (!listHidden(levelId).has(tokenId)) return false;
  clearHidden(tokenId);
  logSessionEvent(`${tokenLabels(levelId).get(tokenId) ?? "Someone"} is no longer hidden (${why}).`);
  return true;
}

const enemiesOf = (levelId: number, tokenId: number) => {
  const tokens = listTokens(levelId), me = tokens.find((t) => t.id === tokenId);
  return { me, enemies: me ? tokens.filter((t) => t.id !== tokenId && relation(allegianceOf(t), allegianceOf(me)) !== "friendly") : [] };
};
const nextTo = (levelId: number, a: { col: number; row: number }, b: { col: number; row: number }) =>
  isGridlessLevel(levelId) ? Math.hypot(a.col - b.col, a.row - b.row) <= 1.05 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= 1;

/** After a token's step: if it's hidden and an enemy sees it (as if it weren't hidden) or is right next to it, it's revealed; and any hidden enemy it has stepped right next to is too. */
export function revealAfterStep(levelId: number, tokenId: number): string[] {
  const told: string[] = [];
  const hidden = listHidden(levelId);
  const { me, enemies } = enemiesOf(levelId, tokenId);
  if (!me) return told;
  if (hidden.has(tokenId)) {
    const near = enemies.find((e) => nextTo(levelId, e, me));
    const seer = near ?? enemies.find((e) => seenFrom(levelId, { col: e.col, row: e.row }, e.id, { ignoreHidden: true }).has(tokenId));
    if (seer && reveal(levelId, tokenId, near ? `${tokenLabels(levelId).get(near.id)} is right next to them` : `seen moving by ${tokenLabels(levelId).get(seer.id)}`)) told.push("You're no longer hidden.");
  }
  for (const e of enemies) if (hidden.has(e.id) && nextTo(levelId, e, me)) reveal(levelId, e.id, `${tokenLabels(levelId).get(tokenId)} is right next to them`);
  return told;
}
