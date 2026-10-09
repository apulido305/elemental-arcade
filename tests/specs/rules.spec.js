// Rules fake cases (tests/fake/rules.js), driven by scripted clients. No browser needed.
// Each rejection must surface as a FirebaseError with code 'permission-denied'.
import { test, expect } from '../helpers/fixtures.js';
import { expectDenied, expectCode, openLobby, signedKid, guest, toQuestion } from '../helpers/arena.js';

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
    await expectDenied(g.F.updateDoc(g.ref('matches', code), { aggUid: g.uid, aggUntil: g.F.Timestamp.fromMillis(arena.backend.now() + 1000) }));
    await expectDenied(g.F.updateDoc(g.ref('matches', code, 'players', g.uid), { guest: false }), 'nick, guest, joinedAt fixed');
  });
});

test.describe('rules: answers and scoring', () => {
  /** host + kid in a started match; the backend clock sits in question 0's window. */
  async function playing(arena, extra = {}) {
    const { host, code } = await openLobby(arena, extra);
    const kid = await signedKid(arena, 'kid');
    await kid.join(code);
    await host.start(code);
    toQuestion(arena, code, 0);
    return { host, kid, code };
  }

  test('a player writes their own answer; cannot write another uid answer', async ({ arena }) => {
    const { host, kid, code } = await playing(arena);
    await kid.answer(code, 0, { choice: 2, elapsedMs: 3000, correct: true });
    const mine = await kid.F.getDoc(kid.ref('matches', code, 'answers', `${kid.uid}_0`));
    expect(mine.data()).toMatchObject({ q: 0, choice: 2, correct: true, elapsedMs: 3000 });
    expect((await kid.players(code)).find(p => p.id === kid.uid)).toMatchObject({ score: 140, correct: 1, totalMs: 3000, answeredQ: 0 });
    await expectDenied(kid.F.setDoc(kid.ref('matches', code, 'answers', `${host.uid}_0`),
      { q: 0, choice: 0, elapsedMs: 100, correct: true, points: 150, at: kid.F.serverTimestamp() }), '{uid}_{q}');
    await expectDenied(host.F.getDoc(host.ref('matches', code, 'answers', `${kid.uid}_0`)), 'owner only');
    await expectDenied(host.F.getDocs(host.F.collection(host.db, 'matches', code, 'answers')));
  });

  test('cannot write a second answer for the same q', async ({ arena }) => {
    const { kid, code } = await playing(arena);
    await kid.answer(code, 0, { correct: false, choice: 1 });
    await expectDenied(kid.answer(code, 0, { correct: true, choice: 0 }));
    const me = (await kid.players(code)).find(p => p.id === kid.uid);
    expect(me.score).toBe(0); expect(me.correct).toBe(0); expect(me.answeredQ).toBe(0);   // rejected batch applied nothing
  });

  test('answer shape: id/q match, points <= 150, wrong means 0, elapsedMs <= 15 s, only while playing, only seated players', async ({ arena }) => {
    const { host, kid, code } = await playing(arena);
    const F = kid.F;
    const batch = (q, o = {}, seat = {}) => {
      const b = F.writeBatch(kid.db);
      b.set(kid.ref('matches', code, 'answers', o.id || `${kid.uid}_${q}`), { q, choice: 0, elapsedMs: 500, correct: true, points: 120, at: F.serverTimestamp(), ...o.doc });
      b.update(kid.ref('matches', code, 'players', kid.uid), { score: F.increment(120), correct: F.increment(1), totalMs: F.increment(500), answeredQ: q, lastSeen: F.serverTimestamp(), ...seat });
      return b.commit();
    };
    await expectDenied(batch(0, { id: `${kid.uid}_1` }), '{uid}_{q}');
    await expectDenied(batch(10), 'q int 0..9');
    await expectDenied(batch(0, { doc: { points: 151 } }, { score: F.increment(151) }), 'points int 0..150');
    await expectDenied(batch(0, { doc: { correct: false, points: 50 } }), '0 when wrong');
    await expectDenied(batch(0, { doc: { extra: 1 } }), 'exactly the allowed keys');
    await expectDenied(batch(0, { doc: { elapsedMs: 15001 } }, { totalMs: F.increment(15001) }), 'elapsedMs <= 15000');
    await expectDenied(batch(0, {}, { answeredQ: 3 }), 'answeredQ == q');
    await batch(0);                                                                   // the valid one goes through
    const outsider = await signedKid(arena, 'outsider');
    await expectDenied(outsider.F.setDoc(outsider.ref('matches', code, 'answers', `${outsider.uid}_0`), { q: 0, choice: 0, elapsedMs: 1, correct: true, points: 100, at: F.serverTimestamp() }), 'participant');
    toQuestion(arena, code, 1);
    await host.finish(code, host.uid);                                                // an account ending early is allowed
    await expectDenied(kid.answer(code, 1), "'playing'");
  });

  test('score bump with no answer doc is rejected, as is a mismatched bump', async ({ arena }) => {
    const { kid, code } = await playing(arena);
    const F = kid.F, seat = kid.ref('matches', code, 'players', kid.uid);
    await expectDenied(F.updateDoc(seat, { score: F.increment(100) }), 'brand-new answer doc');                    // no answer at all
    await expectDenied(F.updateDoc(seat, { score: F.increment(100), correct: F.increment(1), answeredQ: 0 }), 'brand-new answer doc');
    await expectDenied(F.updateDoc(seat, { correct: F.increment(1) }), 'brand-new answer doc');
    await expectDenied(F.updateDoc(seat, { totalMs: F.increment(10) }), 'brand-new answer doc');
    // answer doc says 120 points but the seat claims 150
    const b = F.writeBatch(kid.db);
    b.set(kid.ref('matches', code, 'answers', `${kid.uid}_0`), { q: 0, choice: 0, elapsedMs: 500, correct: true, points: 120, at: F.serverTimestamp() });
    b.update(seat, { score: F.increment(150), correct: F.increment(1), totalMs: F.increment(500), answeredQ: 0 });
    await expectDenied(b.commit(), 'exactly its values');
    // setting totals directly must also equal old + answer
    const b2 = F.writeBatch(kid.db);
    b2.set(kid.ref('matches', code, 'answers', `${kid.uid}_0`), { q: 0, choice: 0, elapsedMs: 500, correct: true, points: 120, at: F.serverTimestamp() });
    b2.update(seat, { score: 1500, correct: 1, totalMs: 500, answeredQ: 0 });
    await expectDenied(b2.commit(), 'exactly its values');
    expect((await kid.players(code)).find(p => p.id === kid.uid).score).toBe(0);
    await F.updateDoc(seat, { lastSeen: F.serverTimestamp(), streak: 0, reaction: 'nice', reactionAt: Date.now() });   // no answer needed for these
  });

  test('answer after the window and answer ahead of the window are rejected', async ({ arena }) => {
    const { kid, code } = await playing(arena);
    const ts = arena.backend.timeScale;
    toQuestion(arena, code, 2, 0);
    arena.backend.advanceClock(-5000 * ts - 1000);                                  // well before question 2 opens
    await expectDenied(kid.answer(code, 2), 'only while the question is on screen');   // ahead of the window
    toQuestion(arena, code, 2, 0.9);
    await kid.answer(code, 2, { elapsedMs: 15000 * ts - 1 });                       // late in its own window: fine
    toQuestion(arena, code, 3, 0); arena.backend.advanceClock(17000 * ts + 500);    // past qOpens + 17 s: the reveal is over
    await expectDenied(kid.answer(code, 3), 'only while the question is on screen');   // after the window
    toQuestion(arena, code, 3, 0.5);
    await kid.answer(code, 3, { elapsedMs: 7000 * ts });                             // right on time still works
    expect((await kid.players(code)).find(p => p.id === kid.uid).answeredQ).toBe(3);
  });

  test('an abandoned seat cannot answer, and abandoned can never go back to false', async ({ arena }) => {
    const { host, kid, code } = await playing(arena);
    await host.F.updateDoc(host.ref('matches', code, 'players', kid.uid), { abandoned: true });   // aggregator marks the kid
    await expectDenied(kid.answer(code, 0), 'seat is not abandoned');
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code, 'players', kid.uid), { abandoned: false }), 'stays abandoned');
    await expectDenied(host.F.updateDoc(host.ref('matches', code, 'players', kid.uid), { abandoned: false }), 'only abandoned changes, to true');
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code, 'players', kid.uid), { left: true, abandoned: false }), 'stays abandoned');
    await kid.F.updateDoc(kid.ref('matches', code, 'players', kid.uid), { left: true });         // other fields still writable
    expect((await kid.players(code)).find(p => p.id === kid.uid)).toMatchObject({ abandoned: true, left: true });
  });
});

test.describe('rules: match document', () => {
  test('host cannot raise cap above 20 (create or update), nor below 2 or below the seated count', async ({ arena }) => {
    const { host, code } = await openLobby(arena, { match: { cap: 10 } });
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { cap: 21 }), 'cap 2..20');
    await host.F.updateDoc(host.ref('matches', code), { cap: 20 });
    expect((await host.getMatch(code)).cap).toBe(20);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { cap: 1 }), 'cap 2..20');
    const kids = [await signedKid(arena, 'k1'), await signedKid(arena, 'k2')];
    for (const k of kids) await k.join(code);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { cap: 2 }), 'cap 2..20 and >= playerCount');
    const h2 = arena.client('h2'); await h2.signUp('class1', 'host2');
    await expectDenied(h2.createMatch({ cap: 21 }), 'cap is an int 2..20');
    await expectDenied(h2.createMatch({ cap: 1 }), 'cap is an int 2..20');
    await expectDenied(h2.createMatch({ cap: 2.5 }), 'cap is an int 2..20');
  });

  test('status cannot move backward or skip; start needs 2 players and the host', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    await expectDenied(host.start(code), 'playerCount >= 2');
    const kid = await signedKid(arena, 'kid'); await kid.join(code);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { status: 'done', winnerUid: host.uid, endedAt: host.F.serverTimestamp() }));   // lobby -> done
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code), { status: 'playing', startAt: kid.F.serverTimestamp() }), 'caller is the host');
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { status: 'playing', startAt: host.F.Timestamp.fromMillis(1) }), 'startAt == request.time');
    await host.start(code);
    const upd = (c, d) => c.F.updateDoc(c.ref('matches', code), d);
    await expectDenied(upd(host, { status: 'lobby' }));
    await expectDenied(upd(host, { status: 'expired' }));
    await expectDenied(upd(host, { startAt: host.F.serverTimestamp() }));
    await expectDenied(upd(host, { seed: 5 }));                                       // no reseeding mid-match
    await expectDenied(upd(host, { hostUid: kid.uid }));
    await upd(kid, { status: 'abandoned', endedAt: kid.F.serverTimestamp() });         // ending: an account may, at any time
    expect((await host.getMatch(code)).status).toBe('abandoned');
    await expectDenied(upd(host, { status: 'playing' }));
    await expectDenied(upd(host, { status: 'done', winnerUid: host.uid, endedAt: host.F.serverTimestamp() }));
  });

  test('done: winner must be seated, endedAt must be server time; host announces a rematch once', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid'); await kid.join(code); await host.start(code);
    const F = host.F, ref = host.ref('matches', code);
    await expectDenied(F.updateDoc(ref, { status: 'done', endedAt: F.serverTimestamp() }), 'done must set winnerUid');
    await expectDenied(F.updateDoc(ref, { status: 'done', winnerUid: 'nobody', endedAt: F.serverTimestamp() }), 'must be seated');
    await expectDenied(F.updateDoc(ref, { status: 'done', winnerUid: kid.uid, endedAt: F.Timestamp.fromMillis(5) }), 'endedAt == request.time');
    await kid.finish(code, kid.uid);
    expect((await host.getMatch(code))).toMatchObject({ status: 'done', winnerUid: kid.uid });
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code), { rematch: 'ABC234' }), 'caller is the host');
    await expectDenied(F.updateDoc(ref, { rematch: 'ABC23I' }), 'valid code');
    await F.updateDoc(ref, { rematch: 'ABC234' });
    await expectDenied(F.updateDoc(ref, { rematch: 'ABC235' }), 'no rematch yet');
    await expectDenied(F.updateDoc(ref, { winnerUid: host.uid }));
  });

  test('a guest cannot end the match early; after startAt+178 s any participant can', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const g = await guest(arena); await g.join(code);
    await host.start(code);
    const ts = arena.backend.timeScale;
    toQuestion(arena, code, 4);
    for (const status of ['done', 'abandoned']) {
      const patch = status === 'done' ? { status, winnerUid: host.uid, endedAt: g.F.serverTimestamp() } : { status, endedAt: g.F.serverTimestamp() };
      await expectDenied(g.F.updateDoc(g.ref('matches', code), patch), 'only an account may end the match');
    }
    expect((await host.getMatch(code)).status).toBe('playing');
    toQuestion(arena, code, 9, 1); arena.backend.advanceClock(2600 * ts + 100);        // just past startAt + 178 s
    const m = arena.backend.adminGet('matches/' + code);
    expect(arena.backend.now()).toBeGreaterThan(m.startAt.__ts + 178000 * ts);
    await g.F.updateDoc(g.ref('matches', code), { status: 'done', winnerUid: host.uid, endedAt: g.F.serverTimestamp() });
    expect((await host.getMatch(code)).status).toBe('done');
    // guests can never claim aggregation or publish alive
    const { host: h2, code: c2 } = await openLobby(arena, { nick: 'host2' });
    const g2 = await guest(arena, 'Swift Neon'); await g2.join(c2); await h2.start(c2);
    await expectDenied(g2.F.updateDoc(g2.ref('matches', c2), { alive: 2 }), 'alive: account only');
  });

  test('a non-host cannot change the seed (or any setting); host can only in the lobby', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid'); await kid.join(code);
    const seed0 = (await host.getMatch(code)).seed;
    for (const d of [{ seed: 1 }, { deck: 'r4' }, { room: 'symbol' }, { cap: 5 }, { allowGuests: false }, { listed: false }])
      await expectDenied(kid.F.updateDoc(kid.ref('matches', code), d), 'caller is the host');
    expect((await host.getMatch(code)).seed).toBe(seed0);
    await host.F.updateDoc(host.ref('matches', code), { seed: 99, deck: 'r4', listed: false });
    expect(await host.getMatch(code)).toMatchObject({ seed: 99, deck: 'r4', listed: false });
    await host.start(code);
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { seed: 5 }));
    await expectDenied(host.F.updateDoc(host.ref('matches', code), { hostUid: kid.uid }));
  });

  test('create requires exact keys, own class/nick, status lobby, expireAt <= now+6 min', async ({ arena }) => {
    const h = arena.client('h'); await h.signUp('class1', 'host');
    const F = h.F, md = o => h.matchDoc(o);
    const put = (code, d) => { const b = F.writeBatch(h.db); b.set(h.ref('matches', code), d); b.set(h.ref('matches', code, 'players', h.uid), h.playerDoc()); return b.commit(); };
    await expectDenied(put('AAAAAA', md({ cls: 'class9' })), 'cls and hostNick');
    await expectDenied(put('AAAAAA', md({ hostNick: 'someoneelse' })), 'cls and hostNick');
    await expectDenied(put('AAAAAA', md({ status: 'playing' })), "status == 'lobby'");
    await expectDenied(put('AAAAAA', md({ playerCount: 2 })), 'playerCount == 1');
    await expectDenied(put('AAAAAA', md({ extra: 1 })), 'exactly the allowed keys');
    await expectDenied(put('AAAAAA', md({ createdAt: F.Timestamp.fromMillis(1) })), 'createdAt');
    await expectDenied(put('AAAAAA', md({ hostUid: 'someone-else' })), 'hostUid');
    await expectDenied(put('AAAAAA', md({ deck: 'nope' })), 'known ids');
    await expectDenied(put('AAAAAA', md({ expireAt: F.Timestamp.fromMillis(arena.backend.now() + 7 * 60e3) })), 'now + 6 min');
    await expectDenied(put('AAAIAA', md()), '6 chars');                                    // I is not in the code alphabet
    await put('CCCCCC', md({ expireAt: F.Timestamp.fromMillis(arena.backend.now() + 5.9 * 60e3) }));
    expect((await h.getMatch('CCCCCC')).playerCount).toBe(1);
  });
});

test.describe('rules: joining and seats', () => {
  test('join is rejected when full, started, finished, expired; allowed in the lobby', async ({ arena }) => {
    const { host, code } = await openLobby(arena, { match: { cap: 3 } });
    const [a, b, c] = [await signedKid(arena, 'a'), await signedKid(arena, 'b'), await signedKid(arena, 'c')];
    await a.join(code); await b.join(code);
    await expect(c.join(code)).rejects.toMatchObject({ reason: 'full' });
    await expectDenied(c.join(code, { check: false }), 'playerCount < cap');
    expect((await host.getMatch(code)).playerCount).toBe(3);

    const lobby2 = await host.createMatch({ cap: 5 }); await a.join(lobby2); await host.start(lobby2);
    await expect(b.join(lobby2)).rejects.toMatchObject({ reason: 'started' });
    await expectDenied(b.join(lobby2, { check: false }), 'match exists, status lobby');
    toQuestion(arena, lobby2, 1);
    await host.finish(lobby2, host.uid);
    await expect(b.join(lobby2)).rejects.toMatchObject({ reason: 'finished' });
    await expectDenied(b.join(lobby2, { check: false }), 'match exists, status lobby');
    await expect(b.join('NOPE22')).rejects.toMatchObject({ reason: 'missing' });
    await expectCode(b.join('NOPE22', { check: false }), 'not-found');

    const lobby3 = await host.createMatch({ cap: 5 });
    await expectDenied(b.expire(lobby3), 'request.time > expireAt');                      // too early
    arena.backend.advanceClock(5 * 60 * 1000 + 1000);
    await expect(b.join(lobby3)).rejects.toMatchObject({ reason: 'expired' });
    await expectDenied(b.join(lobby3, { check: false }), 'request.time < expireAt');
    await b.expire(lobby3);                                                               // any signed-in user may expire it now
    expect((await b.getMatch(lobby3)).status).toBe('expired');
    await expectDenied(host.start(lobby3), 'lobby -> playing');                           // expired is terminal
  });

  test('join needs own uid, matching nick, a clean initial seat, and the playerCount bump', async ({ arena }) => {
    const { code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid');
    const F = kid.F;
    const join = async (pdoc, doBump = true, pid = kid.uid) => { const b = F.writeBatch(kid.db); b.set(kid.ref('matches', code, 'players', pid), pdoc); if (doBump) b.update(kid.ref('matches', code), { playerCount: F.increment(1) }); return b.commit(); };
    await expectDenied(join(kid.playerDoc({ nick: 'someoneelse' })), 'own /players nick');
    await expectDenied(join(kid.playerDoc({ score: 500 })), 'score, correct');
    await expectDenied(join(kid.playerDoc({ joinedAt: F.Timestamp.fromMillis(1) })), 'joinedAt == request.time');
    await expectDenied(join(kid.playerDoc(), false), 'bumps playerCount');
    await expectDenied(F.updateDoc(kid.ref('matches', code), { playerCount: F.increment(1) }));        // no seat, no bump
    await expectDenied(join(kid.playerDoc(), true, 'a-friend'), 'pid == uid');
    await join(kid.playerDoc());
    await expectDenied(join(kid.playerDoc()));                                                         // second join: count bump without a new seat
  });

  test('guest names must look like Adjective Element', async ({ arena }) => {
    const { code } = await openLobby(arena);
    const g = await guest(arena, 'Bold Boron');
    await expectDenied(g.join(code, { check: false, nick: 'Ms Smith 123' }), 'Adjective Element');
    await expectDenied(g.join(code, { check: false, nick: 'bold boron' }), 'Adjective Element');
    await g.join(code, { nick: 'Calm Cobalt' });
  });

  test('lobby leave deletes the seat; players cannot edit each other, except the aggregator marking abandoned', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const a = await signedKid(arena, 'a'), b = await signedKid(arena, 'b');
    await a.join(code); await b.join(code);
    await a.leaveLobby(code);
    expect((await host.getMatch(code)).playerCount).toBe(2);
    await expectDenied(b.F.deleteDoc(b.ref('matches', code, 'players', host.uid)), 'pid == uid');
    await host.start(code);
    await expectDenied(b.leaveLobby(code), "'lobby'");                                 // no deleting your seat once playing
    await host.F.updateDoc(host.ref('matches', code, 'players', b.uid), { abandoned: true });
    await expectDenied(host.F.updateDoc(host.ref('matches', code, 'players', b.uid), { score: 999 }));
    const c = await signedKid(arena, 'c');
    await expectDenied(c.F.updateDoc(c.ref('matches', code, 'players', host.uid), { abandoned: true }), 'participant');
    const f = host.F, mine = host.ref('matches', code, 'players', host.uid);
    await f.updateDoc(mine, { reaction: 'fire', reactionAt: Date.now() });
    await expectDenied(f.updateDoc(mine, { reaction: 'Fire' }), 'one of nice');
    await expectDenied(f.updateDoc(mine, { reaction: 'you stink' }), 'one of nice');
    await expectDenied(f.updateDoc(mine, { answeredQ: 4 }), 'brand-new answer doc');
  });

  test('only participants read players and presence; aggregator lease rules', async ({ arena }) => {
    const { host, code } = await openLobby(arena);
    const kid = await signedKid(arena, 'kid'), out = await signedKid(arena, 'out');
    await kid.join(code);
    expect((await kid.players(code)).length).toBe(2);
    await expectDenied(out.players(code), 'participant');
    await expectDenied(out.F.getDoc(out.ref('matches', code, 'players', kid.uid)), 'participant');
    expect((await out.F.getDoc(out.ref('matches', code, 'players', out.uid))).exists()).toBe(false);   // own (absent) seat is readable: the join tx probes it
    await host.start(code);
    const F = kid.F, at = () => ({ at: F.serverTimestamp() });
    await F.setDoc(kid.ref('matches', code, 'presence', kid.uid), at());
    await expectDenied(F.setDoc(kid.ref('matches', code, 'presence', host.uid), at()), 'pid == uid');
    await expectDenied(F.setDoc(kid.ref('matches', code, 'presence', kid.uid), { at: F.serverTimestamp(), x: 1 }), 'hasOnly [at]');
    await expectDenied(out.F.setDoc(out.ref('matches', code, 'presence', out.uid), { at: out.F.serverTimestamp() }), 'participant');
    await expectDenied(out.F.getDoc(out.ref('matches', code, 'presence', host.uid)), 'participant');
    const lease = c => ({ aggUid: c.uid, aggUntil: c.F.Timestamp.fromMillis(arena.backend.now() + 30000 * arena.backend.timeScale) });
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code), lease(kid)), 'previous lease expired');   // host's lease is fresh
    await host.F.updateDoc(host.ref('matches', code), { aggUntil: host.F.Timestamp.fromMillis(arena.backend.now() + 1000), alive: 2 });   // host renews
    arena.backend.advanceClock(45000);                                                                          // lease goes stale
    await kid.F.updateDoc(kid.ref('matches', code), lease(kid));                                                // a seated account claims it
    expect((await kid.getMatch(code)).aggUid).toBe(kid.uid);
    await expectDenied(kid.F.updateDoc(kid.ref('matches', code), { aggUntil: kid.F.Timestamp.fromMillis(arena.backend.now() + 3 * 60e3) }), 'within 2 min');
  });
});
