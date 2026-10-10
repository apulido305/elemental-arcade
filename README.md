# Elemental Arcade

A periodic table card quiz game. Win element, ion and isotope cards by answering questions.
Live site: https://apulido305.github.io/elemental-arcade/

Files: `index.html` (the whole game), `cloud.js` (optional sign-in and saving), `firebase-config.js` (your Firebase keys), `firestore.rules` (database security), `vs.js` (VS Arena, live multiplayer).

## Turn on sign-in and saved binders (Firebase, free tier)

Until you do this, the game works as a guest and saves only in each browser.

1. Go to https://console.firebase.google.com and create a project (you can skip Google Analytics).
2. **Build > Authentication > Get started > Email/Password**, turn on the first switch (not email link), save.
3. **Build > Firestore Database > Create database**, production mode, pick a US region.
4. In Firestore open the **Rules** tab, paste the contents of `firestore.rules`, and click **Publish**.
5. **Project settings (gear) > General > Your apps > Web (</>)**, register an app, and copy the config values into `firebase-config.js`.
6. **Authentication > Settings > Authorized domains > Add domain**: `apulido305.github.io`.
7. Commit `firebase-config.js`. The site shows a **Sign in** button within a minute.

## How sign-in works

Students make an account with a class code, a nickname and a 4 to 6 digit PIN. The game turns those into a private made-up email and password for Firebase, so no real email or name is stored. Each student can read and write only their own save.

Signing in needs only the nickname and PIN. At sign-up the game stores `/names/{nickname}` with the class code, and sign-in looks it up. Nicknames are therefore unique across all classes for new accounts.

- Anyone can invent a class code. It is shown on the account screen.
- Accounts made before the lookup existed are asked for their class code once. After that sign-in, the nickname is claimed and the class code is not needed again. (A student already signed in on a device claims it on their next visit.)
- After this change, publish the updated `firestore.rules`. Until then, sign-in falls back to asking for the class code.
- There is no PIN reset. To let a student start over, delete their user under Authentication > Users and their document under Firestore > players.
- Tell students to use a nickname, not their real name.

## Profile icons

Students pick one of 16 preset icons (atom, bolt, flask and so on) from the icon button next to their level. There is no upload, drawing or free text, and only the icon's id is stored, never an image. Guests keep theirs in this browser only; signed-in students keep theirs on their player document (`icon` next to `nick`), so it follows them to any device. In VS Arena the icon is copied onto the student's seat in the match so classmates can see it; the rules accept only the 16 ids.

## Packs

Students earn a pack in three ways: win a VS Arena match (1st place, with at least 2 players who competed; one pack per match), take a card to Gold Legend for the first time (one pack per card, ever), or, signed in, finish their first room round or VS match of the day (one daily pack per day; signing in alone does not earn it). The first time a signed-in student opens the game each day, a pop-up reminds them that today's free pack is waiting. Packs are earned only. There is nothing to buy.

A gold badge on the Binder button counts unopened packs. Open one from the binder: swipe across the top of the pack (phone), or click it or press "Tear open" (computer). Three cards deal face down; tap each to flip it. With reduced motion turned on, the button says "Open" and the results appear at once.

Each pack has 3 cards: a staple (a special finish on one of your cards, or XP), an icon pull (one of 34 pack-only icons in Common, Uncommon, Rare and Epic bands, or a gold icon), and a chase card (usually XP, sometimes a rare, epic or gold icon, including a 0.05% "this week's gold"). Every number is posted in the binder under "Pack odds", and in `design/pack-odds.md`. No duplicates: an owned pull drops a band, then turns into XP. The 16 starter icons stay free. Finishes are cosmetic and never change a card's level.

Guests keep their packs, finishes and unlocked icons on the device (local storage), as with their cards. Signed-in students keep them on their account, and they merge across devices without duplicating a pack or losing an unlock.

Art: the pack icons and gold icons reuse the existing icon art (`design/icons/`), resized into `img/icons/`. The pack wrapper (`img/pack.webp`) was generated with fal.ai (`fal-ai/flux-2/flash`, about $0.05 including the model probe; see `design/pack-art.md`). The fal.ai key used for it was passed on the command line only and was never written to the repository.

## VS Arena (live multiplayer, 2 to 20 players)

One signed-in student hosts, picks a deck and room, and puts a 6-character code on the board. Classmates join on their phones by typing the code, from the class lobby, or as a guest. The host has 10 minutes to start, counted from when the second player joins (while the host waits alone there is no countdown; an empty lobby is cleaned up after an hour). Everyone gets the same questions in the same order (a seed stored on the match feeds the question builder). The host picks 10, 15 or 20 questions (solo players pick the same on the home screen). Each question is 15 seconds, then a 2.5 second reveal. Faster correct answers score 100 to 150 points. A two-player match gets the fighting-game VS splash; three or more get the arena ladder. A 10-question match takes about 3 to 4 minutes (20 questions about 6). Before the podium, every phone takes a few seconds to check the final scores with the server, so an answer from a slow connection that arrives up to 8 seconds after its question closed still counts. The host can start a rematch (new code, new seed).

- The shared clock is the match's `startAt` server timestamp. Nothing advances the game on a server; every tab runs the same schedule. School devices are assumed to be NTP-synced within a second or two.
- A code works for any class. The class lobby only lists open arenas from the signed-in student's own class. Guests never see the lobby.
- Rewards: each correct answer adds card XP (once per card per match), plus a placement bonus (1st +40, 2nd +25, 3rd +15, 4th to 10th +8, others who finished +5). Signed-in students keep a VS record (`VS 4-1 · streak 2`) on the home and account screens. Guests keep card XP in this browser only and have no record.
- Disconnects: a student who goes quiet is marked away and stays on the ladder. If only one player is left, they win by forfeit. A student whose page reloads or drops mid-match can type the same code to rejoin their seat with their points, unless they were silent for more than 20 seconds and got marked away. New players still cannot join once the countdown starts. A lobby that never starts expires after 5 minutes.
- `window.VS_TIME_SCALE` is a test-only number that multiplies every VS duration.

### Teacher setup for VS Arena

1. **Authentication > Sign-in method > Anonymous**: turn it on (guests use it; no account is created for them).
2. Publish the updated `firestore.rules` (Firestore > Rules > paste > Publish). It covers `/matches/{code}` and its `players`, `answers` and `presence` subcollections. Key rules: guests cannot list matches or touch `/players`; a guest can take one open seat only when the host allows guests; nobody can write another player's answer or a second answer for the same question; the host cannot set the cap above 20; match status only moves forward.
3. Smoke test with two phones, then try several signed-in classmates joining through the class lobby ("everyone join the open arena").

### Good to know

- **Cheating:** correctness and timing are computed in each student's browser, so a determined student can cheat. The 8-second late window for slow connections means a student who edits the page could also answer during the reveal. The rules stop obvious abuse (bad shapes, impossible scores, writing as someone else) but cannot prove an answer was honest.
- **Abuse limits:** Auth sign-in rate limits can be tightened in the Firebase console. Turn on App Check if abuse appears.
- **Cleanup (built in, free plan):** when a signed-in student opens VS Arena, their phone (at most every 6 hours) sweeps their own class's arenas: lobbies whose timer ran out are marked expired, matches stuck mid-game for an hour are ended, and matches that ended more than a day ago are deleted along with every seat, answer and heartbeat under them. The rules allow this only for matches that are provably over. A host who closes the tab also takes their lobby off the class lobby list. Do not add a Firestore TTL policy on `expireAt`: TTL needs billing, does not delete subcollections, and `expireAt` passes while a match is still being played.
- **After an update, everyone refresh the page before joining an arena.** Questions are built from the match seed, so a phone with an old cached page can see different questions from a phone with the new one.
- Privacy: students and guests appear by nickname only. Guest names are generated (for example "Bold Boron"). Reactions are 5 presets. There is no chat.

### Class tournament

No bracket engine is built in. Easiest: one arena with the cap at 20 for the whole class, and the teacher records the podium. For bigger classes run heats of 8 as a round robin of 3 arenas (each student plays in a different heat each round) and tally podium finishes by hand.
