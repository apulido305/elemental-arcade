// Scripted clients (no browser) against the shared backend: capacity and contention.
import { test, expect } from '../helpers/fixtures.js';
import { expectDenied, expectCode, openLobby } from '../helpers/arena.js';

test('20 scripted joiners fill a cap-20 arena and the 21st is rejected', async ({ arena }) => {
  const { host, code } = await openLobby(arena);                  // cap defaults to 20
  const joiners = [];
  for (let i = 1; i < 20; i++) {
    const c = arena.client('p' + i);
    joiners.push(i % 5 === 0 ? c.signInGuest(`Guest ${i}`) : c.signUp('class1', 'kid' + i));   // 3 guests among the 19
  }
  const kids = arena.clients.slice(1);
  await Promise.all(joiners);
  await Promise.all(kids.map(k => k.join(code)));                 // all 19 at once: transaction contention + retries
  const m = await host.getMatch(code);
  expect(m.playerCount).toBe(20);
  const players = await host.players(code);
  expect(players.length).toBe(20);
  expect(new Set(players.map(p => p.id)).size).toBe(20);
  expect(players.filter(p => p.guest).length).toBe(3);

  const late = arena.client('late'); await late.signUp('class1', 'late');
  await expect(late.join(code)).rejects.toMatchObject({ reason: 'full' });                    // UI-level message
  await expectDenied(late.join(code, { check: false }), 'playerCount < cap');                  // rules enforce it too
  const lateGuest = arena.client('lateg'); await lateGuest.signInGuest('Calm Cobalt');
  await expectDenied(lateGuest.join(code, { check: false }), 'playerCount < cap');
  expect((await host.getMatch(code)).playerCount).toBe(20);
  expect((await host.players(code)).length).toBe(20);
});

test('optimistic concurrency: conflicting transactions retry; retries are bounded like the real SDK', async ({ arena }) => {
  const { host, code } = await openLobby(arena);
  // default SDK behaviour (5 attempts): three simultaneous joiners all get a seat after retrying
  const opts = { txMaxAttempts: 5, txBackoffMs: 2 };
  const kids = await Promise.all([1, 2, 3].map(async i => { const c = arena.client('k' + i, opts); await c.signUp('class1', 'k' + i); return c; }));
  const attempts = [];
  await Promise.all(kids.map(async c => {
    const F = c.F, mref = c.ref('matches', code);
    await F.runTransaction(c.db, async tx => {
      attempts.push(c.name);
      const m = await tx.get(mref);
      tx.set(c.ref('matches', code, 'players', c.uid), c.playerDoc());
      tx.update(mref, { playerCount: m.data().playerCount + 1 });     // read-modify-write on purpose
    });
  }));
  expect((await host.getMatch(code)).playerCount).toBe(4);
  expect(attempts.length).toBeGreaterThan(3);                                                 // somebody had to retry

  // with a single attempt the loser of the race fails with 'aborted' (what 5 attempts can also hit with ~20 contenders)
  const one = { txMaxAttempts: 1 };
  const [x, y] = await Promise.all([1, 2].map(async i => { const c = arena.client('s' + i, one); await c.signUp('class1', 's' + i); return c; }));
  const results = await Promise.allSettled([x, y].map(c => c.join(code)));
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
  const rejected = results.find(r => r.status === 'rejected');
  expect(rejected.reason.code).toBe('aborted');
  expect((await host.getMatch(code)).playerCount).toBe(5);
});
