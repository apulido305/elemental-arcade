# Elemental Arcade: pack art

## Result: no generated art, $0 spent

The pack wrapper ships as CSS: a navy foil pack with gold crimped edges, a moving foil sheen, the game's atom logo and "ELEMENTAL PACK" (`.pkart` in `index.html`). The card backs in the opening scene use the same CSS. The four finishes and the gold icon treatment are CSS too.

| Item | Source | Cost |
|---|---|---|
| Pack wrapper | CSS (`.pkart`, `.pkfoil`, `.pkcrimp`) | $0 |
| Card backs | the same CSS | $0 |
| Finishes (foil, holo, night, ember) | CSS over the existing card | $0 |
| Gold icons (50) | existing rare art from `design/icons/rare/` (PR #14), resized to 128 px WebP, plus a CSS ring and sheen | $0 |
| Winnable icons (34) | existing art from `design/icons/new/` and `new2/`, resized to 128 px WebP | $0 |
| **fal.ai total** | | **$0.00** |

## Why there is no probe table

The plan was to price current fal.ai text-to-image models, probe at most $1.00 on 2 or 3 of them with "flat foil booster pack, navy and gold, no letters", score them, and lock one for a single wrapper.

The first fal.ai request (a read-only price lookup) was blocked by the coding agent's safety check (the auto-mode classifier flagged it as credential use). The agent did not retry it or work around it. So no model was priced, probed or used. The task allowed this case ("If the wrapper is not worth a generation, ship a CSS foil pack and spend $0"), so the CSS pack is the shipped design.

The key was never written to the repo, a commit, a log or any file in the branch.

## If a generated wrapper is wanted later

1. Allow the fal.ai call for the session, then run the probe (2 or 3 models, about $0.01 to $0.05 total at 3:4) and record model, $/image, date and a 1 to 5 score in a table here.
2. Save the pick as `img/pack.webp` (about 360x480, compressed) and set it as the background of `.pkart.lg`. Keep the CSS foil sheen on top.
3. School filter: no text that has to be read, no brands, no real people.

Icon sizes: 84 WebP files at 128x128, 315 KB in total (the source PNGs are about 230 KB each). They are shown at 64 px, so 128 px stays sharp on 2x screens.
