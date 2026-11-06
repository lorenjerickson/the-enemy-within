import { db } from "./db";
import { rollDice } from "./dice";

/** Health: current, maximum (rolled once from the health formula) and temporary (lost first). */
export interface HealthValues {
  current: number;
  maximum: number;
  temporary: number;
}

/** Takes `amount` damage (negative heals): temporary health goes first. */
export function takeDamage(h: HealthValues, amount: number): HealthValues {
  const fromTemp = Math.min(h.temporary, Math.max(0, amount));
  return { ...h, temporary: h.temporary - fromTemp, current: h.current - (amount - fromTemp) };
}

type Row = { hp: number | null; hp_max: number | null; hp_temp: number | null; formula: string | null };

/** Health from stored columns; a maximum never rolled is rolled now (and kept by the caller's save). */
function fromRow(r: Row): [HealthValues, boolean] {
  const rolled = r.hp_max === null || r.hp === null;
  const maximum = r.hp_max ?? Math.max(r.hp ?? 0, rollDice(r.formula || "0"));
  return [{ current: r.hp ?? maximum, maximum, temporary: r.hp_temp ?? 0 }, rolled];
}

const whole = (h: HealthValues) => [Math.round(h.current), Math.max(0, Math.round(h.maximum)), Math.max(0, Math.round(h.temporary))] as const;

export function saveCharacterHealth(id: number, h: HealthValues): void {
  db.prepare("UPDATE characters SET hp = ?, hp_max = ?, hp_temp = ? WHERE id = ?").run(...whole(h), id);
}

/** A character's health, rolling its maximum the first time. */
export function characterHealth(id: number): HealthValues | null {
  const r = db.prepare<[number], Row>("SELECT hp, hp_max, hp_temp, health AS formula FROM characters WHERE id = ?").get(id);
  if (!r) return null;
  const [h, rolled] = fromRow(r);
  if (rolled) saveCharacterHealth(id, h);
  return h;
}

/** A token's health: a character token's is the character's; a creature token keeps its own. */
export function tokenHealth(tokenId: number): HealthValues | null {
  const r = db
    .prepare<[number], Row & { character_id: number | null }>(
      "SELECT t.character_id, t.hp, t.hp_max, t.hp_temp, cr.health AS formula FROM map_tokens t LEFT JOIN creatures cr ON cr.id = t.creature_id WHERE t.id = ?"
    )
    .get(tokenId);
  if (!r) return null;
  if (r.character_id) return characterHealth(r.character_id);
  const [h, rolled] = fromRow(r);
  if (rolled) saveTokenHealth(tokenId, h);
  return h;
}

export function saveTokenHealth(tokenId: number, h: HealthValues): void {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (t?.character_id) return saveCharacterHealth(t.character_id, h);
  db.prepare("UPDATE map_tokens SET hp = ?, hp_max = ?, hp_temp = ? WHERE id = ?").run(...whole(h), tokenId);
}
