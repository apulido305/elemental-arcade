# Elemental Arcade: UX spec and profile icon set

Branch `ux-icons`. Design only: no application code was changed. A dev agent can build from this file without asking questions.

Players are high school students. Nicknames only, no chat, no free-text profile fields. Keep the arcade cabinet (navy, gold, cream, Lilita One / Atkinson Hyperlegible / DM Mono). Everything below is rearranging, labeling and empty states, plus one new preset-only picker.

## How this was reviewed (read first)

- **Live site not reachable.** The sandbox proxy blocked `apulido305.github.io` (`ERR_TUNNEL_CONNECTION_FAILED`). I reviewed `index.html`, `vs.js`, `cloud.js`, `firestore.rules` and `README.md` from `main` (`05d0c55`) and screenshotted a local copy of that same commit at 390 px and 1100 px.
- **Firebase was not available.** Signed-in and VS screens came from the repo's own fake Firebase backend (`tests/fake`), not real Firebase. VS screens (lobby, join, ladder, podium) are the existing `docs/vs-arena/*-390.png` and `*-1100.png` captures from that same harness.
- **Fonts.** My solo-screen captures in `design/shots/` used fallback fonts (Google Fonts stubbed), so line heights differ slightly from the live look. Layout, order and sizes are accurate.
- Measured at 390 px: guest home is **2,217 px tall**, signed-in home **2,344 px**. No horizontal scroll on home. The header takes three rows (about 190 px) before the first action.
- Screenshots: `design/shots/` (`home-guest`, `home-signed-in`, `disabled-room`, `question`, `feedback`, `binder`, `signin`, `account`, each `-390` and `-1100`).

---

# Part 1. UX/UI changes (ranked)

Global phone rule for every change: 390 px wide, no horizontal page scroll, every tap target at least 44 px tall. Today `.iconbtn` is 40 px, `.btn.small` 38 px, `.tab` and `.chip` are also under 44 px; raise all four to `min-height:44px` at `max-width:520px`.

## 1. Home: add "Play now" and number the steps

- **Problem.** A new student faces deck chips, then eight tall room tiles (about 130 px each, over 1,100 px of scrolling at 390 px) before they understand that deck + room = a 10-question round. Chips wrap ragged (2, 3, 2, 2, 1 per row).
- **Change.**
  1. New "Play now" card above the decks: "Starter 20 · Mixed Pack" and a gold **Play** button (10 questions). It uses the current `S.deck` and a new remembered room `S.room` (saved with the prefs, default `mixed`). Tapping a room tile or changing the deck updates it.
  2. Number the headings: "1 Pick a deck", "2 Pick a room". The Play now card is the shortcut for students who do not want to choose.
  3. Move the footer sentence "Rounds are 10 questions…" to a one-line sub under "Play now".
  4. At `max-width:520px`: deck chips become a 2-column grid of equal-width chips (the last odd chip spans both columns); room tiles become a 2-column grid with a compact band (56 px tall, glyph 28 px, stars 14 px), name 17 px, description 13 px clamped to 2 lines.
- **Screen.** Home (`homeHTML`, `.decks`, `.rooms`).
- **Phone.** 2 columns gives tiles about 173 px wide and about 120 px tall; target home height is under 1,400 px. Chips and tiles are far above 44 px. No horizontal scroll: grids use `minmax(0,1fr)`.

## 2. Question feedback: sticky Next, and not color-only

- **Problem.** After an answer, **Next** sits at the bottom of the feedback box. On a wrong answer the card is dealt inline (240 px wide, 336 px tall), so Next ends up well below the options and the student scrolls to continue. Right and wrong are shown only by green and red.
- **Change.**
  1. When `V.pick != null`, render Next in a bar pinned to the bottom of the viewport: `position:sticky; bottom:0`, full-width button at 56 px tall on phones, padding `env(safe-area-inset-bottom)`, navy backdrop so options never sit under it. It appears with no slide (opacity only, at most 120 ms).
  2. Right and wrong options show a glyph in the `.key` chip (check or cross, drawn as inline SVG) in addition to color. The feedback heading gets the same glyph.
  3. After answering, scroll the feedback heading into view with `block:'nearest'`, `behavior: RM.matches ? 'auto' : 'smooth'`. Focus still goes to Next (already done).
  4. Keep the inline card on wrong answers; it now sits above a Next button that is always reachable.
  5. VS reveal screen: no change to the timer ring (64 px, already clear). Keep as is.
- **Screen.** Quiz (`quizHTML`), `.fb`.
- **Phone.** Sticky bar button is full width and at least 56 px. Add `padding-bottom` to the panel equal to the bar height so the last content is not hidden.

## 3. Top bar: two rows, one account control, icon-only Sound

- **Problem.** Level title, Sign in, Binder and Sound are four equal pills that wrap into three rows at 390 px (about 190 px). Sign in and Sound look as important as Binder, and the VS record is far away from VS Arena.
- **Change.** Two rows.
  - Row 1: logo on the left; on the right an **avatar button** (44 px: icon at 28 px plus nickname, or "Guest" when signed out; opens Account / Sign in) and a **Sound** toggle that is a 44×44 speaker icon with `aria-pressed` and `aria-label="Sound on"` / `"Sound off"`.
  - Row 2: icon button (see Part 2, opens the picker) + "Lv 1 · Proton Pupil" + XP bar, and on the right a **Binder 0/183** pill.
  - VS record moves into the VS Arena button subline: "VS 4-1 · streak 2" replaces "Live, up to 20 players" once `S.vs.played > 0` and signed in. Full record stays on the account screen.
- **Screen.** Header (`topHTML`) on every screen; VS button (`vsHTML`).
- **Phone.** Target header height about 112 px. Row 2 wraps level text, never the pill: level text `min-width:0` with ellipsis, XP bar `flex:1`, pills `flex:none`. Avatar and Sound are 44×44.

## 4. Disabled rooms look available (and Mixed Pack looks disabled)

- **Problem.** Particle Lab on Starter 20, and Number Crunch and Table Map on Cations, keep their full-color band at 42% opacity, with small text "Not available in this deck." They still look tappable and a tap does nothing. Meanwhile **Mixed Pack** uses the grey `Blank` theme, so it looks disabled even though it is playable (visible in `design/shots/home-signed-in-390.png`).
- **Change.**
  1. Unavailable rooms: sort them to the end of the grid, drop the colored band to flat `--panel` with a lock glyph in place of the room glyph, no stars, and `aria-disabled="true"` instead of the `disabled` attribute (so a tap can answer).
  2. Tapping an unavailable room shows an inline status line above the grid (`role="status"`, no animation): "Particle Lab needs element cards. Try Starter 20 or All 118." The hint text per room comes from a one-line map added next to `ROOMS` (`needs: 'element cards'`).
  3. Mixed Pack gets a gold band (use the `Halogen` theme colors or `--gold`) so it reads as the "play everything" tile.
- **Screen.** Home rooms.
- **Phone.** The whole locked tile stays a 44 px+ target; the status line wraps and never scrolls sideways.

## 5. Guest vs signed-in: say where progress lives

- **Problem.** A guest sees "Sign in" and nothing about what that buys them. "Progress and cards are saved on this device" appears only in the footer of home. Results and binder never say it. The VS guest screen says "Nothing is saved to an account" but solo play does not.
- **Change.**
  1. Avatar button (change 3) shows a small **Guest** tag when signed out.
  2. A one-line notice under the header for guests only: "Guest: your cards stay on this device. Sign in to keep them on any device." with a Sign in text-button. Show it on home and on the results screen after the first completed round (`S.rounds > 0`). Dismiss per session, never as a modal, never blocking play.
  3. Binder empty state when `ownedCount(ALL) === 0`: a short panel above the grid, "Your binder is empty. Win a card by answering correctly in any room." with a **Play now** button. Locked slots stay below it.
  4. Account screen for guests: add a summary line "On this device: N cards, Lv X" above the form (reuse `guestCount()`).
- **Screen.** Home, results, binder, account (signed-out).
- **Phone.** Notice is one to two lines, 44 px Sign in button inside it, full width.

## 6. Results: put the next step where the student is looking

- **Problem.** "Play again", "Pick a room" and "Open binder" are the last items on a screen that can run several phone-heights (stats, level up, leveled cards, a pack of new cards, review chips). Nothing says how close the student was to the next star.
- **Change.**
  1. Reuse the sticky bottom bar from change 2: **Play again** (primary) and **Pick a room** (ghost), side by side on phones.
  2. Move "Open binder" into the "New cards won" section header as "See in binder".
  3. One line under the stars, from the existing thresholds (9 of 10 = 3 stars, 7 = 2, 5 = 1): "Next star: 9 of 10 correct" (omit at 3 stars).
  4. Missed cards stay as "Review these" chips (already good).
- **Screen.** Results (`resultsHTML`).
- **Phone.** Bar buttons are at least 52 px and share the width; content gets matching bottom padding.

## 7. VS Arena on a phone: join, lobby, ladder, podium

- **Problem.** Join and host panels stack with equal weight, so a guest scrolls past Host to nothing. The lobby name list is a wrapping cloud of chips (3 to 4 per row, uneven). The ladder row status words ("thinking", "answered") eat the name width. The podium page is long: the answers table and the field table both open.
- **Change.**
  1. **Join screen.** Join panel first. Guest identity becomes one 44 px row: icon + generated name + **Shuffle name**, with **Change icon** opening the picker inline (Part 2). The Host panel becomes a closed `<details>` for guests ("Host an arena (needs sign-in)", 44 px summary); stays open for signed-in students.
  2. **Arena code.** Keep `.vs-bigcode` (clamp 44 to 84 px, mono). Add `font-variant-ligatures:none` and render as two groups of three ("VQ8 FJU") with a thin gap, so it is easy to read aloud. Must stay on one line at 320 px (6 glyphs: about 220 px at 390 px, under 230 px at 320 px).
  3. **Lobby list.** Replace chips with a 2-column grid of 44 px rows (icon 28 + nickname with ellipsis + Host or Guest tag). Heading shows "In the arena 10/20". 20 players = 10 rows = about 440 px, host first. New joiners fade in over 120 ms at most.
  4. **Ladder.** Keep the existing top 5 + your row collapse above 6 players. Add the icon (28 px) before the name. At `max-width:520px` replace the words "thinking" with a 8 px grey dot and "answered" with a check glyph.
  5. **Podium.** Icons above names (see Part 2). Wrap "Your answers" in a `<details>` closed on phones; "The field" rows gain icons.
- **Screen.** `vs.js`: `menuHTML`, `lobbyHTML`, `updateLobby`, `renderLadder`, `resultHTML`.
- **Phone.** All rows are at least 44 px. Names use `text-overflow:ellipsis`; tags never wrap. `#vs` has no horizontal scroll (the repo's `layoutProblems()` check already asserts this).

## 8. Motion budget

- **Problem.** The `prefers-reduced-motion` rules exist (CSS and `RM` in JS) and should stay. But room tiles stagger 45 ms each plus 100 ms (up to about 415 ms) on every return to home, and every new element added by this spec could add more.
- **Change.**
  1. Cap the home stagger at 200 ms total, and run `.enter` on the first home view of a session only.
  2. All new UI (sticky bar, notice, disabled-room status, picker selection) uses opacity only, 120 ms or less, no transforms that move a tap target.
  3. Selection ring in the picker changes instantly.
  4. Add a test: emulate `reducedMotion:'reduce'` and assert computed `animation-duration` of new elements is at most 0.01 ms.
- **Screen.** Home, quiz, picker, VS.
- **Phone.** Nothing animates under a finger: animations never apply to `.btn`, `.opt`, `.room`, `.deck` while they are pressed.

---

# Part 2. Profile icons

Sixteen preset icons. Signed-in students and guests use the same picker. Guests have no free-text name, so the icon is their personal bit. No upload, no drawing, no emoji keyboard.

## The set

Cast: elements, lab, arcade. I kept the suggested 16 and drew them as distinct silhouettes (round, tall, wide, wedge, U-shaped, crescent), not circles in different colors. Four accents each, all from the existing palette.

| # | id | Label | Accent |
|---|----|-------|--------|
| 1 | `atom` | Atom | `sky` |
| 2 | `bolt` | Bolt | `gold` |
| 3 | `beaker` | Beaker | `good` |
| 4 | `crystal` | Crystal | `good` |
| 5 | `flame` | Flame | `rose` |
| 6 | `droplet` | Droplet | `sky` |
| 7 | `magnet` | Magnet | `rose` |
| 8 | `moon` | Moon | `gold` |
| 9 | `star` | Star | `gold` |
| 10 | `comet` | Comet | `sky` |
| 11 | `rocket` | Rocket | `rose` |
| 12 | `flask` | Flask | `rose` |
| 13 | `crown` | Crown | `gold` |
| 14 | `shield` | Shield | `good` |
| 15 | `spark` | Spark | `good` |
| 16 | `wave` | Wave | `sky` |

Default if never picked: `atom`.

Rules every icon follows: single flat inline SVG, `viewBox="0 0 64 64"`, 2 px stroke in gold `#f3dd7a` or cream `#fdf6d8`, one accent fill (`gold #f3dd7a`, `sky #7fd1f0`, `rose #f2a8a3`, `good #4caf62`), no gradients, no filters, no external images, nothing inside 4 px of the edge. Classroom-safe: no weapons, no people, no brands.

Contact sheet (4×4, row-major, the order in the table above): row 1 atom, bolt, beaker, crystal; row 2 flame, droplet, magnet, moon; row 3 star, comet, rocket, flask; row 4 crown, shield, spark, wave. A rendered sheet at 64 px (left) and the first eight at 28 px on a navy nameplate row (right) is in `design/icons-contact-sheet.png`. I checked it at 2× pixel density; I did not check on a real phone.

Known risk: `flame` and `droplet` are both teardrops. They differ by an off-center pointed tip and an inner outline on the flame, plus color (rose vs sky). If students mix them up in testing, replace `droplet` with a ringed planet and keep the id list in sync.

### SVG source (paste as-is into `index.html`)

The markup omits `width`/`height` so CSS sizes it (`.av svg{width:100%;height:100%}`).

#### `atom` · Atom · accent `sky`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fdf6d8"><ellipse cx="32" cy="32" rx="26" ry="10"/><ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="26" ry="10" transform="rotate(120 32 32)"/></g><circle cx="32" cy="32" r="6" fill="#7fd1f0" stroke="#f3dd7a"/></svg>
```

#### `bolt` · Bolt · accent `gold`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M37 4 14 36h15l-4 24 25-34H35z" fill="#f3dd7a" stroke="#fdf6d8"/></svg>
```

#### `beaker` · Beaker · accent `good`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8v44q0 6 6 6h16q6 0 6-6V8" fill="#4caf62" stroke="#fdf6d8"/><path d="M13 8h38" stroke="#fdf6d8"/><path d="M18 20h8M18 30h6M18 40h8" stroke="#fdf6d8"/><circle cx="35" cy="44" r="2.5" stroke="#fdf6d8"/><circle cx="39" cy="36" r="2" stroke="#fdf6d8"/></svg>
```

#### `crystal` · Crystal · accent `good`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8h24l14 16-26 34L6 24z" fill="#4caf62" stroke="#fdf6d8"/><path d="M6 24h52M20 8l6 16 6 34M44 8l-6 16-6 34" stroke="#fdf6d8"/></svg>
```

#### `flame` · Flame · accent `rose`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 4c4 10 16 18 16 34 0 12-7 20-16 20S16 50 16 38c0-8 4-14 8-20 2 6 4 8 6 10 2-8 0-16 2-24z" fill="#f2a8a3" stroke="#f3dd7a"/><path d="M32 54c-5 0-7-5-6-9s4-5 6-9c2 4 6 6 6 10s-3 8-6 8z" stroke="#fdf6d8"/></svg>
```

#### `droplet` · Droplet · accent `sky`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 5C32 5 14 28 14 40a18 18 0 0 0 36 0C50 28 32 5 32 5z" fill="#7fd1f0" stroke="#fdf6d8"/><path d="M24 40a8 8 0 0 0 6 9" stroke="#fdf6d8"/></svg>
```

#### `magnet` · Magnet · accent `rose`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8h14v26a6 6 0 0 0 12 0V8h14v26a20 20 0 0 1-40 0z" fill="#f2a8a3" stroke="#fdf6d8"/><path d="M12 20h14M38 20h14" stroke="#fdf6d8"/></svg>
```

#### `moon` · Moon · accent `gold`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M40 6a26 26 0 1 0 18 40A21 21 0 0 1 40 6z" fill="#f3dd7a" stroke="#fdf6d8"/></svg>
```

#### `star` · Star · accent `gold`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m32 5 8 19h19l-15 12 6 20-18-11-18 11 6-20L5 24h19z" fill="#f3dd7a" stroke="#fdf6d8"/></svg>
```

#### `comet` · Comet · accent `sky`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M34 30 8 56M28 22 8 38M42 36 26 54" stroke="#fdf6d8"/><circle cx="45" cy="21" r="11" fill="#7fd1f0" stroke="#f3dd7a"/></svg>
```

#### `rocket` · Rocket · accent `rose`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 4c10 8 14 22 12 38H20C18 26 22 12 32 4z" fill="#f2a8a3" stroke="#fdf6d8"/><path d="M20 34 10 48l10-2zM44 34l10 14-10-2z" fill="#f2a8a3" stroke="#fdf6d8"/><circle cx="32" cy="24" r="5" stroke="#fdf6d8"/><path d="M26 47l6 13 6-13" stroke="#f3dd7a"/></svg>
```

#### `flask` · Flask · accent `rose`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M26 6h12M28 6v16L10 52q-3 6 4 6h36q7 0 4-6L36 22V6" fill="#f2a8a3" stroke="#fdf6d8"/><circle cx="30" cy="46" r="2.5" stroke="#fdf6d8"/><circle cx="40" cy="40" r="2" stroke="#fdf6d8"/></svg>
```

#### `crown` · Crown · accent `gold`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 52 4-34 14 14 8-22 8 22 14-14 4 34z" fill="#f3dd7a" stroke="#fdf6d8"/><path d="M8 44h48" stroke="#fdf6d8"/></svg>
```

#### `shield` · Shield · accent `good`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 4 54 12v18c0 14-10 24-22 30C20 54 10 44 10 30V12z" fill="#4caf62" stroke="#fdf6d8"/><path d="m20 26 12 12 12-12" stroke="#fdf6d8"/></svg>
```

#### `spark` · Spark · accent `good`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 4c2 18 10 26 28 28-18 2-26 10-28 28-2-18-10-26-28-28C22 30 30 22 32 4z" fill="#4caf62" stroke="#fdf6d8"/></svg>
```

#### `wave` · Wave · accent `sky`

```svg
<svg viewBox="0 0 64 64" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 30q10-14 20 0t20 0 16 0v22q0 6-6 6H10q-6 0-6-6z" fill="#7fd1f0" stroke="#fdf6d8"/><path d="M4 44q10-14 20 0t20 0 16 0" stroke="#fdf6d8"/></svg>
```

### Data shape for `index.html`

```js
const ICONS=[ /* in this order */
  {id:'atom',  label:'Atom',  accent:'sky',  svg:'<svg viewBox="0 0 64 64" …>…</svg>'},
  // …one entry per icon above, same id, label and accent
];
const ICON_IDS=['atom', 'bolt', 'beaker', 'crystal', 'flame', 'droplet', 'magnet', 'moon', 'star', 'comet', 'rocket', 'flask', 'crown', 'shield', 'spark', 'wave'];
const iconOf=id=>ICON_IDS.includes(id)?id:'atom';           // unknown or missing id falls back to atom
const iconSVG=(id,size,{label,tile}={})=>'<span class="av'+(tile?' tile':'')+'" style="--s:'+size+'px"'+(label?' role="img" aria-label="'+esc(label)+'"':' aria-hidden="true"')+'>'+ICONS.find(i=>i.id===iconOf(id)).svg+'</span>';
```

CSS:

```css
.av{display:inline-flex;flex:none;width:var(--s,28px);height:var(--s,28px)}
.av svg{width:100%;height:100%;display:block}
.av.tile{background:var(--bg0);border-radius:10px;padding:calc(var(--s,28px)*.08)}
```

Use `tile` wherever the icon sits on a light or gold surface, specifically the podium 1st place (`.vs-pod.p1`, gold gradient): gold and cream strokes vanish there. On navy rows (`--panel`, `--panel2`, `#26358f` "me" row) draw the icon directly.

## Picker UI

A new screen `V.screen='icons'` in the same panel style as the account screen (`.panel.auth`), plus the same markup reused inline on the VS join screen.

- **Header** (`.qmeta` "Profile icon", `h1.prompt` "Pick your icon").
- **Preview row.** Current selection at 64 px, its label in Lilita One, and the nickname (or "Guest") underneath.
- **Grid.** `role="radiogroup"`, `aria-label="Profile icon"`. 16 buttons, `role="radio"`, `aria-checked`, accessible name = label. **4 columns on phones**, 8 columns at 900 px and up. Each cell is a square button with the icon at 64 px.
- **Phone sizing.** Panel padding 12 px at `max-width:520px`: inner width at 390 px is 390 − 32 − 24 − 4 = 330 px; gap 8 px; each cell is (330 − 24) / 4 = 76 px. 64 px icon + 6 px padding. At 360 px cells are 68 px; the icon scales to 56 px (`--s` from a CSS `clamp`). All cells exceed 44 px.
- **Selected state.** Gold ring: `outline:3px solid var(--gold); outline-offset:-3px; background:var(--panel2)`. Focus ring stays the existing sky `:focus-visible`. Arrow keys move selection; Space/Enter selects.
- **Buttons.** Primary **Use this** (gold, 56 px, sticky bottom bar from change 2) commits the selection. **Cancel** (ghost) returns without changing. "Use this" is disabled until the selection differs from the saved icon. No Shuffle.
- **Not forced.** Solo play never opens the picker or asks for an icon. No first-run prompt. Everyone has `atom` until they choose.

## Where the icon appears

| Place | Size | Notes |
|---|---|---|
| Home header, next to "Lv N · title" (Part 1, change 3) | 28 px in a 44×44 button | Tap opens the picker. `aria-label="Change profile icon"`. Avatar button in row 1 also shows it. |
| Account screen | 64 px | Beside "Signed in as …" with a **Change icon** button. Guests see it above the sign-in form. |
| VS join-by-code, guest row | 44 px | Beside the generated name; **Change icon** expands the picker inline. The guest picks **before** pressing Join arena. |
| VS lobby rows | 28 px | `[icon] nickname [Host/Guest tag]` |
| VS splash (duel plates) | 48 px | Above the nickname in each `.vs-plate`. Arena splash plates: 28 px inline before the name. |
| VS ladder rows | 28 px | Between rank and name. Guest tag stays. |
| VS podium | 64 px (1st), 48 px (2nd, 3rd) | Above the name, on a `tile`. |
| VS results "The field" table | 28 px | First in the Player cell. Guest and Left tags stay. |

The icon is decorative next to a visible nickname, so it is `aria-hidden` there; the nickname is the label. Only standalone icon buttons carry `aria-label`.

## Build notes (dev agent, in order)

1. **`index.html`**
   - Add `ICONS`, `ICON_IDS`, `iconOf`, `iconSVG`, the `.av` CSS, and `S.icon` (default `'atom'`).
   - Persistence: guests already save the whole `S` to `localStorage['elemental-arcade-v1']`, so `S.icon` persists. For signed-in students add `icon` to the prefs blob (`PKEY`, today `{mute,deck}`) so the device remembers it before sign-in finishes. Do not add `icon` to `PROG`.
   - `setIcon(id)`: `S.icon=iconOf(id); save(); render();` and, when `ACCT`, `Cloud.setIcon(S.icon)`.
   - Render the picker (`iconsHTML`), add route `data-act="icons"` and `data-act="icon-pick"` / `"icon-use"` in the existing delegated click handler, and render icons per the table above.
   - Expose on `window.Arcade`: `ICONS`, `iconSVG`, `iconOf`, `setIcon`, and `getIcon: ()=>S.icon`, so `vs.js` can use them.
2. **`cloud.js`** (signed-in only)
   - Store the choice on the player document as a top-level `icon` string, next to `nick` and `cls` (not inside `progress`), so it follows the student to any device. Read it in the `getDoc(players/{uid})` that already loads progress and apply it with `setIcon` (without writing back). Add `Cloud.setIcon(id)` that does `setDoc(ref,{icon:id},{merge:true})` or includes `icon` in the existing `setDoc`.
3. **`firestore.rules`** (the repo's rules tests in `tests/specs/rules.spec.js` and `tests/fake/rules.js` must be extended to match)
   - `/players/{uid}`: add `'icon'` to the allowed top-level keys and require `(!('icon' in request.resource.data) || request.resource.data.icon in ['atom', 'bolt', 'beaker', 'crystal', 'flame', 'droplet', 'magnet', 'moon', 'star', 'comet', 'rocket', 'flask', 'crown', 'shield', 'spark', 'wave'])`.
   - `/matches/{code}/players/{uid}` create: add `'icon'` to `hasOnly` but **not** `hasAll` (old clients keep working), and require the same enum check. No update path: the icon is fixed once seated.
   - `README.md` says guests never touch `/players`; that stays true. A guest's icon goes only into their seat in a match.
4. **`vs.js`**
   - `seat(nick, guest)` (line 372) gains `icon: Arc.iconOf(Arc.getIcon())`. Guests use the picker on the join screen (`ui.guestIcon`, initial `Arc.getIcon()`); picking updates `ui.guestIcon` and `Arc.setIcon` so it also persists on the device.
   - Render `iconSVG(p.icon, size)` in `updateLobby`, `splashHTML`, `renderLadder`, `resultHTML` (podium and field) using the sizes above. Read with `iconOf(p.icon)` so seats without an icon show `atom`.
   - The picker is not available mid-match.
5. **Tests**
   - Rules: valid id accepted; unknown id rejected; seats without `icon` still accepted; icon on a seat cannot be changed.
   - Layout: extend `layoutProblems()` to cover 20 seated players at 390 px (the repo's screens spec seats 10), and assert picker cells are at least 44 px.
   - Reduced motion: see change 8.
6. **Do not** add upload, drawing, free text, emoji, or per-icon unlocks. Do not change the question flow or scoring.

---

# Could not verify

- The live GitHub Pages site (blocked from the sandbox); I used the same commit locally.
- Real Firebase: Auth (email/password, anonymous guests), Firestore rules enforcement and class-lobby listing. All signed-in and VS screens came from the repo's fake backend.
- Real Google Fonts rendering in my solo captures (fallback fonts). Existing VS captures in `docs/vs-arena/` used real fonts.
- A 20-player lobby, ladder and podium at 390 px: existing captures have 10 players. The 20-player heights above are arithmetic (44 px rows), not screenshots.
- Icon legibility on a physical phone at 28 px; checked only on a 2× rendered sheet.
- Whether students confuse `flame` and `droplet` (see Known risk).
