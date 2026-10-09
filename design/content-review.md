# Elemental Arcade: content and gameplay review

This review covers content and gameplay only. Layout and UI are in `design/ux-spec.md`; I only refer to it where something depends on it. Nothing here has been built. No app code changed.

**How I checked**

- **Played the live site** (https://apulido305.github.io/elemental-arcade/) in headless Chrome at 1100 px and 390 px, with full solo rounds.
- **Scanned 46,800 generated questions.** In the live page I called the game's own `window.Arcade.buildRound` for every deck × room × 60 seeds. I logged the option count, the answer, the explanation, and any ambiguous options.
- **Audited all 183 cards against references.** I pulled `DATA` out of `index.html` and checked it with a script:
  - Symbol and name.
  - Electron count of each configuration, against the Madelung rule plus the known exceptions (Cr, Cu, Nb, Mo, Ru, Rh, Pd, Ag, La, Ce, Gd, Pt, Au, Ac, Th, Pa, U, Np, Cm, Lr).
  - Shell totals and period.
  - Standard atomic weight, against the `periodictable` package.
  - Ion protons, neutrons, and electrons, and isotope A − Z.
  - Polyatomic electron totals and molar masses, recomputed by hand.
- **Read every ability line.**

---

## 0. Top 5 recommendations

| # | Recommendation | Type | Effort |
|---|---|---|---|
| 1 | **Fix the six content bugs in §1**: ion neutron explanations, 3-option Ability Match, ambiguous shapes, mixed config notation, the "Solid" state skew, and f-block group distractors. | Quick win | 0.5–1 day |
| 2 | **New room: Ion Maker** (valence electrons + predict the ion). It runs on existing element data and covers core HS chemistry. | Quick win | ~0.5 day |
| 3 | **New Polyatomic Ions deck** (split out of "Anions" and expanded to 22) **plus a Formula Forge room** (cation + anion → formula). It runs on existing ion charges. | Medium | 1–2 days |
| 4 | **New room: Review Room** ("Missed It"), built from the student's own missed cards (`S.miss`). The data is already there. | Quick win | ~0.5 day |
| 5 | **New room: Trend Duel** (atomic radius, electronegativity, ionization energy, ion size) on main-group elements, with a small data table. | Medium | 1 day |

After those, in order:

6. Compounds deck + Name Game + Molar Mass rooms
7. Decay Lab (nuclear decay + half-life)
8. Bohr Builder
9. Equation Balancer
10. Recipes, sets, and badges (§5)

The full ranking is in §5.

---

## 1. Data and question problems found

### 1a. Card data errors

The element data is very clean. All 118 symbols, Z values, configurations (including the exceptions), shell counts, periods, groups, and standard atomic weights check out. Ion electron counts and isotope neutron counts are all correct.

**One real data and logic error: 9 ions.** The Particle Lab explanation shows wrong arithmetic, and the "correct" answer disagrees with the method the game teaches.

Particle Lab explains ion neutrons as `Neutrons = rounded mass − protons = …`, but the stored answer (`s2v`) is the neutron count of the **most abundant isotope**. For 9 ions these differ, so the explanation prints false arithmetic, for example "64 − 29 = 34". A student who uses the taught method gets the "wrong" answer. In my scan, the textbook value appeared as a wrong option in 88 of 229 questions on these ions.

| Card | Stored neutrons (`s2v`) | Explanation shows | Rounded mass − Z | Most-abundant isotope |
|---|---|---|---|---|
| Silver Ion Ag⁺ | 60 | 108 − 47 = 60 ✗ | **61** | Ag-107 → 60 |
| Copper(I) Ion Cu⁺ | 34 | 64 − 29 = 34 ✗ | **35** | Cu-63 → 34 |
| Copper(II) Ion Cu²⁺ | 34 | 64 − 29 = 34 ✗ | **35** | Cu-63 → 34 |
| Zinc Ion Zn²⁺ | 34 | 65 − 30 = 34 ✗ | **35** | Zn-64 → 34 |
| Nickel(II) Ion Ni²⁺ | 30 | 59 − 28 = 30 ✗ | **31** | Ni-58 → 30 |
| Barium Ion Ba²⁺ | 82 | 137 − 56 = 82 ✗ | **81** | Ba-138 → 82 |
| Lead(II) Ion Pb²⁺ | 126 | 207 − 82 = 126 ✗ | **125** | Pb-208 → 126 |
| Tin(II) Ion Sn²⁺ | 70 | 119 − 50 = 70 ✗ | **69** | Sn-120 → 70 |
| Bromide Ion Br⁻ | 44 | 80 − 35 = 44 ✗ | **45** | Br-79 → 44 (Br-81 is 49%) |

**Fix: pick one.**

- **(a) Recommended for HS.** Set `s2v` to rounded mass − Z for all ions, i.e. the "correct" values in the table above. Every other ion already matches this rule. Then also update the card's stat box.
- **(b)** Keep the isotope values and change the explanation to "the most common isotope, ⁶³Cu, has 63 − 29 = 34". Never show rounded-mass arithmetic.

Either way, the Particle Lab neutron question for these 9 ions should never offer the other value as a distractor.

**Minor content issues (not wrong, but confusing):**

| Item | Issue | Suggested fix |
|---|---|---|
| All 25 isotope cards | The tile's mass shows the **element's average atomic mass**, e.g. Hydrogen-2 shows `1.008` next to ²H, and Americium-241 shows `[243]`. A student reads "mass 1.008" for deuterium. | Show the mass number on isotope tiles (`2`), or the isotopic mass (²H = 2.014). Relabel it "Mass number". |
| Fluorine ability | "Fluoride in toothpaste…" is not masked, which gives the answer away. | Mask word stems. See 1b(7). |
| Nickel(II) Ion ability | "Nickel plating…" is not masked. | Same. |
| Ion ability texts | Several contain their own symbol and charge ("Fe²⁺ in hemoglobin", "Na⁺ rushing…", "K⁺ keeps…", "Li⁺ ions", "Al³⁺", "H⁺"). In Ability Match the answer is in the clue. | Also mask `sym+post` in `mask()`. |
| Eponymous elements (Cm, Es, Fm, Md, No, Lr, Rf, Sg, Bh, Mt, Rg, Cn, Og, Bk, Ds, Nh, Fl, Mc, Lv, Ts, Zr "zirconia", Cr "Chrome", La/Ac "Namesake of…", Sm "samarskite") | The text names the person or place, which makes these easy. That's fine for learning, but Ability Match on Row 7 is mostly free points. | Optional: move the "Named for…" line into the history deck (§3, Hall of Names), and use a property line in Ability Match. |
| Phosphide Ion | "once used to poison rodents": zinc phosphide is still used. | "used to poison rodents". |
| Particle Lab text for H⁺ | "It has 1 protons…" | Pluralize: `p===1?'proton':'protons'`. |
| Duplicate ability names | Glow Light (Promethium / Hydrogen-3), Basement Gas (Radon / Radon-222), Glow Paint (Radium / Radium-226), Chain Reaction (Uranium / Uranium-235), Smoke Detector (Americium / Americium-241). They never meet in one question (decoys share a category), but they look like duplicates in the binder. | Rename the isotope versions: "Exit Sign Glow" (H-3), "Radon Test" (Rn-222), "Watch Dial" (Ra-226), "Fission Fuel" (U-235), "Smoke Sensor" (Am-241). |
| "Anions" deck | Contains Ammonium NH₄⁺ and Hydronium H₃O⁺, which are **cations**. | Split it. See §2, Polyatomic Ions. |

### 1b. Question-generator problems (from the 46,800-question scan)

1. **Ability Match on ion and polyatomic cards always has 3 options, never 4.**
   - Seen in 1,346 of 1,346 ion and polyatomic ability questions.
   - Cause: `GEN.ability` takes 2 same-family decoys and then *other-family* decoys. Every cation shares the family "Cation", and every polyatomic shares "Polyatomic", so there are no other-family decoys.
   - Fix: `same.slice(0,2).concat(rest).concat(same.slice(2))`.
2. **Polyatomic shape questions can have two correct answers.**
   - The shape pool mixes `Trigonal planar` with `Trigonal planar at C` (bicarbonate) and `Planar COO⁻ group` (acetate).
   - "What shape does the Bicarbonate Ion have?" sometimes offers both `Trigonal planar at C` (marked right) and `Trigonal planar` (marked wrong). Acetate's carboxylate carbon is also trigonal planar. This happened 22 times in the scan.
   - Fix: give bicarbonate and acetate `config:'Trigonal planar'` with a note line, or exclude them from shape questions. Never put the two "at C" or "group" strings into other questions' decoys.
   - Also, `Seesaw`, `T-shaped`, and `Square planar` are AP-level shapes that no listed ion has. HS students eliminate them on sight. Use `Linear`, `Bent`, `Trigonal planar`, `Trigonal pyramidal`, and `Tetrahedral` only.
3. **Orbital Builder mixes notation**, which gives the answer away.
   - Z ≤ 30 uses full notation; Z ≥ 31 uses noble-gas cores. Decoys always come from Z ≤ 36.
   - Example: "Which electron configuration belongs to Gallium?" offers `[Ar] 4s² 3d¹⁰ 4p¹` among three full-notation strings. The odd format is the answer (248 cases).
   - Fix: convert every decoy to the answer's notation (write a small `toCore(cfg)` / `toFull(cfg)`), and draw decoys from the same row ±1.
4. **Table Map "What state…?" is a 3-option question that is almost always "Solid".**
   - Of the elements with a known state, 84 are solid, 11 gas, and 2 liquid. In All 118, "Solid" is right 87% of the time.
   - Fix: switch to "Which of these is a gas at room temperature?" with 4 elements (one per state class, plus decoys from the same row). Samples are in §3, R11 (Table Map v2).
5. **f-block group question can mark a textbook answer wrong.**
   - La and Ac (stored as group `f-block`) can get `3` as a decoy. Many HS periodic tables still put La and Ac in group 3.
   - Fix: never offer `3` as a decoy for f-block cards.
6. **Two-option questions** (Family Sort: cation/anion, stable/radioactive) are 50/50 coin flips, and there are 1,346 of them in the scan. They're fine as a warm-up, but in Mixed Pack, add a 4-option variant: "Which of these is an anion?" (1 anion + 3 cations). The same works for isotopes ("Which is radioactive?").
7. **Weak decoys.**
   - Family Sort for elements draws three random families (Hydrogen vs "Lanthanide"). Draw from neighbouring families instead (`Nonmetal`, `Halogen`, `Noble Gas`, `Metalloid` for p-block; `Alkali`, `Alkaline Earth`, `Transition` for s/d).
   - Group decoys are ±4 numbers. Use a commonly confused group instead (1 ↔ 2, 17 ↔ 18, 13 ↔ 3, 15 ↔ 5).
8. **Mask helper.** `mask()` only hides words starting with the full base name. Also hide the 5-letter stem ("Fluor…", "Nicke…", "Chrom…") and the symbol+charge (`Fe²⁺`).

---

## 2. New decks

Decks are filters over `ALL` (see `DECKS` in `index.html`). New card categories need a `CATS` entry and a `DATA` array.

**VS build note.** `firestore.rules` and `tests/fake/rules.js` whitelist `DECK_IDS` and `ROOM_IDS`, so each new deck or room id must be added there before it can be used in VS Arena.

### D1. Polyatomic Ions (`poly`): split from Anions, 12 → 22 cards

- **Rule:** `x.cat==='poly'`. Rename the current Anions deck to **Simple Anions** (`x.cat==='an'`, 8 cards).
- **Rooms:** Ability Match, Symbol Smash (formula ↔ name), Orbital Builder (shape), Family Sort (cation or anion), Particle Lab (atoms, charge), plus the new Formula Forge and Name Game.

The 10 new cards below were checked: mass = sum of standard atomic weights; electrons = Σ Z + 1 per negative charge.

| Name | Formula | Charge | Molar mass (g/mol) | Atoms | Electrons | Shape (VSEPR) | Ability idea |
|---|---|---|---|---|---|---|---|
| Hypochlorite Ion | ClO | 1− | 51.45 | 2 | 26 | Linear | **Bleach Base**: the active ion in household bleach (NaClO). |
| Chlorate Ion | ClO₃ | 1− | 83.45 | 4 | 42 | Trigonal pyramidal | **Oxygen Source**: KClO₃ releases O₂ when heated. |
| Perchlorate Ion | ClO₄ | 1− | 99.45 | 5 | 50 | Tetrahedral | **Rocket Oxidizer**: ammonium perchlorate fuels solid rocket boosters. |
| Cyanide Ion | CN | 1− | 26.02 | 2 | 14 | Linear | **Gold Grabber**: used to dissolve gold out of ore. Toxic. |
| Peroxide Ion | O₂ | 2− | 32.00 | 2 | 18 | Linear | **Bubble Maker**: in hydrogen peroxide (H₂O₂), which foams on cuts. |
| Hydrogen Sulfate Ion | HSO₄ | 1− | 97.06 | 6 | 50 | Tetrahedral (at S) | **Pool Acid**: sodium bisulfate lowers pool pH. |
| Chromate Ion | CrO₄ | 2− | 115.99 | 5 | 58 | Tetrahedral | **Yellow Pigment**: chromates color yellow paint. |
| Dichromate Ion | Cr₂O₇ | 2− | 215.99 | 9 | 106 | Two tetrahedra (no single VSEPR shape) | **Orange Oxidizer**: orange crystals and solutions. |
| Thiosulfate Ion | S₂O₃ | 2− | 112.12 | 5 | 58 | Tetrahedral | **Photo Fixer**: dissolves leftover silver salts in film. |
| Dihydrogen Phosphate Ion | H₂PO₄ | 1− | 96.99 | 7 | 50 | Tetrahedral (at P) | **Buffer Ion**: keeps lab buffers and cells near neutral pH. |

Dichromate has no single VSEPR shape, so give it `config:''` and exclude it from shape questions.

**Sample cards (full detail):**

- **Perchlorate Ion**, ClO₄⁻. Atoms 5, Electrons 50, Charge 1−, Tetrahedral. Ability "Rocket Oxidizer": *"Ammonium perchlorate is the oxidizer in many solid rocket boosters."*
- **Peroxide Ion**, O₂²⁻. Atoms 2, Electrons 18, Charge 2−, Linear. Ability "Bubble Maker": *"Hydrogen peroxide, H₂O₂, breaks down into water and O₂ gas, which is why it bubbles."*

### D2. Compounds (`cmp`): new category, about 30 cards

New `kind:'Compound'`. The family is one of `Ionic`, `Covalent`, `Acid`, `Base`. Stat boxes: Type, Molar mass, State.

- **Rooms:** Ability Match, Symbol Smash (formula ↔ name), Family Sort (ionic / covalent / acid / base), Particle Lab (atoms per formula), plus the new Name Game and Molar Mass.
- **Card list** (molar masses checked):
  - **Ionic:** NaCl 58.44 · CaCO₃ 100.09 · NaHCO₃ 84.01 · MgO 40.30 · CaO 56.08 · KCl 74.55 · CaCl₂ 110.98 · Fe₂O₃ 159.69 · CuSO₄ 159.60 · MgSO₄ 120.36 · Al₂O₃ 101.96 · NaClO 74.44 · AgCl 143.32 · BaSO₄ 233.38 · NaF 41.99
  - **Covalent:** H₂O 18.02 · CO₂ 44.01 · CO 28.01 · NH₃ 17.03 · CH₄ 16.04 · H₂O₂ 34.01 · O₃ 48.00 · SiO₂ 60.08 · C₆H₁₂O₆ 180.16 · C₂H₅OH 46.07
  - **Acids:** HCl 36.46 · H₂SO₄ 98.07
  - **Bases:** NaOH 40.00
- **Sample cards:**
  - **Sodium Bicarbonate**, NaHCO₃, Ionic, 84.01 g/mol, Solid. Ability "Rising Agent": *"Baking soda. Releases CO₂ gas with acid, which makes batter rise."*
  - **Calcium Carbonate**, CaCO₃, Ionic, 100.09 g/mol, Solid. Ability "Shell Stone": *"Limestone, chalk, marble and seashells. Fizzes in acid."*
  - **Ozone**, O₃, Covalent, 48.00 g/mol, Gas. Ability "Sky Shield": *"High in the stratosphere it absorbs harmful UV light."*
  - **Glucose**, C₆H₁₂O₆, Covalent, 180.16 g/mol, Solid. Ability "Cell Fuel": *"The sugar cells break down in respiration for energy."*

### D3. Main Group (existing cards, 34)

- **Rule:** `x.cat==='el' && x.zn<=54 && ['1','2','13','14','15','16','17','18'].includes(x.s1v)`. This is groups 1, 2, 13–18 in periods 1–5.
- **Rooms:** every element room, plus Ion Maker, Trend Duel, Bohr Builder (Z ≤ 20 only), and Metal Detector. This is the deck HS chemistry tests most.
- **Sample cards:** Sodium (group 1, period 3), Phosphorus (group 15), Bromine (group 17, liquid), Tin (group 14, metal).

### D4. Everyday Elements (existing cards, 32, curated)

- **Rule (id list):** H, He, C, N, O, F, Ne, Na, Mg, Al, Si, P, S, Cl, Ar, K, Ca, Ti, Cr, Fe, Ni, Cu, Zn, Ag, Sn, I, W, Pt, Au, Hg, Pb, U.
- **Rooms:** Ability Match (uses lines like "Can Coater" and "Tooth Guard" fit), Symbol Smash, Number Crunch, Table Map, Family Sort, Metal Detector.
- **Why:** a friendlier second deck than "Row 4", and it builds on the real-world uses already written on the cards.

### D5. Radioactive & Nuclear (existing + new isotopes)

- **Rule:** the 12 existing radioisotopes, plus elements with bracketed masses that are natural or used (Tc, Pm, Po, Rn, Ra, U, Pu, Am), plus the new isotopes below.
- **Rooms:** Ability Match, Family Sort (stable vs radioactive), Particle Lab, plus the new Decay Lab and Half-Life.
- **New isotope cards** (A − Z checked; half-lives are standard rounded values):

| Isotope | p | n | Family | Half-life | Ability idea |
|---|---|---|---|---|---|
| Nitrogen-14 | 7 | 7 | Stable | – | **Air Main**: 99.6% of nitrogen. |
| Nitrogen-15 | 7 | 8 | Stable | – | **Tracer N**: about 0.4% of nitrogen; traces fertilizer uptake. |
| Fluorine-18 | 9 | 9 | Radioisotope | 110 minutes | **PET Scan**: tracer in PET scans. |
| Phosphorus-32 | 15 | 17 | Radioisotope | 14.3 days | **DNA Label**: labels DNA in lab experiments. |
| Iron-56 | 26 | 30 | Stable | – | **Star Ash**: about 92% of iron. |
| Technetium-99m | 43 | 56 | Radioisotope | 6.0 hours | **Medical Imaging**: the most-used medical radioisotope. |
| Polonium-210 | 84 | 126 | Radioisotope | 138 days | **Alpha Source**: strong alpha emitter. |
| Plutonium-239 | 94 | 145 | Radioisotope | 24,100 years | **Reactor Fuel**: fissile; made from U-238 in reactors. |
| Thorium-232 | 90 | 142 | Radioisotope | 14 billion years | **Slow Clock**: almost all natural thorium. |

### D6. Hall of Names (history; existing elements, 34)

- **Rule (id list):**
  - Named for **people:** Cm, Es, Fm, Md, No, Lr, Rf, Sg, Bh, Mt, Rg, Cn, Og.
  - Named for **places:** Ga, Ge, Po, Fr, Am, Bk, Cf, Db, Hs, Ds, Nh, Fl, Mc, Lv, Ts, Eu, Sc.
  - Named for **Ytterby** (the Swedish village): Y, Tb, Er, Yb.
- **New room: Namesake.** "Which element is named for the city of Berkeley, California?" → **Berkelium** (decoys: Californium, Americium, Livermorium).
- Text only. No portraits of real people.

### D7. All Ions (existing, 40)

- **Rule:** `cat`, `an`, and `poly` together. This deck feeds Formula Forge and Name Game, which need both cations and anions in one pool.

---

## 3. New rooms and question types

Effort key:

- **S** (small): only a new `GEN.<type>` function and a `ROOMS` entry, using existing data.
- **M** (medium): also needs a new data field or a small table.
- **L** (large): needs a new data set plus a new clue UI.

Every sample below was checked by hand. Answers are in **bold**; decoys follow.

### R1. Ion Maker (valence electrons + predict the ion). Easy. Effort S.

- **How it works.** Main-group elements only:
  - Valence electrons = group number (1–2), or group − 10 (13–18). Helium is 2.
  - Ion: groups 1, 2, and Al (13) form +1, +2, +3. Groups 15, 16, 17 form 3−, 2−, 1− (N, P, O, S, Se, F, Cl, Br, I).
  - Skip C, Si, Ge, B, the noble gases, and post-transition metals, which have no single common ion.
- **Decoys.** Use the group number itself (13 instead of 3), the "8 − v" mirror, and the wrong sign.

| Prompt | Answer | Decoys |
|---|---|---|
| How many valence electrons does oxygen have? | **6** | 2, 8, 16 |
| How many valence electrons does aluminum have? | **3** | 13, 5, 2 |
| How many valence electrons does helium have? | **2** | 8, 18, 1 |
| How many valence electrons does chlorine have? | **7** | 17, 1, 8 |
| What ion does magnesium usually form? | **Mg²⁺** | Mg⁺, Mg²⁻, Mg⁶⁻ |
| What ion does nitrogen usually form? | **N³⁻** | N⁵⁺, N³⁺, N⁵⁻ |
| What ion does sodium usually form? | **Na⁺** | Na⁻, Na²⁺, Na⁷⁻ |
| What ion does selenium usually form? | **Se²⁻** | Se²⁺, Se⁶⁺, Se⁶⁻ |
| How many electrons does calcium lose to form its ion? | **2** | 1, 6, 20 |

- **Explanation template:** "Chlorine is in group 17, so it has 7 valence electrons. It gains 1 to reach 8, making Cl⁻."

### R2. Formula Forge (ionic formula builder). Medium. Effort M.

- **How it works.**
  - Pair a cation and an anion from the All Ions deck. The charges come from `post`.
  - The correct formula is the criss-cross reduced by the GCD. Wrap polyatomic ions in parentheses when their subscript is greater than 1.
  - Decoys:
    - subscripts swapped
    - 1:1 when the right ratio isn't 1:1
    - missing parentheses (CaNO₃₂ is unreadable, so use Ca(NO₃)₃ or Ca₂NO₃)
    - wrong ratio
- **Clue:** both ion tiles side by side.

| Prompt | Answer | Decoys |
|---|---|---|
| Na⁺ + Cl⁻ → ? | **NaCl** | NaCl₂, Na₂Cl, Na₃Cl |
| Mg²⁺ + Cl⁻ → ? | **MgCl₂** | MgCl, Mg₂Cl, Mg₂Cl₃ |
| Al³⁺ + O²⁻ → ? | **Al₂O₃** | AlO, Al₃O₂, AlO₃ |
| Ca²⁺ + NO₃⁻ → ? | **Ca(NO₃)₂** | CaNO₃, Ca₂NO₃, Ca(NO₃)₃ |
| NH₄⁺ + SO₄²⁻ → ? | **(NH₄)₂SO₄** | NH₄SO₄, NH₄(SO₄)₂, (NH₄)₃SO₄ |
| Ca²⁺ + PO₄³⁻ → ? | **Ca₃(PO₄)₂** | Ca₂(PO₄)₃, CaPO₄, Ca₃PO₄ |
| Fe³⁺ + Cl⁻ → ? | **FeCl₃** | FeCl, Fe₃Cl, FeCl₂ |
| Mg²⁺ + N³⁻ → ? | **Mg₃N₂** | Mg₂N₃, MgN, Mg₃N |
| Cu²⁺ + OH⁻ → ? | **Cu(OH)₂** | CuOH, Cu₂OH, CuOH₂ |

- **Explanation template:** "Ca²⁺ needs to balance PO₄³⁻: 3 × (+2) = +6 and 2 × (−3) = −6, so Ca₃(PO₄)₂."

### R3. Name Game (naming ionic and simple covalent compounds). Medium. Effort M.

- **How it works.**
  - **Ionic** names come from the same ion pairs: the cation name + the anion name. Use Roman numerals for Fe, Cu, Pb, Sn, Mn, Cr, Ni.
  - **Covalent** names come from a curated list with prefixes.
  - Decoys: the wrong Roman numeral, -ide/-ate/-ite swaps, element name instead of ion name ("chlorine"), and look-alike elements.

| Prompt | Answer | Decoys |
|---|---|---|
| Name FeCl₂ | **Iron(II) chloride** | Iron(III) chloride, Iron(II) chlorate, Iron chlorine |
| Name CuSO₄ | **Copper(II) sulfate** | Copper(I) sulfate, Copper(II) sulfite, Copper(II) sulfide |
| Name K₂S | **Potassium sulfide** | Potassium sulfate, Potassium sulfite, Phosphorus sulfide |
| Name NH₄NO₃ | **Ammonium nitrate** | Ammonium nitrite, Ammonium nitride, Ammonia nitrate |
| Name Fe₂O₃ | **Iron(III) oxide** | Iron(II) oxide, Iron(III) hydroxide, Iron(III) peroxide |
| Name N₂O₄ | **Dinitrogen tetroxide** | Nitrogen tetroxide, Dinitrogen pentoxide, Dinitrogen trioxide |
| Name CCl₄ | **Carbon tetrachloride** | Carbon chloride, Calcium tetrachloride, Tetracarbon chloride |
| Name SF₆ | **Sulfur hexafluoride** | Sulfur pentafluoride, Sulfide hexafluoride, Hexasulfur fluoride |
| Name CO | **Carbon monoxide** | Carbon dioxide, Carbonate, Monocarbon oxide |

### R4. Trend Duel (periodic trends). Medium. Effort M.

- **How it works.** "Which has the largest atomic radius / highest electronegativity / highest first ionization energy / most metallic character?" with 4 elements from one group or one period.
- Add a small table for main-group Z ≤ 56:
  - Pauling electronegativity (`en`)
  - atomic radius in pm (`rad`)
  - first ionization energy in kJ/mol (`ie1`)
- Only build pairs and sets where the gap is at least 10% (radius, IE) or at least 0.3 (EN). That automatically avoids the known exceptions (N vs O, Be vs B, Mg vs Al for IE).
- Skip noble gases for electronegativity.
- Also include **ion size**, for isoelectronic sets and atom vs ion.

| Prompt | Answer | Decoys | Why |
|---|---|---|---|
| Largest atomic radius? | **Rb** | Li, Na, K | Down a group, more shells. |
| Smallest atomic radius? | **Cl** | Na, Mg, P | Across a period, more protons pull harder. |
| Highest electronegativity? | **F** (3.98) | Cl, Br, I | Top of group 17. |
| Highest electronegativity? | **O** (3.44) | B, C, N | Right side of period 2. |
| Highest first ionization energy? | **Ne** (2081 kJ/mol) | Li, Be, F | Full shell, far right. |
| Lowest first ionization energy? | **Cs** (376 kJ/mol) | Na, Mg, Cl | Bottom left. |
| Most metallic? | **Cs** | Al, Si, P | Bottom left. |
| Which is larger? | **Cl⁻** | Cl | An added electron spreads the cloud. |
| Largest of these ions (all have 10 electrons)? | **O²⁻** | F⁻, Na⁺, Mg²⁺ | Fewest protons for the same electrons. |

### R5. Review Room ("Missed It"). Easy. Effort S.

- **How it works.**
  - Pool = the cards with `S.miss[id] > 0` in the current deck, sorted by miss count.
  - Questions use the room type the card was missed in (or Mixed).
  - Disabled with "No misses yet. Nice." until at least 3 misses exist (uses change 3 of the UX spec).
- Clearing a card from review: answer it right twice in Review, then decrement `S.miss`.
- **Sample:** a student who missed Bromine (state) and Sodium Ion (electrons) gets those cards back in Table Map / Particle Lab form, e.g. "How many electrons does Sodium Ion have?" → **10** (decoys 11, 12, 9).

### R6. Decay Lab (nuclear decay + half-life). Medium. Effort M.

- **How it works.**
  - α decay: Z − 2, A − 4.
  - β⁻ decay: Z + 1, A same.
  - Add `decay:'alpha'|'beta'` and `half:{v,unit}` to the isotope cards.
  - Half-life questions use 1–3 half-lives with numbers that divide cleanly.
  - Decoys: the wrong direction (Z + 2), a mass change on β, Z − 4.

| Prompt | Answer | Decoys |
|---|---|---|
| Uranium-238 undergoes alpha decay. What forms? | **Thorium-234** | Protactinium-234, Uranium-234, Radium-234 |
| Carbon-14 undergoes beta decay. What forms? | **Nitrogen-14** | Boron-14, Carbon-13, Nitrogen-15 |
| Radium-226 undergoes alpha decay. What forms? | **Radon-222** | Radon-226, Thorium-230, Francium-222 |
| Iodine-131 undergoes beta decay. What forms? | **Xenon-131** | Tellurium-131, Iodine-130, Xenon-132 |
| Cobalt-60 undergoes beta decay. What forms? | **Nickel-60** | Iron-60, Cobalt-59, Nickel-61 |
| You start with 80 g of I-131 (half-life 8 days). How much is left after 16 days? | **20 g** | 40 g, 10 g, 0 g |
| A bone has 25% of its original C-14 (half-life 5,730 years). About how old is it? | **11,460 years** | 5,730 years, 17,190 years, 22,920 years |
| What fraction of Rn-222 (half-life 3.8 days) is left after 7.6 days? | **1/4** | 1/2, 1/8, 3/4 |
| 1/8 of a Sr-90 sample (half-life 29 years) remains. About how much time passed? | **87 years** | 29 years, 58 years, 232 years |

- **Safety framing:** keep the medical and energy uses on the cards. No weapons content.

### R7. Bohr Builder (shell diagrams). Easy. Effort S.

- **How it works.** Show a Bohr diagram: the existing `atomArt()` already draws shells from `it.shells`.
  - Ask "Which element is this?" or "How many electrons are in the outer shell?"
  - Z ≤ 20 only, where 2-8-8 shells match the HS model.
  - Decoys: same total ±1, or the same outer shell in another period.

| Clue (shells) | Answer | Decoys |
|---|---|---|
| 2, 8, 1 | **Sodium** | Lithium, Magnesium, Neon |
| 2, 6 | **Oxygen** | Carbon, Sulfur, Neon |
| 2, 8, 8, 2 | **Calcium** | Magnesium, Argon, Potassium |
| 2, 8, 7 | **Chlorine** | Fluorine, Argon, Sulfur |
| 2, 4 | **Carbon** | Silicon, Beryllium, Oxygen |
| 2 | **Helium** | Hydrogen, Lithium, Neon |
| Outer-shell electrons in 2, 8, 5 (phosphorus) | **5** | 3, 8, 15 |

### R8. Equation Balancer. Medium. Effort M.

- **How it works.** Use a curated list of about 30 balanced equations. One coefficient is blanked; options are 1–6. Decoys are nearby integers and the coefficient from an unbalanced version.

| Prompt | Answer | Decoys | Check |
|---|---|---|---|
| __ H₂ + O₂ → 2 H₂O | **2** | 1, 3, 4 | H 4 = 4, O 2 = 2 |
| N₂ + __ H₂ → 2 NH₃ | **3** | 1, 2, 6 | N 2 = 2, H 6 = 6 |
| CH₄ + __ O₂ → CO₂ + 2 H₂O | **2** | 1, 3, 4 | O 4 = 2 + 2 |
| 4 Fe + __ O₂ → 2 Fe₂O₃ | **3** | 2, 4, 6 | O 6 = 6 |
| C₃H₈ + __ O₂ → 3 CO₂ + 4 H₂O | **5** | 3, 4, 7 | O 10 = 6 + 4 |
| 2 KClO₃ → 2 KCl + __ O₂ | **3** | 1, 2, 6 | O 6 = 6 |
| __ H₂O₂ → 2 H₂O + O₂ | **2** | 1, 3, 4 | O 4 = 2 + 2 |
| 2 Mg + O₂ → __ MgO | **2** | 1, 3, 4 | Mg 2, O 2 |

### R9. Molar Mass Rush. Medium–hard. Effort M (needs the Compounds deck).

- **How it works.** Use the standard atomic weights already on the cards. Answers have 2 decimals.
- Decoys:
  - a missing subscript
  - a related species (OH, CO, O₂)
  - doubling an atom wrongly
  - another compound in the deck

| Prompt | Answer | Decoys |
|---|---|---|
| Molar mass of H₂O | **18.02 g/mol** | 17.01, 34.01, 16.00 |
| Molar mass of CO₂ | **44.01 g/mol** | 28.01, 32.00, 60.01 |
| Molar mass of NaCl | **58.44 g/mol** | 35.45, 22.99, 93.89 |
| Molar mass of CH₄ | **16.04 g/mol** | 13.02, 28.05, 30.07 |
| Molar mass of CaCO₃ | **100.09 g/mol** | 84.01, 56.08, 68.09 |
| Molar mass of O₂ | **32.00 g/mol** | 16.00, 48.00, 28.01 |

### R10. Metal Detector (metal / nonmetal / metalloid, odd-one-out). Easy. Effort S.

- **How it works.** Derive the class from `family`:
  - **Metalloid:** the Metalloid family.
  - **Nonmetal:** Nonmetal, Halogen, Noble Gas.
  - **Metal:** everything else.
- Exclude At, Ts, and Z ≥ 104 (unknown classification). The question is 4-option, "Which one is a ___?", which fixes the 3-option problem.

| Prompt | Answer | Decoys |
|---|---|---|
| Which one is a metalloid? | **Silicon** | Sodium, Chlorine, Argon |
| Which one is a metalloid? | **Boron** | Beryllium, Carbon, Nitrogen |
| Which one is a metalloid? | **Germanium** | Gallium, Selenium, Krypton |
| Which one is a nonmetal? | **Sulfur** | Magnesium, Iron, Aluminum |
| Which one is a nonmetal? | **Bromine** | Barium, Bismuth, Beryllium |
| Which one is a metal? | **Tin** | Silicon, Selenium, Sulfur |

### R11. Table Map v2 (replaces the 3-option state question). Easy. Effort S.

| Prompt | Answer | Decoys |
|---|---|---|
| Which of these is a liquid at room temperature? | **Bromine** | Iodine, Chlorine, Sodium |
| Which of these is a gas at room temperature? | **Neon** | Sodium, Silicon, Sulfur |
| Which of these is a solid at room temperature? | **Iodine** | Bromine, Chlorine, Fluorine |
| Which metal is a liquid at room temperature? | **Mercury** | Gallium, Cesium, Tin |
| Which of these is a gas at room temperature? | **Nitrogen** | Carbon, Phosphorus, Boron |

Gallium (melts at 29.8 °C) and cesium (28.5 °C) are good decoys: they're solid at room temperature (about 20–25 °C) but melt just above it.

### R12. Namesake (history). Easy. Effort S (needs the Hall of Names deck text).

| Prompt | Answer | Decoys |
|---|---|---|
| Which element is named for the city of Berkeley, California? | **Berkelium** | Californium, Americium, Livermorium |
| Which element is named for Dmitri Mendeleev? | **Mendelevium** | Meitnerium, Einsteinium, Nobelium |
| Which element is named for Japan? | **Nihonium** | Moscovium, Tennessine, Flerovium |
| Which element is named for Marie and Pierre Curie? | **Curium** | Copernicium, Polonium, Americium |
| Which element is named for Poland? | **Polonium** | Francium, Germanium, Europium |

Polonium was named by Marie Curie for her homeland.

### VS compatibility

Rooms R1, R2, R3, R4, R7, R8, R10, and R11 are deterministic given the seed, so they work in VS Arena through `buildRound`. Add their ids to `ROOM_IDS` in `firestore.rules`, `tests/fake/rules.js`, and the room select in `vs.js`.

R5 Review is personal and **solo only**.

---

## 4. Binder, collectibles and progression

Everything below is classroom-safe. Nothing is bought, nothing pays out at random from spending, there's no chat, and no real-person art.

1. **Recipe cards (compounds unlocked by ions).**
   - Owning both ions in a pair unlocks its compound card in the binder, e.g. Na⁺ + Cl⁻ → **Table Salt (NaCl)**, Ca²⁺ + CO₃²⁻ → **Chalk (CaCO₃)**, Mg²⁺ + SO₄²⁻ → **Epsom Salt (MgSO₄)**.
   - This teaches formula building through collecting. Effort M; it needs the Compounds deck.
2. **Sets with a set badge and a one-time +50 XP.** Each completed set gets a gold border on its binder tab. Effort S.
   - Noble Gas Squad: He, Ne, Ar, Kr, Xe, Rn
   - Halogen Crew: F, Cl, Br, I
   - Alkali Crew: Li to Cs
   - Isotope Twins: Cl-35 + Cl-37, B-10 + B-11, Li-6 + Li-7
   - Row 2 Complete
   - Hydrogen Trio: H-1, H-2, H-3
   - Liquids Club: Br, Hg
   - Ion Pairs
3. **Badges (achievements).** Stored as a small map in `progress` (another rules whitelist key). Shown on the account screen. Effort S–M.
   - Perfect Round
   - Streak ×10
   - Five 3-star rooms
   - First Gold Legend card
   - Binder 50 / 100 / 183
   - First VS win
   - Review Room cleared
4. **Element of the Day.**
   - The date seeds one element, the same for the whole class, with no server needed.
   - The first correct answer on it that day gives ×2 card XP, and it is highlighted on Home.
   - Keep it gentle: no streak-loss penalty.
   - Effort S.
5. **Rare variant: "Discovery" frame.** A card reached at the 15-correct Gold Legend tier also shows its discovery year and place (text only), e.g. "Oxygen · 1774". This adds history without portraits. Effort S (needs a `year` field).
6. **Progress by curriculum unit.** Show deck mastery on Home as "Atoms ✓ · Ions 60% · Compounds 10%", grouping decks by unit. Effort S.

---

## 5. Full ranking

**Quick wins (≤ 1 day each, existing data):**

1. Content bug fixes (§1): ion neutron explanations, Ability Match 4th option, shape ambiguity, notation mixing, f-block "3", mask stems and symbols, "1 protons", isotope mass display, duplicate ability names, Anions deck split.
2. **Ion Maker** room (R1).
3. **Review Room** (R5).
4. **Table Map v2** and **Metal Detector** (R10, R11).
5. **Main Group** deck (D3) and **Everyday Elements** deck (D4). These are filter-only decks.
6. **Bohr Builder** (R7).
7. Sets, badges, and Element of the Day (§4: items 2, 3, 4).

**Medium builds (1–2 days):**

8. **Polyatomic Ions** deck expansion (D1) + **All Ions** deck (D7) + **Formula Forge** (R2).
9. **Trend Duel** (R4), with a 50-element EN/radius/IE table.
10. **Decay Lab** (R6), with decay mode and half-life fields on isotopes, plus the new isotope cards (D5).
11. **Name Game** (R3).

**Bigger builds:**

12. **Compounds** category (D2) + **Molar Mass** (R9) + **Recipe cards** (§4, item 1).
13. **Equation Balancer** (R8), with a curated equation list.
14. **Hall of Names** deck + **Namesake** room (D6, R12), plus the Discovery frame.

**Build notes common to everything:**

- New deck and room ids must be added to `DECK_IDS` and `ROOM_IDS` in `firestore.rules` and `tests/fake/rules.js` before VS can use them.
- The binder count `0/183` comes from `ALL.length` and grows automatically.
- New `progress` keys (badges, sets) need the `/players` progress whitelist and `cloud.js` `EMPTY`/`merge` updated, the same pattern as `progress.icon` in `ux-spec.md`.
