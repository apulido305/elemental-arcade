# Elemental Arcade: icon refresh

Branch `icon-refresh`. Design assets only. `index.html`, `firestore.rules` and `cloud.js` are untouched.

## Model choice (prices checked 2026-10-09 on the fal model pages)

Images generated at `image_size: "square"` (512x512). fal bills per megapixel, rounded up, so 512x512 bills as 1 MP; `square_hd` (1024x1024, about 1.05 MP) would bill as 2 MP.

Probe: the same 2 subjects (`atom`, `headphones`) per model, style lock prompt, safety checker on. Scores 1-5 on: readable at 28 px, one object, no text, no brand marks, matches the cabinet palette, distinct silhouette.

| Model | $/image | atom | headphones | avg | Verdict | Reason |
|---|---|---|---|---|---|---|
| `fal-ai/flux/schnell` | 0.003 ($0.003/MP) | 3.6 | 4.0 | 3.8 | reject | Thin strokes, no creamy sticker outline, background drifts (`#0a3158`, `#2b4870`). Best raw score per dollar, but it does not hold the style lock. |
| `fal-ai/flux-2/flash` | 0.005 ($0.005/MP) | 4.6 | 5.0 | 4.8 | **pick** | Thick creamy outline, dark navy field, gold and sky accents, clear silhouettes. Only about $0.002 more per image than schnell (about $0.07 over 32 icons). |
| `fal-ai/recraft-v3` (`digital_illustration`) | 0.04 per image | 3.0 | 2.6 | 2.8 | reject | 8x the cost and worse here: white background on the atom, off-palette red nucleus, a lettered crest on the headphones (text and logo-like marks), too much detail for 28 px. |

`fal-ai/flux/dev` ($0.025/MP) was priced but not probed (shortlist of three; it would cost 5x flash and would need a 1.5-point gain to win).

Judgment call: schnell has the higher raw score-per-dollar, so the stated rule favors it on paper. It was rejected because it fails the style lock (no thick outline, off-palette backgrounds). Flip this if you prefer the strict rule.

## Background

flash's background measures about `#112240`, not `#0b1030`. The fal background-remover model pages show no usable per-image price (only a "$0 per compute second" notice), so no fal remover was used. The background is normalised locally (free) instead.

## Spend

Probes: 7 generations, $0.099 (one extra schnell generation was billed but its download was blocked by the egress allowlist before `*.fal.media` was added).

## Icons

All 32 are 512x512 PNGs. The flat navy generation field was made transparent locally (border flood-fill, no dependency in the repo) so they sit on any panel color; interior navy inside a sticker outline is kept. Checked at 28 px on navy `#0b1030` and on the lighter `#26358f` "me" row color. Contact sheet: `design/icons/contact-v2.png` (rows 1-4 replacements, rows 5-8 new).

Style lock tail used for every image, unchanged:
`flat sticker icon of {SUBJECT}, one object centered, thick creamy outline, simple bold shapes, gold and sky accents on a solid navy #0b1030 background, no text, no letters, no watermark, no mockup, no frame, high school arcade avatar, readable at small size`

| id | label | batch | subject | keep or drop |
|---|---|---|---|---|
| `atom` | Atom | replace | atom, three orbit rings, gold nucleus | keep |
| `bolt` | Bolt | replace | chunky gold lightning bolt | keep (retry; small cloud remains) |
| `beaker` | Beaker | replace | straight-sided lab beaker, green liquid | keep (retry; first pass drew a flask) |
| `crystal` | Crystal | replace | faceted green gem | keep (retry; clouds and sparkles remain) |
| `flame` | Flame | replace | rose-red flame, gold inner flame | keep |
| `droplet` | Droplet | replace | sky-blue water droplet | keep |
| `magnet` | Magnet | replace | pink-red horseshoe magnet, cream tips | keep (retry) |
| `moon` | Moon | replace | gold crescent moon | keep (retry) |
| `star` | Star | replace | five-point gold star | keep (retry; clouds remain) |
| `comet` | Comet | replace | sky-blue comet head, streaking tails | keep |
| `rocket` | Rocket | replace | cartoon rocket, pink-red fins | keep (retry; first pass drew roses on the fins) |
| `flask` | Flask | replace | Erlenmeyer flask, pink liquid | keep (rose-flower swirl in the liquid; no retries left to spend) |
| `crown` | Crown | replace | gold crown, three points | keep |
| `shield` | Shield | replace | green shield, cream check mark | keep (retry) |
| `spark` | Spark | replace | four-point green sparkle | keep |
| `wave` | Wave | replace | sky-blue wave curl | keep |
| `headphones` | Headphones | new | over-ear headphones | keep |
| `controller` | Controller | new | generic game controller, no logos | keep |
| `skateboard` | Skateboard | new | plain skateboard, side view | keep (thin; smallest read at 28 px) |
| `sneaker` | Sneaker | new | plain high-top, no logo | keep |
| `dice` | Dice | new | single six-sided die | keep |
| `camera` | Camera | new | retro film camera, no brand | keep |
| `vinyl` | Vinyl | new | vinyl record, gold label | keep (retry; first pass had a stray cloud) |
| `note` | Note | new | beamed eighth notes | keep |
| `boombox` | Boombox | new | retro boombox, two speakers | keep |
| `robot` | Robot | new | friendly square-headed robot | keep |
| `cat` | Cat | new | plain gold cat face, no bow | keep (retry; first pass was a hollow navy face) |
| `dino` | Dino | new | friendly cartoon dinosaur | keep (small at 28 px) |
| `planet` | Planet | new | ringed planet | keep |
| `trophy` | Trophy | new | gold trophy cup, no writing | keep |
| `hoop` | Hoop | new | basketball hoop and net, no logo | keep (tiny cloud at the base) |
| `boba` | Boba | new | bubble tea cup, straw, pearls | keep |

### Cast swap

The requested cast included `comet` and `crown`, but both already exist in the game's 16 ids, so they cannot be new. Replaced with `planet` and `trophy`.

### Rejected generations

First-pass images replaced by a retry: `beaker` (drew an Erlenmeyer flask, same silhouette as `flask`), `rocket` (the word "rose" produced actual roses), `bolt`, `moon`, `magnet`, `crystal`, `star`, `shield` (stray clouds and sparkles, breaking "one object"), `vinyl` (stray cloud), `cat` (face filled with the background navy, read as hollow). Probe images from schnell and recraft-v3 are not in the repo. Nothing else was rejected: no weapons, blood, drugs, alcohol, cigarettes, gang signs, romance, real people, brand marks, skulls, or in-image text appeared in any kept icon.

### Spend

Whole job, probes included: 49 generations, $0.309 (cap: 50 generations, $5.00). The key was read from the shell environment only; it is not in any file in this repo.

## Follow-up for a dev

- `firestore.rules` whitelists icon ids, so the 16 new ids (`headphones`, `controller`, `skateboard`, `sneaker`, `dice`, `camera`, `vinyl`, `note`, `boombox`, `robot`, `cat`, `dino`, `planet`, `trophy`, `hoop`, `boba`) must be added there, to the `ICONS` array and to `ICON_IDS` before students can pick them.
- The game draws icons as inline SVG; these are PNGs. Either wire them in as `<img>` tiles or trace them to SVG. This branch does not do either.
- Decide whether `design/icons/v2/*` replaces the SVGs for the existing 16 ids.
