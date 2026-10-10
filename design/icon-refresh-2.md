# Elemental Arcade: icon refresh, batch 2 (18 more, 50 total)

Design assets only. `index.html`, `firestore.rules`, `cloud.js` and `vs.js` are untouched. This branch is based on `main` and is independent of PR #12, so the two can merge in either order.

## Where the 50 come from

| Set | Count | Where |
|---|---|---|
| Original ids, regenerated | 16 | `design/icons/v2/` (PR #12) |
| New in PR #12 | 16 | `design/icons/new/` (PR #12) |
| New in this PR | 18 | `design/icons/new2/` |
| **Total unique icon ids** | **50** | |

`design/icons/contact-v3-all-50.png` shows all 50 (5 columns x 10 rows, each with a 28 px strip). The 32 from PR #12 appear on the sheet but their files live in that PR.

## Model

Same locked pair as batch 1: `fal-ai/flux-2/flash`, `image_size: "square"` (512x512, billed as 1 MP), about $0.005 per image, safety checker on. Same style lock tail, unchanged:

`flat sticker icon of {SUBJECT}, one object centered, thick creamy outline, simple bold shapes, gold and sky accents on a solid navy #0b1030 background, no text, no letters, no watermark, no mockup, no frame, high school arcade avatar, readable at small size`

Every subject also says "alone with no clouds or sparkles" (batch 1 showed the sky accent invites clouds). The word "rose" is avoided (it produced actual roses last time). As before, the flat navy field is made transparent locally (border flood-fill), so the icons sit on any panel color.

## The 18 new icons

Mixed on purpose: animals, food, music, sports, space and arcade. None repeat the existing 32 ids, and nothing that could trip the school filter was used (no weapons, mushrooms, skulls, hearts, or brand-like characters).

| id | label | subject | keep or drop |
|---|---|---|---|
| `dog` | Dog | friendly plain dog face, floppy ears | keep |
| `fox` | Fox | friendly orange fox face | keep |
| `axolotl` | Axolotl | cute pink axolotl, feathery gills | keep (tiny sparkle at the edge) |
| `panda` | Panda | plain panda face | keep |
| `dragon` | Dragon | friendly green dragon head, no fire | keep |
| `ufo` | UFO | flying saucer, sky-blue dome | keep |
| `pizza` | Pizza | pepperoni slice | keep (tiny sparkle) |
| `donut` | Donut | pink icing, sprinkles | keep |
| `cactus` | Cactus | potted cactus with a small flower | keep |
| `soccer` | Soccer | plain soccer ball, no logo | keep |
| `guitar` | Guitar | plain electric guitar, no logo | keep |
| `shades` | Shades | sunglasses, dark lenses | keep |
| `rainbow` | Rainbow | chunky rainbow arc | keep (small clouds at the base, natural for a rainbow) |
| `bulb` | Bulb | glowing gold light bulb | keep (retry; first pass had stray clouds) |
| `joystick` | Joystick | arcade joystick, red ball top | keep |
| `chest` | Chest | open treasure chest, gold coins, no skull | keep |
| `volcano` | Volcano | small volcano, orange lava | keep (small sparkles near the lava) |
| `plane` | Paper Plane | folded paper airplane, gold wing, dotted trail | keep (retry; see below) |

### Rejected generations

- `plane`, first pass: a cream paper plane on blue read too much like the Telegram logo, which breaks "no brand marks". Regenerated in a different pose (steep angle, gold wing, dotted trail, no circle or blue field). The retry is the one kept.
- `bulb`, first pass: stray clouds. The retry is clean and is the one kept.
- Nothing else was rejected. No weapons, blood, drugs, alcohol, cigarettes, gang signs, romance, real people, brand marks, skulls, or in-image text appear in any kept icon.

## Spend

| | Generations | Cost |
|---|---|---|
| This batch (18 icons + 2 retries) | 20 | $0.100 |
| Whole job so far (batch 1 + batch 2) | 69 | $0.409 |
| Cap | $7.00 | the earlier 50-generation cap was lifted when the budget was raised |

The fal key was read from the shell environment only. It is not in any file in this repo.

## Follow-up for a dev

- `firestore.rules` whitelists icon ids, so **34 new ids** must be added there, to `ICONS` and to `ICON_IDS` before students can pick them: the 16 from PR #12 (`headphones`, `controller`, `skateboard`, `sneaker`, `dice`, `camera`, `vinyl`, `note`, `boombox`, `robot`, `cat`, `dino`, `planet`, `trophy`, `hoop`, `boba`) and the 18 here (`dog`, `fox`, `axolotl`, `panda`, `dragon`, `ufo`, `pizza`, `donut`, `cactus`, `soccer`, `guitar`, `shades`, `rainbow`, `bulb`, `joystick`, `chest`, `volcano`, `plane`).
- The game draws icons as inline SVG; these are PNGs. Either wire them in as `<img>` tiles or trace them to SVG.
- A picker with 50 icons needs scrolling or paging. `design/ux-spec.md` specifies a 4-column grid for 16.
