// UX pass (design/ux-spec.md Part 1): home layout and Play now, locked rooms, answer feedback, results bar,
// guest notice, binder empty state, reduced motion, and the cloud-less fallback. Screenshots go to docs/ux/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { layoutProblems, animationDurations } from '../helpers/layout.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'ux');
const shot = (page, name, w, full = true) => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: full });
const answerAll = async (page, right) => {
  for (let i = 0; i < 12; i++) {
    if (await page.locator('[data-act="again"]').count()) break;
    const k = await page.evaluate(r => { const q = Arcade.V.qs[Arcade.V.qi]; const ok = q.opts.findIndex(o => o.ok); return r ? ok : (ok + 1) % q.opts.length; }, right);
    await page.locator(`[data-act="answer"][data-i="${k}"]`).click();
    await page.locator('[data-act="next"]').click();
  }
  await expect(page.locator('[data-act="again"]')).toBeVisible();
};

for (const w of [PHONE, DESKTOP]) {
  test(`home: two-row header, Play now, numbered steps, no sideways scroll, 44 px targets (${w})`, async ({ arena }) => {
    const dev = await arena.device({ width: w, fonts: true }), p = dev.page;
    await dev.goto('/');
    await expect(p.locator('[data-ui="play-now"]')).toContainText('Starter 20 · Mixed Pack');
    await expect(p.locator('.h .step')).toHaveText(['1', '2']);
    await expect(p.locator('[data-act="account"]')).toContainText('Sign in');
    await expect(p.locator('[data-act="account"] .gtag')).toHaveText('Guest');
    await expect(p.locator('[data-act="mute"]')).toHaveAttribute('aria-label', 'Sound on');
    await expect(p.locator('[data-act="icons"]')).toHaveAttribute('aria-label', 'Change profile icon');
    expect(await layoutProblems(p)).toEqual([]);
    const m = await p.evaluate(() => ({ header: document.querySelector('.top').getBoundingClientRect().height, page: document.documentElement.scrollHeight }));
    if (w === PHONE) expect(m.header).toBeLessThanOrEqual(120);
    test.info().annotations.push({ type: 'measure', description: `guest home ${w}px: header ${Math.round(m.header)} px, page ${m.page} px` });
    await shot(p, 'home-guest', w);
    // signed in: avatar shows icon + nickname, VS record in the VS button, no guest notice
    await dev.signUp('period3', 'maya');
    await p.evaluate(() => { Arcade.S.vs = { w: 4, l: 1, streak: 2, best: 3, played: 5 }; Arcade.render(); });
    await expect(p.locator('[data-vs="vs-record"]')).toHaveText('VS 4-1 · streak 2');
    await expect(p.locator('[data-ui="guest-notice"]')).toHaveCount(0);
    await expect(p.locator('[data-act="account"] .gtag')).toHaveCount(0);
    expect(await layoutProblems(p)).toEqual([]);
    const h2 = await p.evaluate(() => document.documentElement.scrollHeight);
    test.info().annotations.push({ type: 'measure', description: `signed-in home ${w}px: page ${h2} px` });
    await shot(p, 'home-signed-in', w);
    // sound toggle is an icon button with aria-pressed
    await p.locator('[data-act="mute"]').click();
    await expect(p.locator('[data-act="mute"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(p.locator('[data-act="mute"]')).toHaveAttribute('aria-label', 'Sound off');
    expect(dev.errors).toEqual([]);
  });
}

test('locked rooms: last, flat, aria-disabled; a tap says why and starts nothing; Mixed Pack is gold', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, fonts: true }), p = dev.page;
  await dev.goto('/');
  const rooms = p.locator('[data-act="room"]');
  await expect(rooms.last()).toHaveAttribute('data-id', 'lab');                  // Starter 20 has no ions or isotopes
  const lab = p.locator('[data-act="room"][data-id="lab"]');
  await expect(lab).toHaveAttribute('aria-disabled', 'true');
  expect(await lab.getAttribute('disabled')).toBeNull();                         // still tappable, so it can answer
  await expect(lab.locator('.stars')).toHaveCount(0);
  await expect(lab).toContainText('Locked: needs ion or isotope cards.');
  await lab.click({ force: true });                                              // Playwright treats aria-disabled as not clickable; a tap works
  await expect(p.locator('[data-ui="room-status"]')).toHaveText('Particle Lab needs ion or isotope cards. Try Cations, Anions or Isotopes.');
  await expect(p.locator('[data-ui="room-status"]')).toHaveAttribute('role', 'status');
  expect(await p.evaluate(() => Arcade.V.screen)).toBe('home');
  await shot(p, 'locked-room', PHONE);
  const mixedBand = await p.locator('[data-act="room"][data-id="mixed"] .band').evaluate(e => getComputedStyle(e).backgroundImage);
  expect(mixedBand).toContain('243, 221, 122');                                  // gold
  // Cations: Number Crunch and Table Map lock, Particle Lab opens
  await p.locator('[data-act="deck"][data-id="cat"]').click();
  await expect(p.locator('[data-ui="room-status"]')).toHaveText('');            // deck change clears the message
  await expect(p.locator('[data-act="room"][aria-disabled="true"]')).toHaveCount(2);
  await p.locator('[data-act="room"][data-id="number"]').click({ force: true });
  await expect(p.locator('[data-ui="room-status"]')).toHaveText('Number Crunch needs element cards. Try Starter 20 or All 118.');
  await expect(p.locator('[data-act="room"][data-id="lab"]')).not.toHaveAttribute('aria-disabled', 'true');
  expect(await layoutProblems(p)).toEqual([]);
  expect(dev.errors).toEqual([]);
});

test('Play now remembers the last room (across a reload) and falls back to Mixed Pack when the deck cannot fill it', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE }), p = dev.page;
  await dev.goto('/');
  await p.locator('[data-act="room"][data-id="symbol"]').click();
  await p.locator('[data-act="home"]').first().click();                            // Quit
  await expect(p.locator('[data-ui="play-now"]')).toContainText('Starter 20 · Symbol Smash');
  await p.reload(); await dev.cloudReady();
  await expect(p.locator('[data-ui="play-now"]')).toContainText('Starter 20 · Symbol Smash');
  await p.locator('[data-act="play"]').click();
  expect(await p.evaluate(() => Arcade.V.roomId)).toBe('symbol');
  await p.locator('[data-act="home"]').first().click();
  await p.locator('[data-act="deck"][data-id="iso"]').click();
  await p.locator('[data-act="room"][data-id="lab"]').click();                     // remember Particle Lab
  await p.locator('[data-act="home"]').first().click();
  await p.locator('[data-act="deck"][data-id="s20"]').click();                    // Starter 20 cannot fill it
  await expect(p.locator('[data-ui="play-now"]')).toContainText('Starter 20 · Mixed Pack');
  expect(dev.errors).toEqual([]);
});

test('answer feedback: check and cross glyphs, Next pinned on screen at 390 px without scrolling; results bar and next-star line', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, fonts: true }), p = dev.page;
  await dev.goto('/');
  await p.locator('[data-act="play"]').click();
  const k = await p.evaluate(() => Arcade.V.qs[0].opts.findIndex(o => o.ok));
  const wrong = (k + 1) % 4;
  await p.locator(`[data-act="answer"][data-i="${wrong}"]`).click();
  await expect(p.locator('.opt.right .key svg')).toHaveCount(1);
  await expect(p.locator('.opt.wrong .key svg')).toHaveCount(1);
  await expect(p.locator('.opt.wrong .key')).toHaveAttribute('aria-label', /your answer, wrong/);
  await expect(p.locator('.fb h3 svg')).toHaveCount(1);
  const next = p.locator('[data-ui="next-bar"] [data-act="next"]');
  await expect(next).toBeFocused();
  await expect(p.locator('.fb .cw')).toHaveCount(1);                                // the card is dealt on a wrong answer
  await p.waitForTimeout(400);
  const box = await next.boundingBox(), vh = p.viewportSize().height;
  expect(box.y + box.height).toBeLessThanOrEqual(vh + 1);                         // reachable without scrolling
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.height).toBeGreaterThanOrEqual(56);
  expect(await layoutProblems(p)).toEqual([]);
  await shot(p, 'feedback', PHONE, false);
  await next.click();
  await answerAll(p, false);
  await expect(p.locator('[data-ui="next-star"]')).toHaveText(/Next star: \d+ of \d+ correct/);
  const n = await p.evaluate(() => Arcade.V.qs.length);
  await expect(p.locator('[data-ui="next-star"]')).toContainText(`${Math.ceil(0.5 * n)} of ${n}`);
  await expect(p.locator('[data-ui="results-bar"] [data-act="again"]')).toBeVisible();
  await expect(p.locator('[data-ui="results-bar"] [data-act="home"]')).toHaveText('Pick a room');
  expect(await layoutProblems(p)).toEqual([]);
  // a perfect round: no next-star line, and the new-cards header links to the binder
  await p.locator('[data-ui="results-bar"] [data-act="again"]').click();
  await answerAll(p, true);
  await expect(p.locator('[data-ui="next-star"]')).toHaveCount(0);
  await shot(p, 'results', PHONE, false);
  expect(dev.errors).toEqual([]);
});

test('guest notice: home and results, Sign in opens the account screen, dismiss lasts the session; binder empty state and device summary', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE }), p = dev.page;
  await dev.goto('/');
  // binder empty state with Play now
  await p.locator('[data-act="binder"]').click();
  await expect(p.locator('[data-ui="binder-empty"]')).toContainText('Your binder is empty.');
  await expect(p.locator('.slot').first()).toBeVisible();                          // locked slots stay below
  await p.locator('[data-ui="binder-empty"] [data-act="play"]').click();
  expect(await p.evaluate(() => Arcade.V.screen)).toBe('quiz');
  await answerAll(p, true);
  await expect(p.locator('[data-ui="guest-notice"]')).toContainText('your cards stay on this device');
  await p.locator('[data-ui="guest-notice"] [data-act="signin"]').click();
  expect(await p.evaluate(() => Arcade.V.screen)).toBe('account');
  const cards = await p.evaluate(() => Object.keys(Arcade.S.owned).length);
  await expect(p.locator('[data-ui="device-summary"]')).toHaveText(new RegExp(`On this device: ${cards} cards?, Lv \\d+\\.`));
  await p.locator('[data-act="home"]').last().click();
  await p.locator('[data-ui="guest-notice"] [data-act="notice-x"]').click();
  await expect(p.locator('[data-ui="guest-notice"]')).toHaveCount(0);
  await p.reload(); await dev.cloudReady();
  await expect(p.locator('[data-ui="guest-notice"]')).toHaveCount(0);            // same session
  const tab2 = await dev.context.newPage(); await tab2.goto(arena.origin + '/');
  await tab2.waitForFunction(() => !!window.Cloud);
  await expect(tab2.locator('[data-ui="guest-notice"]')).toHaveCount(1);         // new session
  await expect(p.locator('[data-ui="binder-empty"]')).toHaveCount(0);
  expect(dev.errors).toEqual([]);
});

test('reduced motion: new UI (notice, sticky bars, picker, room stagger) does not animate', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, reducedMotion: true }), p = dev.page;
  await dev.goto('/');
  for (const d of await animationDurations(p, '.notice, .rooms .room, main.enter > *')) expect(d).toBeLessThanOrEqual(0.01);
  await p.locator('[data-act="play"]').click();
  await p.locator('[data-act="answer"]').first().click();
  for (const d of await animationDurations(p, '.stickybar, .fb, .opt.right, .opt.wrong')) expect(d).toBeLessThanOrEqual(0.01);
  await p.locator('[data-act="icons"]').click();
  for (const d of await animationDurations(p, '.icell, .stickybar, main.enter > *')) expect(d).toBeLessThanOrEqual(0.01);
  // without reduced motion the home stagger stays inside the 200 ms budget and only runs on the first home view
  const d2 = await arena.device({ width: PHONE }); await d2.goto('/');
  // (cloud-ready re-renders home right away, so measure the stagger rule itself on the current grid)
  const delays = await d2.page.evaluate(() => { document.querySelector('main').classList.add('enter'); document.querySelector('.rooms').classList.add('stag'); return [...document.querySelectorAll('.rooms.stag .room')].map(e => parseFloat(getComputedStyle(e).animationDelay) * 1000); });
  expect(delays.length).toBe(8);
  expect(Math.max(...delays)).toBeLessThanOrEqual(200);
  await d2.page.locator('[data-act="binder"]').click(); await d2.page.locator('[data-act="home"]').last().click();
  expect(await d2.page.evaluate(() => Arcade.V.screen)).toBe('home');
  await expect(d2.page.locator('.rooms.stag')).toHaveCount(0);
  expect(dev.errors).toEqual([]);
});

test('Firebase unavailable: no avatar or notice, the picker still works on this device, nothing throws', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, firebase: 'blocked' }), p = dev.page;
  await dev.goto('/');
  await expect(p.locator('[data-act="account"]')).toHaveCount(0);
  await expect(p.locator('[data-ui="guest-notice"]')).toHaveCount(0);
  await p.locator('[data-act="icons"]').click();
  await p.locator('[data-act="icon-pick"][data-id="beaker"]').click();
  await p.locator('[data-act="icon-use"]').click();
  await expect(p.locator('[data-act="icons"] .av')).toHaveAttribute('data-icon', 'beaker');
  await p.locator('[data-act="play"]').click();
  await answerAll(p, true);
  expect(await layoutProblems(p)).toEqual([]);
  expect(dev.errors.filter(e => !/Failed to load resource|ERR_FAILED/.test(e))).toEqual([]);
});
