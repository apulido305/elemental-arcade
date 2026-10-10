// Regressions the VS work must not break: solo rounds, account sign-in, card tier level-ups; and the cloud-less fallback.
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';

/** Play the solo round answering correctly (reads the right option from the app state). */
async function soloRound(page, { right = true } = {}) {
  await page.locator('[data-act="room"]:not([disabled])').first().click();
  for (let i = 0; i < 12; i++) {
    if (await page.locator('[data-act="again"]').count()) break;
    const idx = await page.evaluate(r => { const q = Arcade.V.qs[Arcade.V.qi]; const ok = q.opts.findIndex(o => o.ok); return r ? ok : (ok + 1) % q.opts.length; }, right);
    await page.locator(`[data-act="answer"][data-i="${idx}"]`).click();
    await page.locator('[data-act="next"]').click();
  }
  await expect(page.locator('[data-act="again"]')).toBeVisible();
}

test('solo round: ten questions, score, XP, binder updated; no VS code runs', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE });
  await dev.goto('/');
  const before = await dev.page.evaluate(() => ({ xp: Arcade.S.xp, rounds: Arcade.S.rounds, owned: Object.keys(Arcade.S.owned).length }));
  await soloRound(dev.page);
  const after = await dev.page.evaluate(() => ({ xp: Arcade.S.xp, rounds: Arcade.S.rounds, owned: Object.keys(Arcade.S.owned).length, score: Arcade.V.score }));
  expect(after.rounds).toBe(before.rounds + 1);
  expect(after.score).toBeGreaterThanOrEqual(100);
  expect(after.xp).toBeGreaterThan(before.xp);
  expect(after.owned).toBeGreaterThan(before.owned);
  expect(await dev.page.evaluate(() => document.getElementById('vs').hidden)).toBe(true);
  expect(arena.backend.commits).toBe(0);                                  // solo and signed-out: nothing written to the backend
  expect(dev.errors).toEqual([]);
});

test('sign up, sign out, sign in again through the account screen; progress comes back', async ({ arena }) => {
  const dev = await arena.device({ width: DESKTOP });
  await dev.goto('/');
  await dev.signUpViaUI('class1', 'ada', '1234');
  await soloRound(dev.page);
  const uid = (await dev.currentUser()).uid;
  await expect.poll(() => arena.backend.adminGet(`players/${uid}/games/chem`)?.rounds, { timeout: 8000 }).toBe(1);
  const xp = await dev.page.evaluate(() => Arcade.S.xp);
  await dev.page.click('[data-act="account"]');
  await dev.page.click('[data-act="signout"]');
  await expect(dev.page.locator('[data-act="account"]')).toHaveText(/Sign in/);
  expect(await dev.currentUser()).toBeNull();
  // sign-in asks only for nickname + PIN; a wrong PIN shows the friendly message, right PIN signs in
  expect(arena.backend.adminGet('names/ada')).toMatchObject({ cls: 'class1' });
  await dev.page.click('[data-act="account"]');
  await dev.page.click('[data-act="authtab"][data-id="in"]');
  await expect(dev.page.locator('#f-cls')).toHaveCount(0);
  await dev.page.fill('#f-nick', 'ada'); await dev.page.fill('#f-pin', '9999');
  await dev.page.click('#authform button[type="submit"]');
  await expect(dev.page.locator('#authform')).toContainText(/not right/i);
  await dev.page.fill('#f-pin', '1234');
  await dev.page.click('#authform button[type="submit"]');
  await expect(dev.page.locator('[data-act="account"]')).toContainText('ada', { ignoreCase: true });
  await expect.poll(() => dev.page.evaluate(() => Arcade.S.xp)).toBeGreaterThanOrEqual(xp);
  expect(await dev.currentUser()).toMatchObject({ isAnonymous: false });
  expect(arena.backend.denials).toEqual([]);
  expect(dev.errors).toEqual([]);
});

test('an account made before the nickname lookup signs in with its class code once, then without it', async ({ arena }) => {
  await arena.seedUser('class1', 'old', '4321');                     // scripted sign-up: no /names doc, like older accounts
  expect(arena.backend.adminGet('names/old')).toBeNull();
  const dev = await arena.device({ width: PHONE });
  await dev.goto('/');
  await dev.page.click('[data-act="account"]');
  await dev.page.fill('#f-nick', 'old'); await dev.page.fill('#f-pin', '4321');
  await dev.page.click('#authform button[type="submit"]');
  await expect(dev.page.locator('#authform')).toContainText(/add your class code/i);
  await dev.page.fill('#f-cls', 'class1');
  await dev.page.click('#authform button[type="submit"]');
  await expect(dev.page.locator('[data-act="account"]')).toContainText('old', { ignoreCase: true });
  await expect.poll(() => arena.backend.adminGet('names/old')).toMatchObject({ cls: 'class1' });
  await dev.page.evaluate(() => Cloud.signOut());
  await dev.signIn('old', '4321');
  expect(arena.backend.denials).toEqual([]);
  expect(dev.errors).toEqual([]);
});

test('a nickname is unique across classes at sign-up', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE });
  await dev.goto('/');
  await dev.signUpViaUI('class1', 'ada', '1234');
  await dev.page.evaluate(() => Cloud.signOut());
  await dev.page.click('[data-act="account"]');
  await dev.page.click('[data-act="authtab"][data-id="up"]');
  await dev.page.fill('#f-cls', 'class2'); await dev.page.fill('#f-nick', 'Ada'); await dev.page.fill('#f-pin', '5555');
  await dev.page.click('#authform button[type="submit"]');
  await expect(dev.page.locator('#authform')).toContainText(/nickname is taken/i);
  expect(dev.errors).toEqual([]);
});

test('solo card level-up crossing a tier (Base -> Holo) fires the feedback and shows on the results', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE });
  await dev.goto('/');
  const tiers = await dev.page.evaluate(() => ({ t2: Arcade.tierOf(2), t3: Arcade.tierOf(3), names: Arcade.TIERS.map(t => t.n) }));
  expect(tiers.t3).toBeGreaterThan(tiers.t2);
  await dev.page.evaluate(() => { Arcade.deckItems(Arcade.S.deck).forEach(it => { Arcade.S.owned[it.id] = 2; }); Arcade.save(); Arcade.render(); });
  await dev.page.locator('[data-act="room"]:not([disabled])').first().click();
  const idx = await dev.page.evaluate(() => Arcade.V.qs[Arcade.V.qi].opts.findIndex(o => o.ok));
  await dev.page.locator(`[data-act="answer"][data-i="${idx}"]`).click();
  await expect(dev.page.locator('.fb')).toContainText(/CARD LEVEL UP: HOLO/);
  await expect(dev.page.locator('.cw.levelup')).toHaveCount(1);
  expect(await dev.page.evaluate(() => Arcade.V.lastUp)).toBe(tiers.t3);
  await dev.page.locator('[data-act="next"]').click();
  for (let i = 0; i < 12; i++) {                                           // finish the round
    if (await dev.page.locator('[data-act="again"]').count()) break;
    const k = await dev.page.evaluate(() => Arcade.V.qs[Arcade.V.qi].opts.findIndex(o => o.ok));
    await dev.page.locator(`[data-act="answer"][data-i="${k}"]`).click();
    await dev.page.locator('[data-act="next"]').click();
  }
  await expect(dev.page.locator('main')).toContainText(/leveled up/i);
  expect(await dev.page.evaluate(() => Arcade.V.ups.length)).toBeGreaterThanOrEqual(1);
  expect(dev.errors).toEqual([]);
});

test('Firebase unavailable: VS is hidden, the disabled line shows, solo still plays', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, firebase: 'blocked' });
  await dev.goto('/');
  await expect(dev.page.locator('[data-vs="vs-open"]')).toHaveCount(0);
  await expect(dev.page.locator('[data-vs="vs-off"]')).toHaveText('VS Arena could not load. Refresh the page to try again.');
  expect(await dev.page.evaluate(() => document.getElementById('vs').hidden)).toBe(true);
  await soloRound(dev.page);
});

test('Firebase reachable but unconfigured backend offline: home still renders and VS open does not throw', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE });
  await dev.goto('/');
  arena.backend.offline = true;                                           // every call now fails with "unavailable"
  await dev.page.locator('[data-vs="vs-open"]').click();
  await dev.page.fill('[data-vs="join-code-input"]', 'ABCDEF');
  await dev.page.locator('[data-vs="join-submit"]').click();
  await expect(dev.page.locator('[data-vs="error"]:not([hidden])')).toContainText(/reach|server|connection|guest play/i);
  await dev.page.locator('[data-vs="close"]').click();
  await soloRound(dev.page);
});
