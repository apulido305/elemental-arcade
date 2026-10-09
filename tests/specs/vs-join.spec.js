// VS Arena: joining paths, guest messages, class lobby visibility, hosting restrictions. Mostly fast (no full match).
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { T } from '../fake/backend.js';
import { openVs, hostArena, joinByCode, joinByCodeOk, joinFromLobby, errorText, seatKids } from '../helpers/vs.js';
import { expectDenied, openLobby } from '../helpers/arena.js';

const MSG = {
  badformat: /not the right length/i, missing: /No arena has that code/i, expired: /expired/i, full: /is full/i,
  started: /already started/i, noguests: /not open to guests/i
};

test.describe('guest join messages', () => {
  test('wrong, malformed, expired, full, already-started and guests-off codes each get their own message; the guest session is signed out after each', async ({ arena }) => {
    const { host, code: open } = await openLobby(arena);                       // an ordinary open lobby for reference
    const full = await host.createMatch({ cap: 2 });
    const kid = arena.client('kid'); await kid.signUp('class1', 'kid'); await kid.join(full);
    const started = await host.createMatch({ cap: 5 });
    await kid.join(started); await host.start(started);
    const expired = await host.createMatch();
    arena.backend.adminUpdate('matches/' + expired, { expireAt: T(Date.now() - 5000) });
    const dead = await host.createMatch(); arena.backend.adminUpdate('matches/' + dead, { status: 'expired' });
    const noGuests = await host.createMatch({ allowGuests: false });

    const g = await arena.device({ width: PHONE });
    await g.goto('/');
    await openVs(g);
    await expect(g.page.locator('[data-vs="guest-name"]')).toHaveText(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    await expect(g.page.locator('[data-vs="lobby-list"]')).toHaveCount(0);       // guests never see a class lobby
    const cases = [['AB', MSG.badformat], ['ZZZZZ9', MSG.missing], [expired, MSG.expired], [dead, MSG.expired], [full, MSG.full], [started, MSG.started], [noGuests, MSG.noguests]];
    const seen = new Set();
    for (const [code, msg] of cases) {
      await joinByCode(g, code, { open: false });
      await expect(errorText(g)).toHaveText(msg);
      seen.add(await errorText(g).innerText());
      await expect.poll(() => g.currentUser()).toBeNull();                       // failed join leaves no anonymous session behind
      for (const [c2, m2] of cases) if (c2 !== code && m2 !== msg) await expect(errorText(g)).not.toHaveText(m2);
    }
    expect(seen.size).toBe(6);                                                   // expired/dead share one message; the rest are distinct
    // a good code still works afterwards, and the guest is shown with the Guest tag to the host side
    await joinByCodeOk(g, open);
    expect(await g.currentUser()).toMatchObject({ isAnonymous: true });
    expect(arena.backend.denials.filter(d => !/expire/.test(d.reason) && d.op !== 'get')).toEqual([]);
    // the expired lobby was retired by the joining client (rule: any signed-in user, after expireAt)
    expect(arena.backend.adminGet('matches/' + expired).status).toBe('expired');
    expect(g.errors).toEqual([]);
  });

  test('guest cannot host: blocked in the UI and rejected by the rules', async ({ arena }) => {
    const g = await arena.device({ width: DESKTOP });
    await g.goto('/');
    await openVs(g);
    const hostBtn = g.page.locator('[data-vs="host"]');
    await expect(hostBtn).toBeDisabled();
    await hostBtn.click({ force: true }).catch(() => {});
    await expect(g.page.locator('[data-vs="code"]')).toHaveCount(0);
    expect(arena.backend.adminList('matches')).toEqual([]);
    // even a hand-rolled attempt from the guest's own session is refused by the rules
    const r = await g.page.evaluate(async () => {
      await Cloud.signInGuest();
      const { F, db } = Cloud.fb, uid = Cloud.uid(), out = {};
      const doc = { hostUid: uid, hostNick: 'Bold Boron', cls: 'class1', deck: 's20', room: 'mixed', seed: 1, cap: 20, allowGuests: true, listed: true, status: 'lobby',
        createdAt: F.serverTimestamp(), expireAt: F.Timestamp.fromMillis(Date.now() + 1e5), playerCount: 1, startAt: null, alive: 1, aggUid: uid,
        aggUntil: F.Timestamp.fromMillis(Date.now() + 1e4), winnerUid: null, endedAt: null, rematch: null };
      try { await F.setDoc(F.doc(db, 'matches', 'ABCDEF'), doc); out.create = 'allowed'; } catch (e) { out.create = e.code; }
      try { await F.getDocs(F.query(F.collection(db, 'matches'), F.where('listed', '==', true), F.where('status', '==', 'lobby'), F.where('cls', '==', 'class1'))); out.list = 'allowed'; } catch (e) { out.list = e.code; }
      try { await F.setDoc(F.doc(db, 'players', uid), { progress: {}, nick: 'x', cls: 'y', updated: F.serverTimestamp() }); out.players = 'allowed'; } catch (e) { out.players = e.code; }
      await Cloud.signOutGuest();
      return out;
    });
    expect(r).toEqual({ create: 'permission-denied', list: 'permission-denied', players: 'permission-denied' });
    expect(arena.backend.adminList('matches')).toEqual([]);
    expect(arena.backend.adminList('players')).toEqual([]);
  });

  test('a signed-out visitor sees the join form with a generated name and a Shuffle button that changes it', async ({ arena }) => {
    const g = await arena.device({ width: PHONE });
    await g.goto('/');
    await openVs(g);
    const name = g.page.locator('[data-vs="guest-name"]');
    const names = new Set([await name.innerText()]);
    for (let i = 0; i < 12 && names.size < 3; i++) { await g.page.locator('[data-vs="guest-shuffle"]').click(); names.add(await name.innerText()); }
    expect(names.size).toBeGreaterThanOrEqual(3);
    for (const n of names) expect(n).toMatch(/^[A-Z][a-z]{2,11} [A-Z][a-z]{2,11}$/);   // what the rules accept
    expect(await g.currentUser()).toBeNull();                                      // nothing signs in until Join is tapped
  });
});

test.describe('class lobby', () => {
  test('a student from another class joins by code, but does not see the host\'s arena in their class lobby; classmates do', async ({ arena }) => {
    const host = await arena.device({ width: DESKTOP }), mate = await arena.device({ width: PHONE }), other = await arena.device({ width: PHONE });
    await host.goto('/'); await mate.goto('/'); await other.goto('/');
    await host.signUp('class1', 'hosty'); await mate.signUp('class1', 'mate'); await other.signUp('class2', 'outsider');
    const code = await hostArena(host);
    const unlisted = await arena.client('h2'); await unlisted.signUp('class1', 'quiet'); await unlisted.createMatch({ listed: false });
    // classmate sees exactly the listed arena
    await openVs(mate);
    await expect(mate.page.locator('[data-vs="lobby-join"]')).toHaveCount(1);
    await expect(mate.page.locator(`[data-vs="lobby-join"][data-code="${code}"]`)).toBeVisible();
    await expect(mate.page.locator('[data-vs="lobby-list"]')).toContainText('hosty');
    // the other class sees nothing...
    await openVs(other);
    await expect(other.page.locator('[data-vs="lobby-list"]')).toBeVisible();
    await expect(other.page.locator('[data-vs="lobby-join"]')).toHaveCount(0);
    await expect(other.page.locator('[data-vs="lobby-list"]')).not.toContainText('hosty');
    // ...but the code works for them
    await joinByCodeOk(other, code);
    await expect(host.page.locator('[data-vs="lobby-players"] li')).toHaveCount(2);
    await expect(host.page.locator('[data-vs="lobby-players"]')).toContainText('outsider');
    expect(arena.backend.denials).toEqual([]);
    // joining from the lobby works for the classmate and the list updates live for the others
    await joinFromLobby(mate, code);
    await expect(host.page.locator('[data-vs="lobby-players"] li')).toHaveCount(3);
    expect(host.errors).toEqual([]); expect(mate.errors).toEqual([]); expect(other.errors).toEqual([]);
  });

  test('host options: List in class lobby off hides the arena; Allow guests off turns guests away; cap shows in the lobby; copy button copies only the code', async ({ arena }) => {
    const host = await arena.device({ width: DESKTOP }), mate = await arena.device({ width: PHONE }), g = await arena.device({ width: PHONE });
    await host.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await host.goto('/'); await mate.goto('/'); await g.goto('/');
    await host.signUp('class1', 'hosty'); await mate.signUp('class1', 'mate');
    const code = await hostArena(host, { cap: 3, listed: false, allowGuests: false });
    await expect(host.page.locator('#vs-count')).toHaveText('1/3');
    await host.page.locator('[data-vs="copy"]').click();
    expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await openVs(mate);
    await expect(mate.page.locator('[data-vs="lobby-join"]')).toHaveCount(0);       // unlisted
    await joinByCodeOk(mate, code);                                                  // still joinable by code
    await openVs(g);
    await joinByCode(g, code, { open: false });
    await expect(errorText(g)).toHaveText(MSG.noguests);
    // host flips Allow guests on in the lobby; the guest can now take the open seat
    await host.page.setChecked('[data-vs="allow-guests"]', true);
    await expect.poll(() => arena.backend.adminGet('matches/' + code).allowGuests).toBe(true);
    await g.page.locator('[data-vs="join-submit"]').click();
    await expect(g.page.locator('[data-vs="code"]')).toHaveText(code);
    await expect(host.page.locator('#vs-count')).toHaveText('3/3');
    // cap reached: a fourth player is told it is full
    const late = await arena.device({ width: PHONE }); await late.goto('/'); await openVs(late);
    await joinByCode(late, code, { open: false });
    await expect(errorText(late)).toHaveText(MSG.full);
  });

  test('the 10-minute start timer begins when a second player joins, stops if they leave, and then expires the lobby (scaled)', async ({ arena }) => {
    const ts = 0.01;                                                                  // 10 min -> 6 s, the 60 min solo hold -> 36 s
    const host = await arena.device({ width: DESKTOP, timeScale: ts }), kid = await arena.device({ width: PHONE, timeScale: ts });
    for (const d of [host, kid]) await d.goto('/');
    await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo');
    const code = await hostArena(host);
    const left = () => arena.backend.adminGet('matches/' + code).expireAt.__ts - Date.now();
    const expiry = host.page.locator('#vs-expiry');
    // host alone: no countdown, just the solo hold
    await expect(host.page.locator('[data-vs="start"]')).toBeDisabled();
    await expect(expiry).toHaveText(/begins when a second player joins/);
    expect(left()).toBeGreaterThan(30000);                                           // ~36 s left: the solo hold, not 10 min (6 s)
    // second player: the 10-minute countdown starts
    await joinByCodeOk(kid, code);
    await expect(expiry).toHaveText(/closes in (9|10):\d\d/);
    expect(left()).toBeGreaterThan(9 * 60e3 * ts - 1500); expect(left()).toBeLessThanOrEqual(10 * 60e3 * ts + 500);
    // they leave: back to waiting, no countdown
    await kid.page.locator('[data-vs="leave"]').click();
    await expect(expiry).toHaveText(/begins when a second player joins/);
    expect(left()).toBeGreaterThan(30000);
    // they come back: a fresh 10 minutes, and this time nobody starts, so the lobby expires
    await joinByCodeOk(kid, code);
    await expect(expiry).toHaveText(/closes in (9|10):\d\d/);
    await expect(host.page.locator('[data-vs="gone-msg"]')).toHaveText(/expired/i, { timeout: 20000 });
    await expect.poll(() => arena.backend.adminGet('matches/' + code).status, { timeout: 5000 }).toBe('expired');
    expect(arena.backend.denials.filter(d => !['get', 'list'].includes(d.op)), JSON.stringify(arena.backend.denials)).toEqual([]);   // reads: the kid's listener after leaving
  });
});

test('screenshots: lobby waiting for a second player, then the 10-minute countdown', async ({ arena }) => {
  const host = await arena.device({ width: PHONE }), kid = await arena.device({ width: PHONE });
  for (const d of [host, kid]) await d.goto('/');
  await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo');
  const code = await hostArena(host);
  await expect(host.page.locator('#vs-expiry')).toHaveText(/begins when a second player joins/);
  await host.page.screenshot({ path: '../docs/lobby-timer/lobby-alone-390.png' });
  await joinByCodeOk(kid, code);
  await expect(host.page.locator('#vs-expiry')).toHaveText(/closes in (9|10):\d\d/);
  await host.page.locator('#vs-expiry').scrollIntoViewIfNeeded();
  await host.page.screenshot({ path: '../docs/lobby-timer/lobby-countdown-390.png' });
});
