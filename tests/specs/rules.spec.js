// Rules fake cases (tests/fake/rules.js), driven by scripted clients. No browser needed.
// Each rejection must surface as a FirebaseError with code 'permission-denied'.
import { test, expect } from '../helpers/fixtures.js';
import { expectDenied, expectCode, openLobby, signedKid, guest } from '../helpers/arena.js';

test.describe('rules: guests (anonymous)', () => {
  test('guest cannot list matches, signed-in classmate can list own class only', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid');
    const other = await signedKid(arena, 'stranger', 'class2');
    const g = await guest(arena);
    await expectDenied(g.listLobby({ cls: 'class1' }), 'not anonymous');
    expect((await kid.listLobby()).map(m => m.id)).toEqual([code]);
    expect(await other.listLobby()).toEqual([]);
    await expectDenied(other.listLobby({ cls: 'class1' }), "caller's cls");   // cannot peek at another class
    // an unconstrained list is rejected even for signed-in users
    const F = kid.F;
    await expectDenied(F.getDocs(F.collection(kid.db, 'matches')), 'listed == true');
    await expectDenied(F.getDocs(F.query(F.collection(kid.db, 'matches'), F.where('cls', '==', 'class1'))), 'listed == true');
    expect(host.uid).toBeTruthy();
  });

  test('guest can read one match by code (needed to join) but cannot create a match', async ({ arena }) => {
    const { code } = await openLobby(arena);
    const g = await guest(arena);
    expect((await g.getMatch(code)).status).toBe('lobby');
    await expectDenied(g.createMatch({ cls: 'class1' }), 'not anonymous');
    // even bypassing the helper: a hand-written match doc is refused
    await expectDenied(g.F.setDoc(g.ref('matches', 'ZZZZZZ'), g.matchDoc({ cls: 'class1' })));
  });

  test('guest cannot read or write /players, and cannot read others', async ({ arena }) => {
    const kid = await signedKid(arena, 'kid');
    const g = await guest(arena);
    const F = g.F;
    await expectDenied(F.getDoc(g.ref('players', kid.uid)));
    await expectDenied(F.getDoc(g.ref('players', g.uid)), 'not anonymous');
    await expectDenied(F.setDoc(g.ref('players', g.uid), { progress: {}, nick: 'x', cls: 'y', updated: F.serverTimestamp() }), 'not anonymous');
    await expectDenied(F.setDoc(g.ref('players', kid.uid), { progress: {}, nick: 'x', cls: 'y', updated: F.serverTimestamp() }));
    // signed-in student: own doc only, whitelisted keys only (vs and vsAt allowed)
    await expectDenied(kid.F.getDoc(kid.ref('players', g.uid)));
    await kid.F.updateDoc(kid.ref('players', kid.uid), { 'progress.vs': { w: 1, l: 0, streak: 1, best: 1, played: 1 }, 'progress.vsAt': 123 });
    await expectDenied(kid.F.updateDoc(kid.ref('players', kid.uid), { 'progress.cheat': 1 }), 'whitelisted');
    await expectDenied(kid.F.updateDoc(kid.ref('players', kid.uid), { admin: true }), 'hasOnly');
  });

  test('guest takes one open seat when allowGuests is true', async ({ arena }) => {
    const { code } = await openLobby(arena, { match: { cap: 2, allowGuests: true } });
    const g = await guest(arena);
    await g.join(code);
    expect((await g.getMatch(code)).playerCount).toBe(2);
    const players = await g.players(code);
    expect(players.find(p => p.id === g.uid).guest).toBe(true);
    // the seat is the last one: a second guest is turned away
    const g2 = await guest(arena, 'Swift Neon');
    await expectDenied(g2.join(code, { check: false }), 'playerCount < cap');
    expect((await g2.F.getDoc(g2.ref('matches', code))).data().playerCount).toBe(2);
  });

  test('guest is rejected when allowGuests is false', async ({ arena }) => {
    const { code } = await openLobby(arena, { match: { allowGuests: false } });
    const g = await guest(arena);
    await expect(g.join(code)).rejects.toMatchObject({ reason: 'guests-off' });       // UI-level check
    await expectDenied(g.join(code, { check: false }), 'allowGuests');                 // rules still enforce it
    expect((await g.getMatch(code)).playerCount).toBe(1);
    const kid = await signedKid(arena, 'kid');
    await kid.join(code);                                                              // signed-in is unaffected
    expect((await kid.getMatch(code)).playerCount).toBe(2);
  });

  test('guest cannot claim to be a signed-in player, spoof guest flag or aggregate', async ({ arena }) => {
    const { code } = await openLobby(arena);
    const g = await guest(arena);
    await expectDenied(g.join(code, { check: false, playerExtra: { guest: false } }), 'guest == (provider is anonymous)');
    await g.join(code);
    await expectDenied(g.F.updateDoc(g.ref('matches', code), { aggUid: g.uid, aggUntil: g.F.Timestamp.fromMillis(arena.backend.now() + 1000) }), 'participant');
    await expectDenied(g.F.updateDoc(g.ref('matches', code, 'players', g.uid), { guest: false }), 'never change');
  });
});

test.describe('rules: answers', () => {
  async function playing(arena) {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid');
    await kid.join(code);
    await host.start(code);
    return { host, kid, code };
  }

  test('a player writes their own answer; cannot write another uid\'s answer', async ({ arena }) => {
    const { host, kid, code } = await playing(arena);
    await kid.answer(code, 0, { choice: 2, elapsedMs: 3000, correct: true });
    const mine = await kid.F.getDoc(kid.ref('matches', code, 'answers', `${kid.uid}_0`));
    expect(mine.data()).toMatchObject({ q: 0, choice: 2, correct: true, elapsedMs: 3000 });
    // forging an answer in the host's name
    await expectDenied(kid.F.setDoc(kid.ref('matches', code, 'answers', `${host.uid}_0`),
      { q: 0, choice: 0, elapsedMs: 100, correct: true, points: 150, at: kid.F.serverTimestamp() }), '{uid}_{q}');
    // and answers are private: nobody reads someone else's choice
    await expectDenied(host.F.getDoc(host.ref('matches', code, 'answers', `${kid.uid}_0`)), 'owner only');
    await expectDenied(host.F.getDocs(host.F.collection(host.db, 'matches', code, 'answers')));
  });

  test('cannot write a second answer for the same q', async ({ arena }) => {
    const { kid, code } = await playing(arena);
    await kid.answer(code, 3, { correct: false, choice: 1 });
    const err = await expectDenied(kid.answer(code, 3, { correct: true, choice: 0 }));
    expect(err.detail).toMatch(/update/);
    // the rejected batch applied nothing: score still reflects only the first answer
    const me = (await kid.players(code)).find(p => p.id === kid.uid);
    expect(me.score).toBe(0); expect(me.correct).toBe(0); expect(me.answeredQ).toBe(3);
  });

  test('answer shape: q must match id and 0..9, points <= 150, wrong means 0, only while playing, only participants', async ({ arena }) => {
    const { host, kid, code } = await playing(arena);
    const F = kid.F, doc = (q, o = {}) => ({ q, choice: 0, elapsedMs: 500, correct: true, points: 120, at: F.serverTimestamp(), ...o });
    const ans = (id, d) => F.setDoc(kid.ref('matches', code, 'answers', id), d);
    await expectDenied(ans(`${kid.uid}_1`, doc(2)), '{uid}_{q}');
    await expectDenied(ans(`${kid.uid}_10`, doc(10)), '{uid}_{q}');
    await expectDenied(ans(`${kid.uid}_1`, doc(1, { points: 151 })), 'points');
    await expectDenied(ans(`${kid.uid}_1`, doc(1, { correct: false, points: 50 })), 'points');
    await expectDenied(ans(`${kid.uid}_1`, doc(1, { extra: 1 })), 'allowed keys');
    await ans(`${kid.uid}_1`, doc(1));                                           // valid one goes through
    const outsider = await signedKid(arena, 'outsider');
    await expectDenied(outsider.F.setDoc(outsider.ref('matches', code, 'answers', `${outsider.uid}_0`), { q: 0, choice: 0, elapsedMs: 1, correct: true, points: 100, at: F.serverTimestamp() }), 'participant');
    await host.finish(code, host.uid);
    await expectDenied(ans(`${kid.uid}_2`, doc(2)), "'playing'");
  });
});

test.describe('rules: match document', () => {
  test('host cannot raise cap above 20 (create or update), nor below 2', async ({ arena }) => {
    const { host, code } = await openLobby(arena, { match: { cap: 10 } });
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { cap: 21 }), 'settings');
    await host.F.updateDoc(host.ref('matches', code), { cap: 20 });
    expect((await host.getMatch(code)).cap).toBe(20);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { cap: 1 }), 'settings');
    const h2 = arena.client('h2'); await h2.signUp('class1', 'host2');
    await expectDenied(h2.createMatch({ cap: 21 }), 'cap is an int 2..20');
    await expectDenied(h2.createMatch({ cap: 1 }), 'cap is an int 2..20');
    await expectDenied(h2.createMatch({ cap: 2.5 }), 'cap is an int 2..20');
  });

  test('status cannot move backward or skip', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid'); await kid.join(code);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { status: 'done', winnerUid: host.uid, endedAt: host.F.serverTimestamp() }), 'status moves forward');
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code), { status: 'playing', startAt: kid.F.serverTimestamp() }), 'startAt: host only');
    await host.start(code);
    const upd = (c, d) => c.F.updateDoc(c.ref('matches', code), d);
    await expectDenied(upd(host, { status: 'lobby' }), 'status moves forward');
    await expectDenied(upd(host, { status: 'expired' }), 'lobby -> expired');
    await expectDenied(upd(host, { startAt: host.F.serverTimestamp() }), 'startAt');
    await kid.finish(code, host.uid);                              // any participant can end a playing match
    const d = await host.getMatch(code);
    expect(d.status).toBe('done'); expect(d.winnerUid).toBe(host.uid);
    await expectDenied(upd(host, { status: 'playing' }), 'finished matches only accept rematch');
    await expectDenied(upd(host, { status: 'lobby' }), 'finished matches only accept rematch');
    await expectDenied(upd(kid, { winnerUid: kid.uid }), 'finished matches only accept rematch');
    await expectDenied(upd(kid, { rematch: 'ABC234' }), 'host only');
    await upd(host, { rematch: 'ABC234' });                        // host can announce a rematch, once
    await expectDenied(upd(host, { rematch: 'ABC235' }), 'rematch');
  });

  test('a non-host cannot change the seed (or any setting); host can only in the lobby', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid'); await kid.join(code);
    const seed0 = (await host.getMatch(code)).seed;
    for (const d of [{ seed: 1 }, { deck: 'r4' }, { room: 'symbol' }, { cap: 5 }, { allowGuests: false }, { listed: false }])
      await expectDenied(kid.F.updateDoc(kid.ref('matches', code), d), 'settings');
    expect((await host.getMatch(code)).seed).toBe(seed0);
    await host.F.updateDoc(host.ref('matches', code), { seed: 99, deck: 'r4', listed: false });
    expect(await host.getMatch(code)).toMatchObject({ seed: 99, deck: 'r4', listed: false });
    await host.start(code);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { seed: 5 }), 'settings');   // no reseeding mid-match
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { hostUid: kid.uid }), 'mutable');
  });

  test('create requires exact keys, own class, status lobby, and the host player doc in the same batch', async ({ arena }) => {
    const h = arena.client('h'); await h.signUp('class1', 'host');
    const F = h.F, md = o => h.matchDoc(o);
    const put = (code, d) => { const b = F.writeBatch(h.db); b.set(h.ref('matches', code), d); b.set(h.ref('matches', code, 'players', h.uid), h.playerDoc()); return b.commit(); };
    await expectDenied(put('AAAAAA', md({ cls: 'class9' })), 'cls and hostNick');
    await expectDenied(put('AAAAAA', md({ status: 'playing' })), "status == 'lobby'");
    await expectDenied(put('AAAAAA', md({ playerCount: 2 })), 'playerCount == 1');
    await expectDenied(put('AAAAAA', md({ extra: 1 })), 'exactly the allowed keys');
    await expectDenied(put('AAAAAA', md({ createdAt: F.Timestamp.fromMillis(1) })), 'createdAt');
    await expectDenied(put('AAAAAA', md({ hostUid: 'someone-else' })), 'hostUid');
    await expectDenied(put('AAAAAA', md({ deck: 'nope' })), 'known ids');
    await expectDenied(put('AAAAAA', md({ expireAt: F.Timestamp.fromMillis(arena.backend.now() + 3600e3) })), 'expireAt');
    await expectDenied(put('AAAIAA', md()), '6 chars');                       // I is not in the code alphabet
    await expectDenied(F.setDoc(h.ref('matches', 'BBBBBB'), md()), "host's player doc");   // no player doc in the batch
    await put('CCCCCC', md());
    expect((await h.getMatch('CCCCCC')).playerCount).toBe(1);
  });
});

test.describe('rules: joining', () => {
  test('join is rejected when full, started, finished, expired; allowed in the lobby', async ({ arena }) => {
    const { host, code } = await openLobby(arena, { match: { cap: 3 } });
    const [a, b, c] = [await signedKid(arena, 'a'), await signedKid(arena, 'b'), await signedKid(arena, 'c')];
    await a.join(code); await b.join(code);
    await expect(c.join(code)).rejects.toMatchObject({ reason: 'full' });
    await expectDenied(c.join(code, { check: false }), 'playerCount < cap');
    expect((await host.getMatch(code)).playerCount).toBe(3);

    // started
    const lobby2 = await host.createMatch({ cap: 5 }); await a.join(lobby2); await host.start(lobby2);
    await expect(b.join(lobby2)).rejects.toMatchObject({ reason: 'started' });
    await expectDenied(b.join(lobby2, { check: false }), 'status lobby');
    // finished
    await host.finish(lobby2, host.uid);
    await expect(b.join(lobby2)).rejects.toMatchObject({ reason: 'finished' });
    await expectDenied(b.join(lobby2, { check: false }), 'status lobby');
    // missing
    await expect(b.join('NOPE22')).rejects.toMatchObject({ reason: 'missing' });
    await expectCode(b.join('NOPE22', { check: false }), 'not-found');       // transaction update of a missing match

    // expired: five minutes pass, nobody started it
    const lobby3 = await host.createMatch({ cap: 5 });
    await expectDenied(b.expire(lobby3), 'expireAt');                       // too early
    arena.backend.advanceClock(5 * 60 * 1000 + 1000);
    await expect(b.join(lobby3)).rejects.toMatchObject({ reason: 'expired' });
    await expectDenied(b.join(lobby3, { check: false }), 'not expired');
    await b.expire(lobby3);                                                 // any signed-in user may expire it now
    expect((await b.getMatch(lobby3)).status).toBe('expired');
    await expectDenied(host.start(lobby3), 'finished matches');             // expired is terminal
  });

  test('join needs your own uid, matching nick, a clean initial doc, and the playerCount bump', async ({ arena }) => {
    const { code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid');
    const F = kid.F, bump = () => kid.F.updateDoc(kid.ref('matches', code), { playerCount: F.increment(1) });
    const join = async (pdoc, doBump = true) => { const b = F.writeBatch(kid.db); b.set(kid.ref('matches', code, 'players', kid.uid), pdoc); if (doBump) b.update(kid.ref('matches', code), { playerCount: F.increment(1) }); return b.commit(); };
    await expectDenied(join(kid.playerDoc({ nick: 'someoneelse' })), 'nick');
    await expectDenied(join(kid.playerDoc({ score: 500 })), 'initial score');
    await expectDenied(join(kid.playerDoc(), false), 'playerCount by exactly 1');
    await expectDenied(bump(), 'participant');                                // cannot bump the count without a seat
    const b = F.writeBatch(kid.db);
    b.set(kid.ref('matches', code, 'players', 'a-friend'), kid.playerDoc());
    b.update(kid.ref('matches', code), { playerCount: F.increment(1) });
    await expectDenied(b.commit(), 'pid == uid');                              // cannot seat someone else
    await join(kid.playerDoc());
    await expectDenied(join(kid.playerDoc()), 'playerCount: +1');                 // re-joining = rewriting own doc (new joinedAt) + another count bump
  });

  test('lobby leave lowers the count; players cannot edit each other, except the aggregator marking abandoned', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const a = await signedKid(arena, 'a'), b = await signedKid(arena, 'b');
    await a.join(code); await b.join(code);
    await a.leaveLobby(code);
    expect((await host.getMatch(code)).playerCount).toBe(2);
    await expectDenied(b.F.deleteDoc(b.ref('matches', code, 'players', host.uid)), 'pid == uid');
    await expectDenied(b.F.deleteDoc(b.ref('matches', code, 'players', b.uid)), 'playerCount');   // bare delete: count not lowered
    await host.start(code);
    await expectDenied(b.leaveLobby(code), 'lobby');                              // no leaving by delete once playing
    // aggregator marks a stale player abandoned
    await host.F.updateDoc(host.ref('matches', code, 'players', b.uid), { abandoned: true });
    await expectDenied(host.F.updateDoc(host.ref('matches', code, 'players', b.uid), { score: 999 }), 'abandoned');
    await expectDenied(b.F.updateDoc(b.ref('matches', code, 'players', b.uid), { abandoned: false }), 'cannot come back');
    // answeredQ only moves forward, reactions are presets
    await b.F.updateDoc(b.ref('matches', code, 'players', b.uid), { answeredQ: 2, reaction: 'Fire', reactionAt: b.F.serverTimestamp() });
    await expectDenied(b.F.updateDoc(b.ref('matches', code, 'players', b.uid), { answeredQ: 1 }), 'answeredQ');
    await expectDenied(b.F.updateDoc(b.ref('matches', code, 'players', b.uid), { reaction: 'you stink' }), 'presets');
    expect(host.uid).toBeTruthy();
  });

  test('only participants read players and presence; aggregator lease rules', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid'), out = await signedKid(arena, 'out');
    await kid.join(code);
    expect((await kid.players(code)).length).toBe(2);
    await expectDenied(out.players(code), 'participant');
    await expectDenied(out.F.getDoc(out.ref('matches', code, 'players', kid.uid)), 'participant');
    expect((await out.F.getDoc(out.ref('matches', code, 'players', out.uid))).exists()).toBe(false);   // own (absent) doc readable: join tx may probe it
    const F = kid.F, at = () => ({ at: F.Timestamp.fromMillis(arena.backend.now()) });
    await F.setDoc(kid.ref('matches', code, 'presence', kid.uid), at());
    await expectDenied(F.setDoc(kid.ref('matches', code, 'presence', host.uid), at()), 'pid == uid');
    await expectDenied(out.F.setDoc(out.ref('matches', code, 'presence', out.uid), { at: out.F.Timestamp.fromMillis(1) }), 'participant');
    await host.start(code);
    const lease = c => ({ aggUid: c.uid, aggUntil: c.F.Timestamp.fromMillis(arena.backend.now() + 30000), alive: 2 });
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code), lease(kid)), 'non-anonymous aggregator');     // host's lease is fresh
    await host.F.updateDoc(host.ref('matches', code), lease(host));                                              // host renews own lease
    arena.backend.advanceClock(45000);                                                                           // lease goes stale
    await kid.F.updateDoc(kid.ref('matches', code), lease(kid));                                                 // participant claims it
    expect((await kid.getMatch(code)).aggUid).toBe(kid.uid);
  });
});
