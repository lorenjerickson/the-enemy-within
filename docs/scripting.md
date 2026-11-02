# Game scripts

Scripts read and change game state. They're run by an interpreter (`lib/script.ts`), not JavaScript, so only what's listed here is reachable. Try them in **Session → script console**.

## State (`lib/game.ts`)

- `game.players`: characters, by name or id: `game.players['annis']`, `game.players.annis`.
  Each has `name`, `type` (read-only), `attributes.might` …, `health` (current), `conditions`.
- `coll.all.<prop>` reads or writes a property on every item: `game.players.all.health += 5`.
- `coll.count`.
- `conditions.add('grappled')`, `.remove(...)`, `.has(...)`, `.count`.
- `game.vars.<anything>`: free-form flags for triggers (numbers, text, true/false). Unset = `null`.

Changes are saved when the script finishes. A failing script saves nothing.

## Language

```
game.players.annis.health += 10            # = += -= *= /= ++ --
a > b ? x.conditions.add('grappled')       # ternary, ": else" optional
IF a > b THEN x ELSE y                     # one line, or with indented blocks:

with game.players as P                     # WITH ... AS name: a short name
   with P.annis                            # WITH without AS: its properties become bare names
      IF attributes.might > 12
         THEN health += roll('1d6')
```

Operators: `+ - * / %`, `== != < > <= >=`, `and or not` (or `&& || !`). Keywords are case-insensitive. `#` or `//` start a comment.
Helpers: `roll('2d6+1')`, `mod(score)`, `min(...)`, `max(...)`.

Not yet: locations, lights, encounters (they need runtime state first).
