// Optional cloud saving for Elemental Arcade (Firebase Auth + Firestore).
// Students sign in with class code + nickname + PIN. Firebase needs an email and password,
// so those three are turned into a private, made-up email and password. No real email is stored.
import { firebaseConfig } from './firebase-config.js';

const V = '10.14.1';
const configured = firebaseConfig && firebaseConfig.apiKey && !/YOUR_/.test(firebaseConfig.apiKey);

(async () => {
  if (!configured) return;
  let A, F, auth, db;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
    ]);
    A = authMod; F = fsMod;
    const app = appMod.initializeApp(firebaseConfig);
    auth = A.getAuth(app);
    db = F.getFirestore(app);
  } catch (e) {
    console.warn('Cloud saving unavailable, playing as guest.', e);
    return;
  }

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const email = (c, n) => `${c}_${n}@players.elemental-arcade.example`;
  const pass = (pin, c) => `${pin}-${c}-elemental`;
  const EMPTY = { owned: {}, miss: {}, stars: {}, xp: 0, rounds: 0, best: 0, vs: { w: 0, l: 0, streak: 0, best: 0, played: 0 }, vsAt: 0 };
  const maxObj = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = Math.max(o[k] || 0, b[k] || 0); return o; };
  // VS record: w, l, played and best take the larger side. The streak is not a count, so it comes from
  // whichever side finished a VS match most recently (larger vsAt). Never summed.
  const mergeVs = (a, b) => {
    a = a || {}; b = b || {};
    const mx = k => Math.max(a.vs && a.vs[k] || 0, b.vs && b.vs[k] || 0);
    const newer = (b.vsAt || 0) > (a.vsAt || 0) ? b : a;
    return { w: mx('w'), l: mx('l'), streak: (newer.vs && newer.vs.streak) || 0, best: mx('best'), played: mx('played') };
  };
  const merge = (a, b) => ({
    owned: maxObj(a.owned, b.owned), miss: maxObj(a.miss, b.miss), stars: maxObj(a.stars, b.stars),
    xp: Math.max(a.xp || 0, b.xp || 0), rounds: Math.max(a.rounds || 0, b.rounds || 0), best: Math.max(a.best || 0, b.best || 0),
    vs: mergeVs(a, b), vsAt: Math.max(a.vsAt || 0, b.vsAt || 0)
  });
  const who = u => { const [cls, nick] = u.email.split('@')[0].split('_'); return { cls, nick }; };

  const changeCbs = [], statusCbs = [];
  let last = null, busy = false, timer = null, pending = null;
  const emit = (user, prog) => { last = [user, prog]; changeCbs.forEach(cb => cb(user, prog)); };
  const setStatus = s => statusCbs.forEach(cb => cb(s));

  async function flush() {
    const u = auth.currentUser;
    // A guest (anonymous) session never writes /players.
    if (!pending || !u || u.isAnonymous) return;
    const p = pending; pending = null;
    setStatus('saving');
    try {
      const ref = F.doc(db, 'players', u.uid);
      const snap = await F.getDoc(ref);
      const merged = snap.exists() ? merge(snap.data().progress || EMPTY, p) : p;
      const id = who(u);
      await F.setDoc(ref, { progress: merged, nick: id.nick, cls: id.cls, updated: F.serverTimestamp() });
      setStatus('saved');
    } catch (e) {
      pending = pending || p;
      setStatus('offline');
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('online', flush);

  A.onAuthStateChanged(auth, async u => {
    if (busy) return;
    if (!u) { emit(null, null); return; }
    // An anonymous VS guest is not an account: no /players read, no nickname, shown as signed out.
    if (u.isAnonymous) { emit(null, null); return; }
    let prog = null;
    try {
      const s = await F.getDoc(F.doc(db, 'players', u.uid));
      if (s.exists()) prog = s.data().progress || null;
    } catch (e) { setStatus('offline'); }
    emit(who(u), prog);
  });

  window.Cloud = {
    configured: true,
    // Raw SDK handles for vs.js (VS Arena). A = firebase-auth module, F = firebase-firestore module.
    fb: { auth, db, A, F },
    uid() { return auth.currentUser ? auth.currentUser.uid : null; },
    isGuest() { return !!(auth.currentUser && auth.currentUser.isAnonymous); },
    account() { const u = auth.currentUser; return u && !u.isAnonymous && u.email ? who(u) : null; },
    // Only called when a guest taps Join. Session persistence so the guest does not outlive the tab.
    async signInGuest() {
      if (auth.currentUser) return auth.currentUser;
      await A.setPersistence(auth, A.browserSessionPersistence);
      const cred = await A.signInAnonymously(auth);
      return cred.user;
    },
    async signOutGuest() { if (auth.currentUser && auth.currentUser.isAnonymous) await A.signOut(auth); },
    onChange(cb) { changeCbs.push(cb); if (last) cb(last[0], last[1]); },
    onStatus(cb) { statusCbs.push(cb); },
    save(progress) { pending = progress; clearTimeout(timer); timer = setTimeout(flush, 1200); },
    async signUp(cls, nick, pin, keep, initial) {
      const c = norm(cls), n = norm(nick);
      busy = true;
      try {
        await A.setPersistence(auth, keep ? A.browserLocalPersistence : A.browserSessionPersistence);
        const cred = await A.createUserWithEmailAndPassword(auth, email(c, n), pass(pin, c));
        const progress = Object.assign({}, EMPTY, initial || {});
        await F.setDoc(F.doc(db, 'players', cred.user.uid), { progress, nick: n, cls: c, updated: F.serverTimestamp() });
        busy = false;
        emit({ cls: c, nick: n }, progress);
      } finally { busy = false; }
    },
    async signIn(cls, nick, pin, keep) {
      const c = norm(cls), n = norm(nick);
      await A.setPersistence(auth, keep ? A.browserLocalPersistence : A.browserSessionPersistence);
      await A.signInWithEmailAndPassword(auth, email(c, n), pass(pin, c));
    },
    async signOut() { await flush(); await A.signOut(auth); }
  };
  window.dispatchEvent(new Event('cloud-ready'));
})();
