import { MAX_SCORE, MIN_SCORE, modifier, type Attributes } from "./attributes";
import { rollDice } from "./dice";
import { getVars, listCharacterStates, saveCharacterState, saveVars, transaction, type VarValue } from "./db";
import { Collection, FREEFORM, Method, ScriptError, Tags, runScript, toPlain } from "./script";

/** A character as scripts see it. Everything here except id, name and type can be changed. */
export interface Player {
  id: number;
  name: string;
  type: string;
  attributes: Attributes;
  health: number;
  conditions: Tags;
}

export interface Game {
  players: Collection<Player>;
  vars: Record<string, VarValue>;
}

function loadGame(): Game {
  const players = listCharacterStates().map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    attributes: { ...c.attributes },
    // Current health starts as a roll of the character's health formula.
    health: c.hp ?? rollDice(c.health || "0"),
    conditions: new Tags(new Set(c.conditions)),
  }));
  const vars = Object.assign(Object.create(null), getVars());
  FREEFORM.add(vars);
  return { players: new Collection("player", players), vars };
}

function saveGame(game: Game): void {
  const clamp = (n: number) => Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(n)));
  transaction(() => {
    for (const p of game.players.items) {
      const attributes = Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, clamp(v)])) as Attributes;
      saveCharacterState({ id: p.id, attributes, hp: Math.round(p.health), conditions: [...p.conditions.set] });
    }
    saveVars({ ...game.vars });
  });
}

/** Helpers scripts can call alongside `game`. */
const HELPERS = {
  roll: new Method((f) => {
    try {
      return rollDice(String(f));
    } catch (e) {
      throw new ScriptError((e as Error).message);
    }
  }),
  mod: new Method((score) => modifier(Number(score))),
  min: new Method((...n) => Math.min(...n.map(Number))),
  max: new Method((...n) => Math.max(...n.map(Number))),
};

/** Runs a script against the current game state and saves what it changed. Returns the last value. */
export function runGameScript(source: string): unknown {
  const game = loadGame();
  const result = runScript(source, { game, ...HELPERS });
  saveGame(game);
  return toPlain(result);
}
