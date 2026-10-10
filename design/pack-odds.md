# Elemental Arcade: pack odds

These are the numbers the game uses. The binder's "Pack odds" panel is built from the same table (`PACK_ODDS` in `index.html`), so the two cannot drift apart.

## How a pack is earned

Packs are earned, never bought. There is no shop and no currency.

| Trigger | Rule | Pays again? |
|---|---|---|
| VS Arena win | 1st place, with at least 2 players who answered at least one question | Once per match id. A rematch is a new match, so it can pay again. Reopening the result screen cannot. |
| Gold Legend | The moment a card's correct-answer count first reaches 15 | Once per card, ever. Later correct answers on that card do not pay. |
| Level up | Each level this game reaches through play (a round, a VS match, or XP from a pack). Levels are per game. | Once per level per game (`level:chem:5`), so Cell Arcade's level 5 is a separate pack. Several levels at once pay one pack each. XP set any other way pays nothing. |
| Daily practice (signed in) | The first finished room round or VS match (any result) of the day, by the device's local date | Once per day (`day:YYYY-MM-DD`), synced across the student's devices. Signing in alone does not pay; a once-a-day pop-up at sign-in reminds them. Guests do not get it. |

Each paid reason is recorded in `packLog` (`vs:CODE`, `gold:cardId`, `day:YYYY-MM-DD`, `level:gameId:N`) when the pack is earned, so none can double, even across devices.

## What is inside

A pack has 3 cards. They are rolled when the pack is earned (seeded, stored on the pack), so a refresh or another device never rerolls them. Weights are percents of that card and each card sums to 100.

### Card 1: the staple

| % | Result |
|---:|---|
| 60 | A special finish on one of your cards: Foil, Prism, Night Sky or Ember (a Starter 20 card if you own none) |
| 40 | +15 XP |

### Card 2: the icon pull

| % | Result |
|---:|---|
| 62 | A Common icon you do not own |
| 25 | An Uncommon icon |
| 10 | A Rare icon |
| 2 | An Epic icon |
| 1 | A gold icon (uniform among the 50 gold icons you do not own) |

### Card 3: the chase

| % | Result |
|---:|---|
| 94 | +25 XP |
| 4 | A Rare icon |
| 1 | An Epic icon |
| 0.95 | A gold icon (uniform among the gold icons you do not own) |
| 0.05 | **This week's gold**: one specific gold icon, chosen from the week number (weeks start Monday, 5 January 2026) |

### Fall-through

You never get a duplicate. When a pull's band is empty because you own all of it (or another unopened pack already holds it), it falls to the next band down (Epic to Rare to Uncommon to Common), then to XP: +15 on card 1, +20 on card 2, +25 on card 3. A gold pull with no gold left, or this week's gold when you already have it, also becomes XP. Two cards in one pack never hold the same icon. If an icon was unlocked on another device between earning and opening, opening pays +25 XP instead.

A gold icon does not need the plain version: `cat-gold` can be unlocked while `cat` is still locked. A plain icon never unlocks its gold.

## Bands (34 winnable icons)

Split by count in the requested ratio (about half, a quarter, a sixth, the rest):

| Band | Count | Icons |
|---|---:|---|
| Common | 16 | boba, camera, cat, dice, dog, donut, pizza, note, sneaker, headphones, soccer, hoop, cactus, shades, bulb, skateboard |
| Uncommon | 10 | boombox, controller, vinyl, guitar, fox, panda, plane, rainbow, joystick, trophy |
| Rare | 6 | robot, planet, axolotl, ufo, volcano, chest |
| Epic | 2 | dragon, dino |

How they were placed: everyday objects and pets are Common; music and game gear and the animals with the most detailed art are Uncommon; space and fantasy pieces are Rare; the two dinosaur-and-dragon icons are Epic. This is a design choice, not a measurement, and it is all here.

The 16 starter icons (atom, bolt, beaker, crystal, flame, droplet, magnet, moon, star, comet, rocket, flask, crown, shield, spark, wave) are always free and never come from packs.

Gold: every one of the 50 icons (16 free plus 34 winnable) has a gold version, id `{id}-gold`. It uses the existing rare art from `design/icons/rare/` (converted to `img/icons/gold/`) with a CSS gold ring, a slow foil sheen and a gold corner. No new image was generated for gold.

## Finishes

Cosmetic only. They never change `owned` or the tier. A card can hold several; the binder shows the latest, and the card's enlarged view has buttons to swap or turn the finish off.

| id | Name | Look (CSS on the existing card) |
|---|---|---|
| `foil` | Foil | silver frame and a moving white sheen |
| `holo` | Prism | a rainbow color-dodge wash |
| `night` | Night Sky | a navy frame with a cyan inner glow and small stars |
| `ember` | Ember | an orange frame with a warm glow from the bottom |

## Checks

`tests/specs/packs.spec.js`:
- Each card's weights sum to 100.
- The same seed always rolls the same pack.
- 250,000 simulated packs match every row within 0.2 points. 10,000 packs match within 1 point: sampling noise alone is about ±1 point on a 62/38 split at that size, so 0.2 needs the larger run.
- Never a duplicate, the fall-through, and a student who owns everything gets only XP.
