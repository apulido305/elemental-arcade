# Elemental Arcade: rare (gold and shiny) icons

A rare version of every one of the 50 profile icons, meant as a reward tier. Design assets only. `index.html`, `firestore.rules`, `cloud.js` and `vs.js` are untouched.

Files: `design/icons/rare/{id}.png` (50 PNGs, 512x512, transparent background, same ids as the normal icons). Overview: `design/icons/contact-rare.png`.

## Two looks

Icons that are already gold would barely change under a gold treatment, so there are two looks:

- **gold (39 icons):** the whole icon becomes polished solid gold metal with bright specular highlights and a few small sparkles.
- **shiny (11 icons):** for icons that are already mostly gold. They keep their gold and gain a glossy holographic foil, a prismatic rainbow sheen and larger sparkles, so they still read as a distinct, rarer version.

Which icons are "shiny" was measured, not eyeballed: the share of each icon's opaque pixels that are already gold (hue 36-62, saturation above 0.32, brightness above 0.5). Anything at 30% or more is shiny:

`cat` 0.56, `planet` 0.43, `star` 0.42, `moon` 0.42, `bulb` 0.42, `atom` 0.36, `crown` 0.35, `trophy` 0.33, `plane` 0.31, `guitar` 0.31, `bolt` 0.30.

The next highest is `pizza` at 0.25, so there is a clear gap. Everything else is "gold".

## Method and model choice (prices checked 2026-10-09)

The goal was to keep each icon's silhouette, so a player recognizes the rare version as the same icon. Two approaches were probed on `atom`, `dog`, `crown` and `star`:

| Approach | Cost | Result | Verdict |
|---|---|---|---|
| Local gold-foil recolor (luminance mapped to a gold ramp, sweep highlight, glow, sparkles; Pillow, no AI) | $0 | Exact silhouette, but pale and washed out. Cream areas turned yellowish rather than metallic. | reject |
| `fal-ai/flux-2/flash/edit` (image in, prompt, image out) | $0.005 per megapixel of input and output, budgeted at $0.010 per 512 px image | Convincing metal and holographic foil, silhouette recognizable. | **pick** |
| `fal-ai/flux-kontext/dev` ($0.025/MP) and `fal-ai/qwen-image-edit` ($0.03/MP) | 5x to 6x the price | Priced but not probed: the cheapest edit model already cleared the quality bar. | not tried |

Prompts (appended to the icon image, which is composited on solid navy `#0b1030`):

- gold: `Recolor this sticker icon as a rare shiny collectible: the whole object becomes polished solid gold metal with bright specular highlights, glossy reflections and a few small white sparkle stars. Keep exactly the same shape, outline, pose, composition and the same solid navy background. No text, no letters, no watermark.`
- shiny: `Make this sticker icon a rare shiny holographic collectible: keep its gold colors but turn the surface into glossy iridescent foil with a prismatic rainbow sheen sweeping diagonally across it, bright specular highlights and a few large white sparkle stars. Keep exactly the same shape, outline, pose, composition and the same solid navy background. No text, no letters, no watermark.`

Backgrounds: the edit model returns a slightly lighter navy with soft shadow halos around sparkles. The border-connected background is made transparent locally (flood fill, wider cutoff than the first batches). Checked on navy `#0b1030` and on the lighter `#26358f` "me" row color, and every icon keeps at least 85% of its original opaque area, so nothing leaked into the artwork.

## Review

All 50 were compared against their originals at full size and at 28 px. No text, brand marks or school-filter problems appeared. No icon needed a retry, and none was rejected.

Known drift (the AI edit redraws the surface, so shapes can shift a little):

- `dino`: longer neck and a slightly different pose than the original.
- `hoop`: backboard and net are redrawn in gold.
- `panda`: the black patches vanish, so the face reads as one gold shape with ears.
- `crystal` and `star`: still carry the small clouds that the normal versions have; in the rare versions the clouds are silvery.
- `vinyl`, `soccer`, `shades`: lose most of their dark areas, so they read a little flatter than the others.

## Spend

| | Generations | Cost |
|---|---|---|
| This task (4 probes + 47 icons) | 51 | at most $0.51 (each edit budgeted at $0.010) |
| Whole job so far | 120 | at most $0.919 of the $7.00 cap |

The earlier 50-generation cap was lifted (twice) when the budget moved to $7. The fal key was read from the shell environment only and is not in any file in this repo.

## Not decided here (for a dev)

- How a student earns a rare icon, and whether a rare version is its own id (for example `atom-rare`) or a flag on the normal id. The Firestore rules whitelist icon ids, so a new id means a rules change.
- Whether PNG tiles are fine or the icons should be traced to SVG (the game draws icons as inline SVG).
- How rare icons look in the 28 px nameplate row next to normal ones; the strip on `contact-rare.png` is the only check done.
