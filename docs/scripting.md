# Game scripts

Scripts read and change game state. They're run by an interpreter (`lib/script.ts`), not JavaScript, so only what's listed here is reachable. Try them in **Session → script console**.

## State (`lib/game.ts`)

- `game.players`: characters, by name or id: `game.players['annis']`, `game.players.annis`.
  Each has `name`, `type` (read-only), `attributes.might` …, `health` (current), `conditions`.
- `coll.each.<prop>` (or `.all`) is that property of every item, like JS `.map`: `game.players.each.health` → `[25, 7]`.
  Assigning to it sets it on each: `game.players.all.health += 5`.
- `coll.count`.
- `conditions.add('grappled')`, `.remove(...)`, `.has(...)`, `.count`.
- `game.currentLocation` (map button scripts only): `name`, `level`, `actors` (everything on the level) and `creatures`.
  Each actor has `name`, `type` and `position` (`{col, row}`). `creatures.add('giant rat')` adds a creature from the templates; it must then be placed.
- `coll.random` picks one item at random.
- `game.vars.<anything>`: free-form flags for triggers (numbers, text, true/false). Unset = `null` (or 0 for `+=`, `++` …).

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

WITH game.players.each.health as H
   IF sum(H) < 20 THEN game.vars.retreat = true
```

Operators: `+ - * / %`, `== != < > <= >=`, `and or not` (or `&& || !`). Keywords are case-insensitive. `#` or `//` start a comment.
Map helpers: `near(position)` (a random free cell next to it), `place(actor, position)`.
Helpers: `roll('2d6+1')`, `mod(score)`, and `sum`, `avg`, `min`, `max`, `count` over numbers or lists (`sum(game.players.each.health)`).

Not yet: locations, lights, encounters (they need runtime state first).

## Map buttons

Location → Controls: click a button's label to edit its script (saved only if it parses). Clicking the button on the map runs it; the result or error shows under the map.
