# Elemental Arcade

A periodic table card quiz game. Win element, ion and isotope cards by answering questions.
Live site: https://apulido305.github.io/elemental-arcade/

Files: `index.html` (the whole game), `cloud.js` (optional sign-in and saving), `firebase-config.js` (your Firebase keys), `firestore.rules` (database security).

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

Students enter a class code, a nickname and a 4 to 6 digit PIN. The game turns those into a private made-up email and password for Firebase, so no real email or name is stored. Each student can read and write only their own save.

- Anyone can invent a class code. It only keeps nicknames from clashing between classes.
- There is no PIN reset. To let a student start over, delete their user under Authentication > Users and their document under Firestore > players.
- Tell students to use a nickname, not their real name.
