// VS cleanup: a signed-in student's phone sweeps their own class's dead arenas when they open VS Arena, and a host
// who closes the tab takes their lobby off the class lobby list.
import { test, expect, PHONE } from '../helpers/fixtures.js';
import { T } from '../fake/backend.js';
import { openVs, hostArena } from '../helpers/vs.js';

const DAY = 24 * 3600e3, H = 3600e3;
// Seed a match (and optionally its children) straight into the backend, as if written earlier.
function seed(arena, code, m, uids = []) {
  const now = Date.now();
  arena.backend.adminSet('matches/' + code, Object.assign({ hostUid: 'h', hostNick: 'host', cls: 'class1', deck: 's20', room: 'mixed', seed: 1, cap: 20, allowGuests: true, listed: true,
    status: 'done', createdAt: T(now), expireAt: T(now + 600e3), playerCount: uids.length, startAt: T(now), alive: 0, aggUid: 'h', aggUntil: T(now), winnerUid: null, endedAt: T(now), rematch: null }, m));
  for (const u of uids) {
    arena.backend.adminSet(`matches/${code}/players/${u}`, { nick: u, guest: false, joinedAt: T(now), lastSeen: T(now), score: 0, correct: 0, totalMs: 0, answeredQ: 9, reaction: null, reactionAt: null, abandoned: false, left: false, streak: 0 });
    for (let q = 0; q < 10; q++) arena.backend.adminSet(`matches/${code}/answers/${u}_${q}`, { q, choice: 0, elapsedMs: 1, correct: false, points: 0, at: T(now) });
    arena.backend.adminSet(`matches/${code}/presence/${u}`, { at: T(now) });
  }
}
const under = (arena, code) => ['players', 'answers', 'presence'].reduce((n, c) => n + arena.backend.adminList(`matches/${code}/${c}`).length, 0);

test('opening VS Arena sweeps the class: stale lobbies expire, stuck matches end, matches over a day old are deleted with everything under them', async ({ arena }) => {
  const ts = 0.1;   // scaled: "a day" is 2.4 h, "an hour" is 6 min
  const dev = await arena.device({ width: PHONE, timeScale: ts }), now = Date.now();
  await dev.goto('/'); await dev.signUp('class1', 'sweeper');
  seed(arena, 'AAAAAA', { createdAt: T(now - 3 * DAY * ts) }, ['u1', 'u2']);                                   // done, old: deleted
  seed(arena, 'BBBBBB', { status: 'expired', createdAt: T(now - 3 * DAY * ts) }, ['u3']);                        // expired, old: deleted
  seed(arena, 'CCCCCC', { status: 'lobby', listed: false, createdAt: T(now - 0.5 * H * ts), expireAt: T(now - 60e3), endedAt: null });   // unlisted ghost, timer ran out: expired, kept
  seed(arena, 'DDDDDD', { status: 'playing', createdAt: T(now - 2 * H * ts), startAt: T(now - 2 * H * ts), endedAt: null }, ['u4']);   // stuck: abandoned, kept
  seed(arena, 'EEEEEE', { status: 'lobby', createdAt: T(now), expireAt: T(now + 600e3), endedAt: null });       // live lobby: untouched
  seed(arena, 'FFFFFF', { createdAt: T(now - 3 * DAY * ts), cls: 'class2' }, ['u5']);                          // another class: not ours to sweep
  seed(arena, 'GGGGGG', { createdAt: T(now - H * ts) }, ['u6']);                                               // finished an hour ago: kept for a day
  await openVs(dev);                                                                                          // the sweep runs in the background
  await expect.poll(() => arena.backend.adminGet('matches/AAAAAA'), { timeout: 10000 }).toBeNull();
  await expect.poll(() => arena.backend.adminGet('matches/BBBBBB'), { timeout: 10000 }).toBeNull();
  expect(under(arena, 'AAAAAA')).toBe(0); expect(under(arena, 'BBBBBB')).toBe(0);
  await expect.poll(() => arena.backend.adminGet('matches/CCCCCC').status).toBe('expired');
  await expect.poll(() => arena.backend.adminGet('matches/DDDDDD').status).toBe('abandoned');
  expect(arena.backend.adminGet('matches/EEEEEE').status).toBe('lobby');
  expect(arena.backend.adminGet('matches/FFFFFF')).not.toBeNull(); expect(under(arena, 'FFFFFF')).toBe(12);
  expect(arena.backend.adminGet('matches/GGGGGG')).not.toBeNull(); expect(under(arena, 'GGGGGG')).toBe(12);
  expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
  // at most one sweep per device every 6 hours (and once per page load)
  seed(arena, 'HHHHHH', { createdAt: T(now - 3 * DAY * ts) });
  expect(await dev.page.evaluate(() => VSArena._sweep())).toBeNull();
  await dev.page.reload(); await dev.page.waitForSelector('[data-act="deck"]');
  expect(await dev.page.evaluate(() => VSArena._sweep())).toBeNull();
  expect(arena.backend.adminGet('matches/HHHHHH')).not.toBeNull();
  // a forced sweep reports what it did
  expect(await dev.page.evaluate(() => VSArena._sweep(true))).toEqual({ expired: 0, ended: 0, deleted: 1 });
});

test('guests and signed-out visitors never sweep', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, timeScale: 0.1 }), now = Date.now();
  await dev.goto('/');
  seed(arena, 'AAAAAA', { createdAt: T(now - DAY) });
  await openVs(dev);
  expect(await dev.page.evaluate(() => VSArena._sweep(true))).toBeNull();
  expect(arena.backend.adminGet('matches/AAAAAA')).not.toBeNull();
  expect(arena.backend.denials.filter(d => d.op !== 'get')).toEqual([]);
});

test('a host who closes the tab takes the lobby off the class lobby list; coming back lists it again', async ({ arena }) => {
  const host = await arena.device({ width: PHONE }), kid = await arena.device({ width: PHONE });
  for (const d of [host, kid]) await d.goto('/');
  await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo');
  const code = await hostArena(host);
  await openVs(kid);
  await expect(kid.page.locator(`[data-vs="lobby-join"][data-code="${code}"]`)).toBeVisible();
  await host.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(() => arena.backend.adminGet('matches/' + code).listed).toBe(false);
  await expect(kid.page.locator(`[data-vs="lobby-join"][data-code="${code}"]`)).toHaveCount(0);   // no ghost in the list
  await host.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => arena.backend.adminGet('matches/' + code).listed).toBe(true);
  await expect(kid.page.locator(`[data-vs="lobby-join"][data-code="${code}"]`)).toBeVisible();
});
