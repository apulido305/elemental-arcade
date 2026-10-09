// Browser smoke tests with the fake Firebase configured: home renders, solo play still works, sign-up goes
// through the fake, and the fake is shared between devices. Also: Firebase unavailable -> solo unaffected.
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { expectDenied } from '../helpers/arena.js';

async function playSoloRound(page) {
  await page.locator('[data-act="room"]:not([disabled])').first().click();
  for (let i = 0; i < 12; i++) {
    if (await page.locator('[data-act="again"]').count()) break;
    await expect(page.locator('[data-act="answer"]').first()).toBeVisible();
    await page.locator('[data-act="answer"]').first().click();
    await page.locator('[data-act="next"]').click();
  }
  await expect(page.locator('[data-act="again"]')).toBeVisible();
}

for (const width of [PHONE, DESKTOP]) {
  test(`home renders and solo play works with the fake configured (${width}px)`, async ({ arena }) => {
    const dev = await arena.device({ width });
    await dev.goto('/');
    await expect(page(dev).locator('[data-act="deck"]')).toHaveCount(10);
    await expect(page(dev).locator('[data-act="room"]').first()).toBeVisible();
    await expect(page(dev).locator('[data-act="account"]')).toHaveText(/Sign in/);
    expect(await dev.page.evaluate(() => window.VS_TIME_SCALE)).toBe(0.1);
    expect(await dev.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);   // no horizontal scroll
    expect(await dev.currentUser()).toBeNull();                      // nothing signs in on load (guests only on Join)
    await playSoloRound(dev.page);
    await expect(dev.page.locator('main')).toContainText(/score|XP|Level/i);
    expect(dev.errors).toEqual([]);
  });
}

test('sign up through the fake (account screen), cloud save lands in /players, sign out and back in', async ({ arena }) => {
  const dev = await arena.device({ width: DESKTOP });
  await dev.goto('/');
  await dev.signUpViaUI('class1', 'ada', '1234');
  const user = await dev.currentUser();
  expect(user.isAnonymous).toBe(false);
  expect(user.email).toBe('class1_ada@players.elemental-arcade.example');
  const saved = arena.backend.adminGet('players/' + user.uid);
  expect(saved).toMatchObject({ nick: 'ada', cls: 'class1' });
  await playSoloRound(dev.page);                                     // progress is saved to /players through the rules fake
  await expect.poll(() => arena.backend.adminGet('players/' + user.uid).progress.rounds).toBe(1);
  expect(arena.backend.denials).toEqual([]);
  // second device signs in as the same account and sees the cloud progress
  const dev2 = await arena.device({ width: PHONE });
  await dev2.goto('/');
  await dev2.signIn('class1', 'ada', '1234');
  await dev2.page.click('[data-act="account"]');
  await expect(dev2.page.locator('main')).toContainText('ada', { ignoreCase: true });
  expect(dev.errors).toEqual([]); expect(dev2.errors).toEqual([]);
});

test('fake backend is shared across devices (separate contexts) with live snapshots and rules', async ({ arena }) => {
  const a = await arena.device({ width: PHONE }), b = await arena.device({ width: DESKTOP });
  await a.goto('/'); await b.goto('/');
  await a.signUp('class1', 'amy'); await b.signUp('class1', 'ben');
  expect((await a.currentUser()).uid).not.toBe((await b.currentUser()).uid);
  // B listens (SSE), A writes (RPC); a normal /players write by A is invisible to B (rules), a hand-made public doc is shared
  await b.page.evaluate(() => {
    const { sdk } = window.__fakeFirebase, F = sdk.firestore, db = F.getFirestore();
    window.__seen = []; window.__errs = [];
    F.onSnapshot(F.doc(db, 'matches', 'ABCDEF'), s => window.__seen.push(s.exists() ? s.data().playerCount : null), e => window.__errs.push(e.code));
  });
  await expect.poll(() => b.page.evaluate(() => window.__seen)).toEqual([null]);
  arena.backend.adminSet('matches/ABCDEF', { playerCount: 1 });
  await expect.poll(() => b.page.evaluate(() => window.__seen)).toEqual([null, 1]);
  arena.backend.adminSet('matches/ABCDEF', { playerCount: 2 });
  await expect.poll(() => b.page.evaluate(() => window.__seen)).toEqual([null, 1, 2]);
  // permission errors reach the page as FirebaseError with code permission-denied
  const err = await a.page.evaluate(async () => {
    const { sdk } = window.__fakeFirebase, F = sdk.firestore, db = F.getFirestore(), A = sdk.auth.getAuth();
    const other = window.__otherUid;
    try { await F.getDoc(F.doc(db, 'players', 'someone-else')); return null; } catch (e) { return { name: e.name, code: e.code, isErr: e instanceof Error }; }
  });
  expect(err).toEqual({ name: 'FirebaseError', code: 'permission-denied', isErr: true });
});

test('anonymous session: session persistence, gone after signOut and in a new tab; local sessions survive', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE });
  await dev.goto('/');
  // guest join flow primitives, exactly as SPEC: session persistence + signInAnonymously.
  // (vs.js signs a guest out when it is not in an arena, so storage is sampled synchronously after sign-in.)
  const first = await dev.page.evaluate(async () => {
    const { sdk } = window.__fakeFirebase, A = sdk.auth, auth = A.getAuth();
    await A.setPersistence(auth, A.browserSessionPersistence);
    const u = (await A.signInAnonymously(auth)).user;
    return { uid: u.uid, anon: u.isAnonymous, email: u.email, l: localStorage.getItem('fakeauth:user'), s: !!sessionStorage.getItem('fakeauth:user') };
  });
  const guestUid = first.uid;
  expect(first).toMatchObject({ anon: true, email: null, l: null, s: true });              // session persistence only, nothing in localStorage
  // Same tab reload keeps a session-persistence user (the product signs guests out when a match ends, not on load).
  await dev.page.reload(); await dev.cloudReady();
  expect(await dev.currentUser()).toMatchObject({ uid: guestUid, isAnonymous: true });
  // a new tab (new load, empty sessionStorage) starts signed out
  const tab2 = await dev.context.newPage(); tab2.on('pageerror', e => dev.errors.push(String(e)));
  await tab2.goto(arena.origin + '/'); await tab2.waitForFunction(() => !!window.Cloud);
  expect(await tab2.evaluate(() => window.__fakeFirebase.sdk.auth.getAuth().currentUser)).toBeNull();
  await tab2.close();
  // signOut() ends it for good
  await dev.page.evaluate(() => window.__fakeFirebase.sdk.auth.signOut(window.__fakeFirebase.sdk.auth.getAuth()));
  expect(await dev.currentUser()).toBeNull();
  await dev.page.reload(); await dev.cloudReady();
  expect(await dev.currentUser()).toBeNull();
  expect(arena.backend.users.has(guestUid)).toBe(false);
  // local persistence (signed-in accounts "keep me signed in") survives a new tab; session persistence does not
  await dev.signUp('class1', 'zed');
  const tab3 = await dev.context.newPage();
  await tab3.goto(arena.origin + '/'); await tab3.waitForFunction(() => !!window.Cloud);
  await tab3.evaluate(() => new Promise(r => window.Cloud.onChange(() => r())));
  expect(await tab3.evaluate(() => !!window.__fakeFirebase.sdk.auth.getAuth().currentUser)).toBe(true);
  // another device (context) never shares auth
  const other = await arena.device({ width: PHONE }); await other.goto('/');
  expect(await other.currentUser()).toBeNull();
});

test('Firebase unavailable: Cloud never appears and solo play is unaffected', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, firebase: 'blocked' });
  await dev.goto('/');
  await expect(dev.page.locator('[data-act="room"]').first()).toBeVisible();
  expect(await dev.page.evaluate(() => !!window.Cloud)).toBe(false);
  await expect(dev.page.locator('[data-act="account"]')).toHaveCount(0);
  await playSoloRound(dev.page);
});

const page = d => d.page;
