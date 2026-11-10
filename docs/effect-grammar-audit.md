# Effect grammar audit

Audit of the handbook-style effect grammar (`lib/effectGrammar.ts`, a draft not yet used by the app) against the
current effect form. Each row is something the current form can make: the selections on the form, the sentence that
means the same, and whether that sentence compiles to the same engine data the form saves. Generated from a test run
on 2026-11-10; 65 of 65 come out the same in the engine (2 of them as equivalent, not identical, data).

Blanks are in brackets; the words between them are fixed. "You" is whoever has the effect, except in rules about the
creature that applied the condition, which are written the other way round, as the handbook writes Hex: there "you" is
whoever applied it and "the target" is whoever has it ("When you hit the target, add 1d6 necrotic damage."; "The
target can't attack you."). The opening decides the voice, so no one picks it. A rule with no "When …"
or "At the start of …" opening holds while its condition lasts.

**Branch**: *decided* = the sentence uses branches agreed in the grammar sessions; **new** = this audit added the
branch to cover something the current form can make.

| Current form (selections) | Expression | Result | Branch |
| --- | --- | --- | --- |
| **Damage and healing** | | | |
| Each round: `1d2` · damage · poison | [At the end of each round], [you take] [1d2] [poison] damage. | ✓ same | decided |
| Each round: `1d4` · healing | [At the end of each round], [your health increases by] [1d4]. | ✓ same | decided |
| At once: `1d10` · healing | [When this is applied], [your health increases by] [1d10]. | ✓ same | decided |
| At once: `2d6` · damage · fire | [When this is applied], [you take] [2d6] [fire] damage. | ✓ same | decided |
| Temporary health: `1d4+4` | [When this is applied], [you gain] [1d4+4] temporary health. | ✓ same | decided |
| Maximum health: `5` | [Your] [maximum health] [increases by] [5]. | ✓ same | decided |
| Maximum health: `-3` | [Your] [maximum health] [increases by] [-3]. | ✓ same<br>reads badly: wants "decreases by [3]" | decided |
| **Extra damage on a hit** | | | |
| On a hit: `1d6` · fire · on their hits | [When you hit a creature], [add] [1d6] [fire] damage. | ✓ same | decided |
| On a hit: `1d6` · necrotic · on hits against them (by its source) | [When you hit the target], [add] [1d6] [necrotic] damage. | ✓ same<br>the applier's voice: "you" = whoever applied the condition | **new** |
| **Restrictions** | | | |
| Can't: ☑ actions | [You can't] [take actions]. | ✓ same | decided |
| Can't: ☑ bonus actions | [You can't] [take bonus actions]. | ✓ same | decided |
| Can't: ☑ reactions | [You can't] [take reactions]. | ✓ same | decided |
| Can't: ☑ moving | [You can't] [move]. | ✓ same | decided |
| Can't: ☑ attacking whoever caused it | [The target can't attack you]. | ✓ same<br>the applier's voice: "you" = whoever applied the condition | **new** |
| Fails saves: ☑ Might ☑ Agility | [You automatically fail] [Might] saving throws.<br>[You automatically fail] [Agility] saving throws. | ✓ same<br>one sentence per attribute: the form's two ticks are two rules (the second: Agility) | **new** |
| Speed: half speed | [Your] [speed] [is halved]. | ✓ same | **new** |
| Speed: double speed | [Your] [speed] [is doubled]. | ✓ same | **new** |
| **Boosts** | | | |
| Boosts: Defense · `+2` | [Your] [defense] [increases by] [2]. | ✓ same | decided |
| Boosts: Might (attribute) · `+1` | [Your] [Might] [increases by] [1]. | ✓ same | decided |
| Boosts: Walking (movement) · `+10` | [Your] [walking speed] [increases by] [10]. | ✓ same | decided |
| Boosts: Damage · `+1d4` | [Your] [damage] [increases by] [1d4]. | ✓ same | decided |
| Boosts: Attack (to-hit) · `-1d4` | [When you make] [an attack roll], [subtract] [1d4] from the roll. | ✓ same | decided |
| Boosts: All saving throws · `+1d4` | [When you make] [a saving throw], [add] [1d4] to the roll. | ✓ same | decided |
| Boosts: Agility saves · `+2` | [When you make] [an Agility saving throw], [add] [2] to the roll. | ✓ same | **new** |
| Boosts: Stealth (skill) · `+2` | [When you make] [a Stealth check], [add] [2] to the roll. | ✓ same | **new** |
| Boosts: All ability and skill checks · `+1d4` | [When you make] [an ability check], [add] [1d4] to the roll. | ✓ same | decided |
| Boosts: Health · `+1d10` | [When this is applied], [your health increases by] [1d10]. | ≈ equivalent: the form's health boost heals as it lands, the same as At once · healing; the sentence saves that kind | decided |
| **Resistances** | | | |
| Resistances: Fire · resistant | [You are] [resistant] to [fire] damage. | ✓ same | **new** |
| Resistances: Poison · immune | [You are] [immune] to [poison] damage. | ✓ same | **new** |
| Resistances: Cold · vulnerable | [You are] [vulnerable] to [cold] damage. | ✓ same | **new** |
| Resistances: every damage type · resistant (13 rows) | [You are] [resistant] to [all] damage. | ✓ same<br>one sentence for what the form needs 13 rows for | **new** |
| **Becomes and multiplied** | | | |
| Becomes (at least): Might · `19` | [Your] [Might] [is raised to] [19]. | ✓ same | decided |
| Becomes (at least): Defense · `13+agility` | [Your] [defense] [is raised to] [13] plus your [Agility] modifier. | ✓ same | **new** |
| Multiplied: Damage · ×2 | [Your] [damage] [is doubled]. | ✓ same | **new** |
| Multiplied: Defense · ×½ | [Your] [defense] [is halved]. | ✓ same | **new** |
| Multiplied: Walking (movement) · ×0 | [Your] [walking speed] [drops to zero]. | ✓ same | **new** |
| **Advantage and disadvantage** | | | |
| Roll effects: Their attack rolls · disadvantage | [When you make] [an attack roll], [roll it twice and use the] [lower] result. | ✓ same | decided |
| Roll effects: Attack rolls against them · advantage | [When a creature makes an attack roll against you] it rolls twice and uses the [higher] result. | ✓ same | **new** |
| Roll effects: Wisdom save · advantage | [When you make] [a Wisdom saving throw], [roll it twice and use the] [higher] result. | ✓ same | **new** |
| Roll effects: Agility check · disadvantage | [When you make] [an Agility check], [roll it twice and use the] [lower] result. | ✓ same | **new** |
| Roll effects: Stealth check · advantage | [When you make] [a Stealth check], [roll it twice and use the] [higher] result. | ✓ same | **new** |
| Roll effects: one disadvantage row per attribute's check (7 rows, as the built-in Fear) | [When you make] [an ability check], [roll it twice and use the] [lower] result. | ✓ same<br>one sentence for 7 rows | decided |
| **Dice** | | | |
| Critical hits: on 19–20 | [Your] [attacks score a critical hit on a d20 roll of] [19] or higher. | ✓ same | **new** |
| Critical hits: ☑ criticals against them are normal hits | [Critical hits against you are normal hits]. | ✓ same | **new** |
| Rerolls: Their attack rolls · `1` | [When you make] [an attack roll], [reroll a d20 roll of] [1] or lower and use the new result. | ✓ same | **new** |
| Minimum d20: Stealth check · `10` | [When you make] [a Stealth check], [treat any d20 roll below] [10] as that number. | ✓ same | **new** |
| **Senses** | | | |
| Senses: ☑ blind | [You can't] [see beyond] [5] feet. | ✓ same | decided |
| Senses: ☑ invisible | [You are] [invisible]. | ✓ same | **new** |
| Senses: ☑ sees invisible things | [You can see invisible creatures]. | ✓ same | **new** |
| Darkvision: `60` ft | [Your] [darkvision] [is raised to] [60] feet. | ✓ same | decided |
| **Strain** | | | |
| Strain: Sanity · `2` | [When this is applied], [strain your] [Sanity] by [2]. | ✓ same | **new** |
| Strain: Sanity · `-1` | [When this is applied], [relieve] [1] strain from your [Sanity]. | ✓ same | **new** |
| **Triggers** | | | |
| Trigger: when they're hit · in melee · deals `2d8` fire · Agility save DC 13 halves it | [When a creature hits you] with a [melee] attack, [it takes] [2d8] [fire] damage (DC [13] [Agility] save for [half]). | ✓ same | decided |
| Trigger: when they're hit · by any attack · puts Poisoned on the other creature | [When a creature hits you], [it gains the] [Poisoned] condition. | ✓ same | decided |
| Trigger: when they're hit · by any attack · puts Frightened on themselves | [When a creature hits you], [you gain the] [Frightened] condition. | ✓ same | **new** |
| Trigger: when they hit someone · by any attack · deals `1d6` cold · Fortitude save DC 12 negates it | [When you hit a creature], [add] [1d6] [cold] damage (DC [12] [Fortitude] save for [none]). | ✓ same | decided |
| Trigger: when they hit someone · in melee · puts Prone on the other creature | [When you hit a creature] with a [melee] attack, [it gains the] [Prone] condition. | ✓ same | decided |
| Trigger: when they hit someone · puts Frightened on themselves | [When you hit a creature], [you gain the] [Frightened] condition. | ✓ same | **new** |
| Trigger: when they hit someone · deals `1d6` poison AND puts Poisoned on the other creature (one trigger) | [When you hit a creature], [add] [1d6] [poison] damage.<br>[When you hit a creature], [it gains the] [Poisoned] condition. | ≈ equivalent: the form packs two outcomes in one trigger; the builder writes two sentences, saved as extra poison damage on the hit plus a trigger putting on Poisoned | decided |
| Trigger: when they move · deals `2d8` thunder | [When you move], [you take] [2d8] [thunder] damage. | ✓ same | decided |
| Trigger: when they move · puts Prone on them | [When you move], [you gain the] [Prone] condition. | ✓ same<br>the form saves this as "on the other creature" (they're the same creature for moving); the builder says "you" | **new** |
| Trigger: at the start of each round · deals `1d6` fire · Fortitude save DC 12 halves it | [At the start of each round], [you take] [1d6] [fire] damage (DC [12] [Fortitude] save for [half]). | ✓ same | decided |
| Trigger: at the start of each round · puts Frightened on them | [At the start of each round], [you gain the] [Frightened] condition. | ✓ same | **new** |
| **Auras** | | | |
| Aura: Frightened · on enemies · within 15 ft | [Within] [15] feet of you [enemies] gain the [Frightened] condition. | ✓ same | **new** |
| Aura: Poisoned · on everyone · within 10 ft · ☑ itself too | [Within] [10] feet of you [creatures] and you gain the [Poisoned] condition. | ✓ same | **new** |

## Where the builder branches (added by this audit)

The first blank now offers: "You can't", "You are", "You can see invisible creatures", "You automatically fail", "Your", "Critical hits against you are normal hits", "The target can't attack you", "Within", "When you make", "When a creature makes an attack roll against you", "When this is applied", "At the start of each round", "At the end of each round", "When you hit a creature", "When a creature hits you", "When you hit the target", "When you take damage", "When you move".

New branches, by area: Extra damage on a hit, Restrictions, Boosts, Resistances, Becomes and multiplied, Advantage and disadvantage, Dice, Senses, Strain, Triggers, Auras.

- **Ongoing rules** gained "You are [resistant | vulnerable | immune] to [type | all] damage", "You are [invisible]",
  "You can see invisible creatures", "You automatically fail [attribute] saving throws", "Critical hits against you are
  normal hits" and "Within [N] feet of you [enemies | allies | creatures] (and you) gain the [condition] condition".
- **"Your [stat]"** gained "is doubled / is halved / drops to zero" (multiplied), "is raised to [N] plus your
  [attribute] modifier", overall "speed" (halved / doubled) and "attacks score a critical hit on a d20 roll of [N] or higher".
  Rolls and skills left this list: they're said with "When you make …", so each has one phrasing.
- **"When you make [roll]"** now lists one attribute's saving throw or check and each skill's check, and gained "reroll
  a d20 roll of [N] or lower and use the new result" and "treat any d20 roll below [N] as that number".
- **"When a creature makes an attack roll against you"** (advantage or disadvantage on attacks against you).
- **Triggers** gained "you gain the [condition] condition" after hit, landing a hit, moving and the start of each round.
- **The applier's voice**: "The target can't attack you" (Hypnotized) and "When you hit the target, add [dice] [type]
  damage" (a Hex), for the two things the form can say about the creature that applied the condition.
- **"When this is applied"** gained "strain your [attribute] by [N]" and "relieve [N] strain from your [attribute]".

## Findings

- Two openings now differ only by voice: "When you hit a creature" (you have the effect: a poisoned blade) and "When
  you hit the target" (you applied it: a Hex). The editor should make the voice visible, by grouping the applier's
  openings under their own heading ("About the creature that applied this"), so the two aren't confused.
- Some single form rows become several engine modifiers, and some sets of form rows become one sentence: "any d20 roll",
  "a saving throw" and "an ability check" stand for one modifier per attribute, and "all damage" for 13 resistances.
  The builder should show such a group as one sentence when it loads an effect.
- The form packs damage and a condition into one trigger; the builder writes two sentences. Same result in the engine.
- The form's "Fails saves" ticks become one sentence each. A sentence that lists several ("Might and Agility") would
  read better: a list blank is worth adding.
- The form's legacy health boost duplicates "At once · healing"; the builder keeps only "your health increases by".
- "Your [maximum health] increases by [-3]" reads badly: "increases by / decreases by" should be the blank.
- One rule the form can't make but the grammar can: adding dice to one attribute's checks (only every check or a skill
  can be boosted). The grammar flags it.
- Not covered here: a condition's lifecycle (rounds, saves, endings, stacking, concentration). The same builder is
  planned for it next.

## Engine gaps found while designing the grammar

1. Backwash: a trigger damaging whoever has the effect ("When you hit a creature, you take [1d4] [fire] damage").
2. Blindness at a range other than 5 feet.
3. Caps ("is reduced to"), starting with darkvision.
4. A "when you take damage" trigger event.
5. Triggers that know who caused the event (only damage from whoever applied the condition, say).
6. Triggers that heal.
7. Amounts from an attribute modifier ("your [Fortitude] modifier").
8. Reactions aimed at one attacker, spent once ("when a creature attacks you, before the roll").
9. Interactive reactions: the round pauses for a player to decide after seeing a roll (Silvery Barbs, Shield).
10. A save against damage at the end of a round (the start-of-round kind has one), and save results other than half or none.
