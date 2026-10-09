# Elemental Arcade: build spec for Claude Code

You are the implementer. This file says what to build, in what order, where in the code, and how to know it is done. Read it top to bottom once, then work phase by phase.

**Status (after commit `41f476a` on `ux-icons`):** the UX pass (ux-spec changes 1 to 8) and the 16 profile icons are **already built** on this branch, with tests `ux.spec.js`, `icons.spec.js` and icon rules tests. What is left is the content fixes (Phase 1) and the quick-win rooms (Phase 2). Line numbers below are for `index.html` at `41f476a`; search by the function name if they have moved.

Source documents (read the section named in each phase, not the whole file):

- `design/ux-spec.md`: UX changes 1 to 8 and the 16 profile icons (SVG source, picker, placement, data shape).
- `design/content-review.md`: content bugs (§1) and new rooms (§3). Section numbers below refer to it.
- Screenshots of the current screens: `design/shots/` (390 and 1100 px) and `docs/vs-arena/`.

Stack: one static site. `index.html` (whole game, inline CSS and JS), `vs.js` (VS Arena), `cloud.js` (Firebase auth and save), `firestore.rules`, `tests/` (Playwright with a fake Firebase backend). No build step, no new dependencies, no framework.

## Ground rules

1. **One phase = one branch = one PR.** Branch names: `content-fixes`, `rooms-quick`. Start both from the current head of `ux-icons` (PR #3) or from `main` after PR #3 merges. Never push to `main`. Phase 1 first (Phase 2 reuses its generator helpers and tests).
2. **Do not break solo play or VS.** After each phase run the existing suite. All 11 spec files in `tests/specs` must still pass.
3. **Determinism.** VS Arena builds every round from a seed via `buildRound(deckId, roomId, seed)` and `makeQ`. Every question generator must use only `rand()`, `rnd()`, and `shuffle()` (the seeded helpers), never `Math.random`, `Date`, or `S.*` state. `tests/specs/rounds.spec.js` enforces this by throwing if `Math.random` is called. Exception: the Review Room reads `S.miss`, so it is solo only (Phase 2).
4. **Version skew (important).** Changing a generator changes the questions for the same seed. A phone with an old cached page and a phone with the new page would see different questions in one VS match. Ship content and generator changes outside class time, and add one line to the README: "After an update, everyone refresh the page before joining an arena." Also bump the `?v=` on the `cloud.js` and `vs.js` script tags (currently `v=3`, added in `4823228`) whenever either file changes.
5. **Classroom safety.** Nicknames only. No upload, no free text, no emoji, no chat, no real people, no brands. No weapons content.
6. **Mobile.** Every screen at 390 px: no horizontal scroll, every tap target at least 44 px tall (`tests/helpers/layout.js` `layoutProblems()` checks this; use it for any new screen). Honor `prefers-reduced-motion` (existing `@media` rules and the `RM` constant in `index.html`; keep them).
7. **Style.** Match the file: compact JS, string-built HTML through `esc()`, CSS custom properties from `:root`. Do not reformat existing code.
8. **Tests.** Each phase adds tests (listed per phase) in `tests/specs`, using `tests/helpers/fixtures.js`. Run with `cd tests && npm ci && npx playwright test`. If the sandbox Chromium version mismatches the pinned Playwright, install the version that matches `/opt/pw-browsers` rather than downloading browsers.
9. **Screenshots.** For every PR that changes a screen, regenerate before and after captures at 390 and 1100 px into `docs/` using the pattern in `tests/specs/screens.spec.js` and `ux.spec.js` (existing captures live in `docs/ux/` and `docs/vs-arena/`).

## Decisions already made (do not re-ask)

| Question | Decision |
|---|---|
| Fix ion neutrons how? (review §1a) | Option (a): `s2v` = rounded mass − Z for all 9 listed ions, so the explanation arithmetic is true. |
| Where is the profile icon stored? | Top-level `icon` on `/players/{uid}` and on the VS seat (this is how it was built in `41f476a`). **Not** inside `progress`, **not** in `PROG`. This overrides the review's closing note ("same pattern as `progress.icon`"). Badges and sets (review §4), if built later, are separate and do go in `progress`. |
| Which UX change disables rooms? | UX change 4 (locked rooms), not change 3 as the review's R5 says. It is built: tiles use `aria-disabled="true"`, the `ROOM_NEEDS` map and `lockedMsg()`. |
| Review Room clearing rule | Each correct answer in Review decrements `S.miss[id]` by 1; delete the key at 0. (Simpler than the review's "right twice"; uses only existing synced data.) |
| New rooms in Mixed Pack? | No. Keep Mixed Pack's `types` unchanged in this build so existing seeds stay comparable. |
| Anions deck split (review D1) | Not in this build. Leave deck ids as they are. |

If something here conflicts with the code you find, follow the code, make the smallest safe choice, and note it in the PR description.

---

## Phase 1: content fixes (branch `content-fixes`)

Source: `design/content-review.md` §1. All items are in `index.html`. Make each fix its own commit.

| # | Fix | Where | Done when |
|---|---|---|---|
| C1 | Set `s2v` (Neutrons) for the 9 ions to round(mass) − Z: Silver Ion 61, Copper(I) 35, Copper(II) 35, Zinc 35, Nickel(II) 31, Barium 81, Lead(II) 125, Tin(II) 69, Bromide 45. Ions are `DATA.cat` and `DATA.an`. | `DATA` (line 379) | Test: for every card with `cat` of `cat` or `an`, `s2v === Math.round(parseFloat(mass)) - zn`. The Particle Lab explanation then reads true. |
| C2 | Ability Match decoys: when every card in the pool shares one family, there are too few decoys (3 options). Use `same.slice(0,2).concat(rest).concat(same.slice(2))`. | `GEN.ability` (line 632) | Test: across decks `cat`, `an`, `all` and 20 seeds, every Ability Match question has 4 options when the pool has at least 4 cards. |
| C3 | Shape questions: only these five answers and decoys: `Linear`, `Bent`, `Trigonal planar`, `Trigonal pyramidal`, `Tetrahedral`. Normalize `DATA.poly` values like `Trigonal planar at C` (and any `Planar COO⁻ group`) to `Trigonal planar`; keep the detail in the card's `text`. Remove `Octahedral`, `Square planar`, `Seesaw`, `T-shaped` from the decoy list. List every `DATA.poly` config first and confirm each lands in the five. | `GEN.config`, poly branch (line 664) and `DATA.poly` | Test: for the poly shape question across 50 seeds, exactly one option is `ok`, and no two option strings are equal after trimming. |
| C4 | Orbital Builder notation: decoys must use the same notation as the answer. Core notation (starts with `[`) for answers where the stored config starts with `[`, full notation otherwise. Widen the decoy candidate list from `zn<=36` to `zn<=86` so core-notation answers have enough same-notation decoys. Keep sorting by nearness in Z. | `GEN.config`, element branch (lines 671 to 676) | Test: for every element question in `config`, all options start with `[` or none do. |
| C5 | f-block group question never offers `3` as a decoy. | `GEN.table`, f-block branch (line 679) | Change the `nums` pool to `[4,5,6,7,8,9,10,11,12]`. Test: no f-block group question has option `3`. |
| C6 | Table Map "state" question becomes 4-option: "Which of these is a {gas / liquid / solid} at room temperature?" The answer is the card itself; the 3 decoys are other elements whose state differs from the answer's (all known states: `Solid`, `Liquid`, `Gas`). Take decoys from the current deck first, then from all elements if fewer than 3. For `Liquid`, prefer decoys Ga, Cs, Sn, I (review R11). | `GEN.table`, state branch (line 679 to 713) | Test: 4 options, exactly one correct, over 50 seeds on decks `s20` and `e118`. "Solid" is no longer the correct label more than about half the time (the target state is chosen from the card's own state, so the answer distribution follows the deck; no longer a 3-option guess). |
| C7 | `mask()` also hides (a) the first 5 letters of the base name as a stem (so "Fluor…", "Nicke…", "Chrom…" are hidden) and (b) the exact symbol+charge string (`Fe²⁺`, `Na⁺`) when `post` is non-empty. | `mask` (line 514) | Test: for every card, the Ability Match clue text contains neither the card name, its 5-letter stem, nor its `sym+post`. Fix any ability text that still leaks by editing the text. |
| C8 | Text fixes: pluralize proton/neutron/electron/atom wording in `GEN.lab` ("1 proton"); Phosphide Ion text "used to poison rodents"; rename duplicate isotope abilities: Hydrogen-3 "Exit Sign Glow", Radon-222 "Radon Test", Radium-226 "Watch Dial", Uranium-235 "Fission Fuel", Americium-241 "Smoke Sensor". | `GEN.lab` (line 715), `DATA` | Test: no ability name appears on two different cards. |
| C9 | Isotope tile mass: for `cat==='iso'` the tile shows the mass number (`it.pre`) labeled "Mass no." instead of the element's average atomic mass. Find the tile renderer used by `cardHTML` and `tileScaled`. | tile code: `tileCore` / `tileScaled` (line 555), `atomArt` (line 562) | Screenshot of Hydrogen-2 and Americium-241 cards; test that no isotope tile text contains `1.008` or `[243]`. |

Optional if time remains: Family Sort 4-option variant for cation/anion and stable/radioactive (review §1b item 6), and neighboring-family decoys (item 7). Skip if it grows the diff.

Phase 1 acceptance: existing suite green; new test file `tests/specs/content.spec.js` with the tests above, running in the real page with Firebase blocked (copy the pattern in `rounds.spec.js`).

---

## Already built (do not redo): UX pass and profile icons

Commit `41f476a` implements `design/ux-spec.md` changes 1 to 8 and Part 2 (icons). Your job here is only to keep it working:

- Re-run `ux.spec.js`, `icons.spec.js`, `rules.spec.js` after every phase below.
- When you add a room: it shows on the home grid automatically (`homeHTML` builds tiles from `ROOMS`, sorts rooms with an empty pool to the end and locks them with `aria-disabled="true"`). Add an entry to `ROOM_NEEDS` (line 429) so the locked tile and `lockedMsg()` say what the room needs.
- Do not change the icon storage or ids. The 16 ids are in `ICONS` (line 432); the same list is whitelisted in `firestore.rules` and `tests/fake/rules.js`.
- I did not independently re-verify that build against `ux-spec.md`; treat a failing `ux.spec.js` or `icons.spec.js` as a real bug to report, not a test to loosen.

---

## Phase 2: quick-win rooms (branch `rooms-quick`)

Source: `design/content-review.md` §3 R1 (Ion Maker), R10 (Metal Detector), and R5 (Review Room). R11 (Table Map v2) is done by C6 in Phase 1. Do these three; everything else in the review is backlog.

### How to add a room (use for each)

1. `ROOMS` (line 418): add `{id,name,glyph,desc,theme,types:['<type>']}`. Pick a `theme` from `THEMES`. Add an entry to `ROOM_NEEDS` (line 429): `{needs:'<what cards it needs>',decks:['<deck ids that fill it>']}`.
2. `GEN.<type>(it)` (`const GEN`, line 631): return `{prompt,clue,opts,exp}` like the existing generators. Use `mkOpts(correctHTML, decoyHTMLList)` (line 618) or `numOpts` (line 624). Return `null` if there are not enough distinct decoys.
3. `supports(it,t)` (line 742): add a `case` so only valid cards enter the pool. `roomPool` (line 781) then filters automatically.
4. Rules: add the room id to the `room in [...]` lists in `firestore.rules` (lines 83 and 118), and to `ROOM_IDS` in `tests/fake/rules.js` (line 19). The live Firebase rules must be republished by the teacher (Firestore > Rules > paste > Publish) before the new rooms work in VS; say so in the PR.
5. `vs.js` builds its room `<select>` from `Arc.ROOMS` (line 316), so new rooms appear in VS automatically. A room that must not appear in VS gets `solo:true` and `vs.js` line 316 filters it out (also check the other `Arc.ROOMS.find` uses at lines 354 and 875 still resolve).
6. Add the room to the id list in `tests/specs/rounds.spec.js` (line 5) so it gets the determinism test.

### R1. Ion Maker (id `ion`, type `ion`)

- Pool: elements in the deck where `it.cat==='el'` and the element is in the table below.
- Valence electrons: group 1 or 2 is the group number; groups 13 to 18 are group − 10; helium is 2. Group is `it.s1v`.
- Ion charge table: Li, Na, K, Rb, Cs → 1+; Be, Mg, Ca, Sr, Ba → 2+; Al → 3+; N, P → 3−; O, S, Se → 2−; F, Cl, Br, I → 1−. Skip everything else (no single common ion).
- Question kinds, picked with `rnd`: (a) valence electrons, (b) "What ion does X usually form?", (c) "How many electrons does X lose/gain to form its ion?".
- Decoys exactly as in review R1: for valence use the raw group number, 8 − v, and one other plausible count; for the ion use the wrong sign, the wrong magnitude (`8−v`) and a flipped pair (`N⁵⁺`). Render charges with `<sup>` like the cards do. Options must all be distinct.
- Explanation template in the review. Clue: the element's tile via `tileScaled(it,{neutral:true,hide:{...}})` hiding group, charge and shells.
- Done when: over 200 seeds on decks `s20`, `r4`, `e118`, every question has 4 distinct options with exactly one `ok`, matches the tables in review R1, and `buildRound` stays deterministic.

### R10. Metal Detector (id `metal`, type `metal`)

- Class from `family`: `Metalloid` → metalloid; `Nonmetal`, `Halogen`, `Noble Gas` → nonmetal; everything else → metal. Exclude At, Ts and Z ≥ 104.
- Question: "Which one is a {metal / nonmetal / metalloid}?" Answer is the card; 3 decoys from the other two classes, preferring elements close in Z. Pool supports: elements not excluded.
- Done when: 4 options, one correct, decoys never in the answer's class, over 200 seeds across decks.

### R5. Review Room (id `review`, type `review`, solo only)

- `solo:true`; hide from the VS select (`vs.js` line 316) and keep its id out of `firestore.rules`.
- Pool: cards in the current deck with `S.miss[id] > 0`, ordered by miss count (descending). `supports(it,'review')` returns `S.miss[it.id]>0`. The home tile is locked until the pool has at least 3 cards: special-case `review` where `homeHTML` computes `n` (line 873) so `n` is 0 below 3, and special-case `lockedMsg` (line 869) to say "No misses yet. Nice." (no `ROOM_NEEDS` entry; it depends on the student, not the deck).
- Each question uses a type the card supports, chosen with `rnd` from `['ability','symbol','number','config','table','type','lab']` filtered by `supports`.
- On a correct answer in this room decrement `S.miss[id]` by 1 and delete the key at 0 (`S.miss[q.item.id]` is incremented at line 816 in the answer handler; add the decrement on the correct branch, guarded by `V.roomId==='review'`). `save()` already syncs `miss`.
- It is the only generator allowed to read `S`. Do not call it from `buildRound` for VS.
- Done when: a fresh profile sees the locked tile and message; after missing 3 cards the room unlocks; answering them correctly removes them from `S.miss`; the room does not appear in the VS host menu.

Phase 2 acceptance: the whole suite is green, `rules.spec.js` accepts the two new VS-capable room ids (`ion`, `metal`) and rejects `review` as a match room, and each new room has a screenshot of its tile (unlocked and, for Review Room, locked) and one question at 390 px.

---

## Backlog (do not build now)

Everything else in `design/content-review.md`: Polyatomic Ions deck and Formula Forge, Compounds deck, Trend Duel, Decay Lab, Bohr Builder, Equation Balancer, Name Game, Namesake, sets, badges, Element of the Day, Discovery frame. When these are scheduled, each needs a short spec like Phase 2 and the data tables in the review. The review's numbers (molar masses, half-lives, electronegativity) were produced by the reviewer and not independently re-verified; recheck them against a reference before shipping a card.

## Definition of done (every PR)

- Existing tests pass; new tests added as listed.
- Before and after screenshots at 390 and 1100 px for any screen change.
- PR description lists: what changed, which `design/` section it implements, any decision you had to make, and anything you could not verify.
- Commit messages end with the attribution lines from the session reminder.
- No change outside the files named in the phase without saying why.
