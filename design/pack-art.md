# Elemental Arcade: pack art

## Result: one generated pack wrapper, about $0.047 spent

The pack in the opening scene and the binder thumbnail are `img/pack.webp`, generated with `fal-ai/flux-2/flash`. A CSS foil sheen moves over it, masked to the pack's shape. The tear strip is the top of the same image, so dragging it pulls off the pack's own crimp. Card backs, the four finishes and the gold icon treatment stay CSS.

## Probe (prices checked 2026-10-10)

The same prompt went to three models at `image_size: "portrait_4_3"` (768x1024, 0.79 MP), safety checker on:

`flat foil booster pack, navy and gold, no letters, single sealed trading card pack centered, crimped gold edges, atom symbol, glossy foil sheen, solid dark navy background`

Prices come from the fal.ai pricing API on the day of the probe.

| Model | Price | $/image here | Reads as a pack at phone size | No garbled text | On palette | Not a brand ripoff | Avg | Notes |
|---|---|---:|:-:|:-:|:-:|:-:|:-:|---|
| **fal-ai/flux-2/flash** | $0.005/MP | $0.004 | 5 | 5 | 5 | 5 | **5.0** | Flat front view, gold crimped ends, navy body, gold atom. **Picked.** |
| fal-ai/flux/schnell | $0.003/MP | $0.0024 | 4 | 5 | 3 | 5 | 4.25 | Plain navy bag with no gold edges, on a black background. |
| fal-ai/recraft/v3/text-to-image | $0.04/image | $0.04 | 4 | 1 | 4 | 1 | 2.5 | Angled photo. It printed "Rotom" on the pack, which is a Pokémon name: fails the text and brand checks. |
| fal-ai/flux/dev | $0.025/MP | $0.02 | | | | | | Priced, not probed: 5x flash's price, and flash already scored 5. |

**Rule:** a model at 10x the price needs at least +1.5 average points to win. flash was both the best and the second cheapest, so it was locked. Its probe image met every check, so no batch was needed: the probe image is the shipped art.

## Processing (local, free)

- The border-connected navy background (RGB about 10, 20, 48) was made transparent with a flood fill. No AI background removal was used.
- Cropped to the pack and resized to 440x712.
- WebP at quality 84: **41 KB**. It is shown at up to 210 px wide, so 440 px stays sharp on 2x screens.

## Spend

| | Generations | Cost |
|---|---:|---:|
| Probes (3 models) | 3 | about $0.047 |
| Batch | 0 | $0 |
| **Total** | **3** | **about $0.047 of the $5 budget** |

## Key handling

The fal.ai key was passed only as an environment variable on each command line. The helper script contains no key; it reads `FAL_KEY` from the environment and redacts the key from any error it prints. The key is not in the repo, a commit, the PR, a screenshot, a log or a design doc, and the staged diff was scanned for it before committing. **Revoke the key.**

## Icons (no fal spend)

The 34 pack icons and 50 gold icons reuse the existing art in `design/icons/new`, `new2` and `rare` (PRs #12 to #14). They were resized to 128 px WebP in `img/icons/`: 84 files, 315 KB in total.
