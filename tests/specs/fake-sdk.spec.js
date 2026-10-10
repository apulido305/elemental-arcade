// Behaviour of the fake SDK + backend itself (so later failures can be blamed on the app, not the fake).
import { test, expect } from '../helpers/fixtures.js';
import { expectDenied, expectCode } from '../helpers/arena.js';

test.describe('firestore fake', () => {
  test('serverTimestamp is resolved by the backend clock; increment; Timestamp round trip', async ({ arena }) => {
    const c = arena.client('c'); await c.signUp('class1', 'kid');
    const F = c.F, ref = c.ref('players', c.uid);
    arena.backend.advanceClock(3600e3);                                  // backend "now" is an hour ahead of the client
    await F.updateDoc(ref, { updated: F.serverTimestamp(), 'progress.xp': F.increment(5) });
    await F.updateDoc(ref, { 'progress.xp': F.increment(7), 'progress.vsAt': F.Timestamp.fromMillis(1234567).toMillis() });
    const d = (await F.getDoc(ref)).data();
    expect(d.updated).toBeInstanceOf(F.Timestamp);
    expect(Math.abs(d.updated.toMillis() - arena.backend.now())).toBeLessThan(1500);
    expect(d.updated.toMillis() - Date.now()).toBeGreaterThan(3500e3);
    expect(d.progress.xp).toBe(12); expect(d.progress.vsAt).toBe(1234567);
    expect(F.Timestamp.fromMillis(1500.0).seconds).toBe(1);
    expect(() => F.updateDoc(c.ref('players', c.uid), { nick: undefined })).toThrow(/undefined/);         // real SDK rejects undefined
    await expectCode(F.updateDoc(c.ref('matches', 'NOTHER'), { a: 1 }), 'not-found');
  });

  test('where(==) + limit; snapshot shape: docs, size, empty, forEach, exists, id', async ({ arena }) => {
    const c = arena.client('c'); await c.signUp('class1', 'kid');
    const F = c.F;
    for (const code of ['AAAAAA', 'BBBBBB', 'CCCCCC']) await c.createMatch({ code, listed: code !== 'BBBBBB' });
    let s = await F.getDocs(F.query(F.collection(c.db, 'matches'), F.where('listed', '==', true), F.where('status', '==', 'lobby'), F.where('cls', '==', 'class1')));
    expect(s.size).toBe(2); expect(s.empty).toBe(false); expect(s.docs.map(d => d.id)).toEqual(['AAAAAA', 'CCCCCC']);
    const ids = []; s.forEach(d => ids.push(d.id)); expect(ids).toEqual(['AAAAAA', 'CCCCCC']);
    s = await F.getDocs(F.query(F.collection(c.db, 'matches'), F.where('listed', '==', true), F.where('status', '==', 'lobby'), F.where('cls', '==', 'class1'), F.limit(1)));
    expect(s.size).toBe(1);
    s = await F.getDocs(F.query(F.collection(c.db, 'matches'), F.where('listed', '==', true), F.where('status', '==', 'lobby'), F.where('cls', '==', 'class1'), F.where('deck', '==', 'zzz')));
    expect(s.empty).toBe(true);
    const one = await F.getDoc(c.ref('matches', 'BBBBBB'));
    expect(one.exists()).toBe(true); expect(one.id).toBe('BBBBBB'); expect(one.data().listed).toBe(false);
    const none = await F.getDoc(c.ref('matches', 'NOPE22')); expect(none.exists()).toBe(false); expect(none.data()).toBeUndefined();
  });

  test('writeBatch is atomic (rules failure or missing doc applies nothing)', async ({ arena }) => {
    const c = arena.client('c'); await c.signUp('class1', 'kid');
    const F = c.F; const code = await c.createMatch();
    const b = F.writeBatch(c.db);
    b.update(c.ref('matches', code), { listed: false });                 // legal on its own
    b.update(c.ref('matches', code), { hostUid: 'x' });                  // illegal
    await expectDenied(b.commit());
    expect((await c.getMatch(code)).listed).toBe(true);
    const b2 = F.writeBatch(c.db);
    b2.update(c.ref('matches', code), { listed: false }); b2.update(c.ref('matches', 'MISSNG'), { a: 1 });
    await expectCode(b2.commit(), 'not-found');
    expect((await c.getMatch(code)).listed).toBe(true);
  });

  test('transactions: reads before writes, abort on thrown error, no partial commit', async ({ arena }) => {
    const c = arena.client('c'); await c.signUp('class1', 'kid');
    const F = c.F; const code = await c.createMatch();
    await expectCode(F.runTransaction(c.db, async tx => { tx.update(c.ref('matches', code), { listed: false }); await tx.get(c.ref('matches', code)); }), 'invalid-argument');
    await expect(F.runTransaction(c.db, async tx => { tx.update(c.ref('matches', code), { listed: false }); throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await c.getMatch(code)).listed).toBe(true);
    const out = await F.runTransaction(c.db, async tx => { const s = await tx.get(c.ref('matches', code)); tx.update(c.ref('matches', code), { listed: false }); return s.data().cap; });
    expect(out).toBe(20);
  });

  test('onSnapshot: initial + change delivery for docs and queries, unsubscribe, permission errors', async ({ arena }) => {
    const host = arena.client('host'); await host.signUp('class1', 'host');
    const kid = arena.client('kid'); await kid.signUp('class1', 'kid');
    const code = await host.createMatch();
    await kid.join(code);
    const F = host.F, docSnaps = [], listSnaps = [], errs = [];
    const offDoc = F.onSnapshot(host.ref('matches', code), s => docSnaps.push(s.data().playerCount));
    const offList = F.onSnapshot(F.collection(host.db, 'matches', code, 'players'), s => listSnaps.push(s.docs.map(d => d.id).sort().length));
    await expect.poll(() => docSnaps.length).toBe(1); await expect.poll(() => listSnaps.length).toBe(1);
    expect(docSnaps[0]).toBe(2); expect(listSnaps[0]).toBe(2);
    const k2 = arena.client('k2'); await k2.signUp('class1', 'k2'); await k2.join(code);
    await expect.poll(() => docSnaps).toEqual([2, 3]); await expect.poll(() => listSnaps).toEqual([2, 3]);
    await host.F.updateDoc(host.ref('matches', code), { cap: 15 });          // doc changes that don't touch the list
    await expect.poll(() => docSnaps.length).toBe(3); expect(listSnaps.length).toBe(2);
    offList();
    const k3 = arena.client('k3'); await k3.signUp('class1', 'k3'); await k3.join(code);
    await expect.poll(() => docSnaps.length).toBe(4); expect(listSnaps.length).toBe(2);
    offDoc();
    // a non-participant listening to the players collection gets permission-denied in the error callback
    const out = arena.client('out'); await out.signUp('class1', 'out');
    out.F.onSnapshot(out.F.collection(out.db, 'matches', code, 'players'), () => errs.push('data'), e => errs.push(e.code));
    await expect.poll(() => errs).toEqual(['permission-denied']);
    // a guest listening to the lobby list is denied too
    const g = arena.client('g'); await g.signInGuest();
    const gerr = []; g.F.onSnapshot(g.F.query(g.F.collection(g.db, 'matches'), g.F.where('listed', '==', true), g.F.where('status', '==', 'lobby'), g.F.where('cls', '==', 'class1')), () => gerr.push('data'), e => gerr.push(e.code));
    await expect.poll(() => gerr).toEqual(['permission-denied']);
  });
});

test.describe('auth fake', () => {
  test('email/password users, duplicate and wrong-password errors, anonymous users, provider switch', async ({ arena }) => {
    const a = arena.client('a'); await a.signUp('class1', 'ann', '4321');
    const uid = a.uid; expect(a.auth.currentUser.isAnonymous).toBe(false);
    expect(a.auth.currentUser.email).toBe('class1_ann@players.arcade.example');   // the shared Binder scheme
    await a.signOut(); expect(a.uid).toBeNull();
    const dup = arena.client('dup');
    await expectCode(dup.signUp('class1', 'ann', '9999'), 'auth/email-already-in-use');
    await expectCode(dup.signIn('class1', 'ann', '0000'), 'auth/invalid-credential');
    await expectCode(dup.signIn('class1', 'nobody', '0000'), 'auth/invalid-credential');
    await dup.signIn('class1', 'ann', '4321'); expect(dup.uid).toBe(uid);
    const g = arena.client('g'); await g.signInGuest();
    expect(g.auth.currentUser.isAnonymous).toBe(true); expect(g.auth.currentUser.email).toBeNull();
    const gu = g.uid; await g.F.getDoc(g.ref('matches', 'NOPE22'));    // signed in: may read
    await g.signOut();
    const g2 = arena.client('g2'); await g2.signInGuest(); expect(g2.uid).not.toBe(gu);   // an anonymous identity is not recoverable
    arena.backend.anonymousEnabled = false;
    await expectCode(arena.client('g3').signInGuest(), 'auth/admin-restricted-operation');
  });

  test('persistence: session vs local survive a new SDK instance only where the real SDK would', async ({ arena }) => {
    const { createSdk, MemoryStorage } = await import('../fake/sdk.js');
    const { directTransport } = await import('../fake/scripted.js');
    const mk = st => { const sdk = createSdk({ transport: directTransport(arena.backend), storage: st }); sdk.app.initializeApp({}); return sdk; };
    const st = { local: new MemoryStorage(), session: new MemoryStorage() };
    const a = mk(st), auth = a.auth.getAuth();
    await a.auth.setPersistence(auth, a.auth.browserSessionPersistence);
    const uid = (await a.auth.signInAnonymously(auth)).user.uid;
    expect(st.session.getItem('fakeauth:user')).not.toBeNull(); expect(st.local.getItem('fakeauth:user')).toBeNull();
    const seen = []; const b = mk(st); b.auth.onAuthStateChanged(b.auth.getAuth(), u => seen.push(u && u.uid));
    await expect.poll(() => seen).toEqual([uid]);                          // same tab (same sessionStorage): restored
    const newTab = mk({ local: st.local, session: new MemoryStorage() }); const seen2 = [];
    newTab.auth.onAuthStateChanged(newTab.auth.getAuth(), u => seen2.push(u && u.uid));
    await expect.poll(() => seen2).toEqual([null]);                        // new tab: nothing
    await a.auth.signOut(auth);
    const after = mk(st); const seen3 = []; after.auth.onAuthStateChanged(after.auth.getAuth(), u => seen3.push(u && u.uid));
    await expect.poll(() => seen3).toEqual([null]);
    expect(arena.backend.users.has(uid)).toBe(false);
    // local persistence is shared by tabs and survives
    await a.auth.setPersistence(auth, a.auth.browserLocalPersistence);
    await a.auth.createUserWithEmailAndPassword(auth, 'x_y@z.example', 'secret1');
    const t2 = mk({ local: st.local, session: new MemoryStorage() }); const seen4 = [];
    t2.auth.onAuthStateChanged(t2.auth.getAuth(), u => seen4.push(u && u.email));
    await expect.poll(() => seen4).toEqual(['x_y@z.example']);
  });

  test('signed-out calls and a signed-out session are treated as unauthenticated', async ({ arena }) => {
    const c = arena.client('c'); await c.signUp('class1', 'kid');
    const code = await c.createMatch();
    await c.signOut();
    await expectDenied(c.F.getDoc(c.ref('matches', code)), 'signed in');
  });
});
