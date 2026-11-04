# Game scripts

Scripts read and change game state. They're run by an interpreter (`lib/script.ts`), not JavaScript, so only what's listed here is reachable. Try them in **Session → script console**.

## State (`lib/game.ts`)

- `game.players` (also `game.characters`): characters, by name or id: `game.players['annis']`, `game.players.annis`.
  Each has `name`, `type` (read-only), `attributes.might` …, `health` (current), `alive` (read-only: health above 0), `conditions`.
- `coll.each.<prop>` (or `.all`) is that property of every item, like JS `.map`: `game.players.each.health` → `[25, 7]`.
  Assigning to it sets it on each: `game.players.all.health += 5`.
- `coll.count`.
- `conditions.add('grappled')`, `.remove(...)`, `.has(...)`, `.count`.
- `game.locations`: every location by name. `game.locations.current` (map button scripts only) is the button's location, with `level`, `actors` (everything on that level) and `creatures`.
  Each actor has `name`, `type`, `position` (`{col, row}`) and `health` (a character's is the player's). `creatures.add('giant rat')` adds a creature from the templates (`add('giant rat', 3)` adds a group); it must then be placed.
- From the map's layers, on `game.locations.current`, each named in its layer's list (rename them there):
  - `illumination`: the level's overall light, 0 (dark) to 1.
  - `lights`: `name`, `kind`, `range` (cells), `flicker`, `on`. e.g. `L.lights.all.on = false`, `L.lights['lamp'].range = 2`
  - `effects`: `name`, `kind`, `intensity` (0 to 1), `on`. e.g. `L.effects['storm'].on = true`
  - `doors`: `name`, `open`. e.g. `L.doors['cellar door'].open = false`
- Actors have `rolls.initiative` (1d20 + agility modifier, rolled fresh each read).
- `L.encounter` on the current location: `active`, `round`, `actor` (whose turn), `order`;
  `begin(actors, initiatives)` (initiatives optional, one per actor), `next()`, `end()`.
- `coll.random` picks one item at random; `coll.find('name')` is the first with that name.
- `game.characters.party`: the player characters (ticked "In the party" on the character form). `.any` is every member having a go (true if any of them succeeds, e.g. `party.any.rolls.investigation > 16`); `.one` is a single attempt by whoever the party sends (for now the member with the best modifier for that roll); `.random` picks one at random.
- `rolls.<attribute or skill>` on characters and actors: d20 + modifier, rolled afresh each time, e.g. `rolls.investigation`, `rolls.might`, `rolls.sleight_of_hand`.
- `game.calendar`: `now` (game minutes since the campaign began), `advance(2, 'hours')`, and `timers`:
  `timers.start('find holmes')` starts (or restarts) one, `timers['find holmes'].elapsed` is the game time since, `timers.stop('find holmes')`.
  `.expires(3, 'days')` gives a timer a duration and returns it; then `duration`, `remaining` (minutes) and `expired` (true once it has run that long).
  Helpers: `interval(minutes, 'days')` converts to minutes/hours/days/weeks; `duration(3, 'days')` is that span in minutes.
- `game.objectives['title']`: `status` ('open', 'succeeded', 'failed'; succeeding or failing runs the reward or penalty, as when the GM settles it) and `revealed`.
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

### Triggers: ON … DO

```
ON game.calendar.timers['find holmes'].expired DO
   game.characters['sherlock holmes'].health = 0

WITH game.characters['sherlock holmes'].health AS H
   ON H.changed DO
      IF H.current = 0 THEN
         game.objectives['find holmes'].status = 'failed'
```

`ON condition DO action` doesn't run anything now: it saves a trigger that keeps watching. Triggers are checked after every script runs (console, map buttons, discoveries, rewards), when game time moves and when the GM settles an objective. The action runs each time the condition *becomes* true (not again while it stays true), until the trigger is cancelled in Session › Triggers.
- WITH names are remembered as what they referred to when the ON ran: a timer stays that timer, `lights.random AS L` stays the light picked. A group (`.any`, `.one`) or a creature added but not yet saved can't be remembered: that's an error.
- A WITH name for a property's value (`WITH x.health AS H`) is watched: each check reads it afresh. `H.current` is the value now, `H.previous` at the last check, `H.changed` whether it differs; plain `H` means `H.current`. Changes made outside scripts (the character form) are noticed at the next check.
- In IF and ON conditions `=` means "is equal to" (same as `==`).
- Made on a map button, `game.locations.current` stays that button's location.
- A trigger whose condition or action fails is marked failed with the error and stops. Chains of triggers setting off triggers stop after 5.
- ON can't be used in objective conditions (they only ask). `on` is still usable as a name (`light.on`); ON only starts a trigger at the start of a statement.

Operators: `+ - * / %`, `== != < > <= >=`, `and or not` (or `&& || !`). Keywords are case-insensitive. `#` or `//` start a comment.
Map helpers:
- `near(x)`: a random free cell next to a position, actor or group.
- `distance(a, b)`: between positions or actors, in squares (diagonals count 1); on gridless maps in a straight line.

Gridless maps (Grid layer › Gridless): positions are anywhere (to 1/20 of a unit, so `col`/`row` can be fractional), `near()` picks a free spot in any direction, and distances are straight lines. The grid size is the unit of distance.
- `place(actor or group, position)`: sets up the scene (a group spreads out around the position). No fall damage.
- `move(actor, position)`: movement during play. Returns any fall damage taken.

Portrait (side-on) maps have gravity: horizontal walls, windows and closed doors are floors (an open door is a trapdoor).
Stairs (a structure on portrait maps) are sloped floors: a token in a column stands on the flight at that column's middle. A drop of under 2 cells does no damage, so walking down stairs isn't a fall.
Floors can be at any height (drawing snaps to columns across, 1/20 of a cell up and down), so an actor's `position.row` can be fractional: it stands on a floor at `row + 1`.
Anything placed or moved drops to the first floor below its middle; `near()` only picks spots on floors.
`move()` deals fall damage, 1d6 per 10 ft (2 cells). With no floor below, nothing falls, so draw the ground.
Helpers: `roll('2d6+1')`, `mod(score)`, and `sum`, `avg`, `min`, `max`, `count` over numbers or lists (`sum(game.players.each.health)`).

Not yet: locations, lights, encounters (they need runtime state first).

## Map buttons

Location → Controls: click a button's label to edit its script (saved only if it parses). Clicking the button on the map runs it; the result or error shows under the map.
