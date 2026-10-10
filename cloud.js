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
  const EMPTY = { owned: {}, miss: {}, stars: {}, xp: 0, rounds: 0, best: 0, vs: { w: 0, l: 0, streak: 0, best: 0, played: 0 }, vsAt: 0,
    packs: [], finishes: {}, finishOn: {}, unlocked: [], packLog: [] };
  const maxObj = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = Math.max(o[k] || 0, b[k] || 0); return o; };
  // VS record: w, l, played and best take the larger side. The streak is not a count, so it comes from
  // whichever side finished a VS match most recently (larger vsAt). Never summed.
  const mergeVs = (a, b) => {
    a = a || {}; b = b || {};
    const mx = k => Math.max(a.vs && a.vs[k] || 0, b.vs && b.vs[k] || 0);
    const newer = (b.vsAt || 0) > (a.vsAt || 0) ? b : a;
    return { w: mx('w'), l: mx('l'), streak: (newer.vs && newer.vs.streak) || 0, best: mx('best'), played: mx('played') };
  };
  // Packs: unlocks, finishes and packLog are unions (nothing earned is ever lost). Unopened packs are the union by id,
  // minus any pack either side has opened ('open:' + id in packLog), so an opened pack never comes back. The shown
  // finish prefers this device (b).
  const uni = (a, b) => Array.from(new Set([].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [])));
  const mergeFin = (a, b) => { const o = {}; [a, b].forEach(m => { if (m && typeof m === 'object') for (const k in m) o[k] = uni(o[k], m[k]); }); return o; };
  const mergePacks = (a, b, log) => {
    const out = [], seen = new Set();
    [].concat(Array.isArray(a.packs) ? a.packs : [], Array.isArray(b.packs) ? b.packs : []).forEach(p => {
      if (p && p.id && !seen.has(p.id) && !log.includes('open:' + p.id)) { seen.add(p.id); out.push(p); }
    });
    return out;
  };
  const merge = (a, b) => {
    const packLog = uni(a.packLog, b.packLog);
    return Object.assign(merge0(a, b), {
      packs: mergePacks(a, b, packLog), finishes: mergeFin(a.finishes, b.finishes),
      finishOn: Object.assign({}, a.finishOn || {}, b.finishOn || {}), unlocked: uni(a.unlocked, b.unlocked), packLog
    });
  };
  const merge0 = (a, b) => ({
    owned: maxObj(a.owned, b.owned), miss: maxObj(a.miss, b.miss), stars: maxObj(a.stars, b.stars),
    xp: Math.max(a.xp || 0, b.xp || 0), rounds: Math.max(a.rounds || 0, b.rounds || 0), best: Math.max(a.best || 0, b.best || 0),
    vs: mergeVs(a, b), vsAt: Math.max(a.vsAt || 0, b.vsAt || 0)
  });
  // Profile icon: a top-level id string on the player doc (never markup). The doc's 'updated' is when it was last
  // written; a pick made on this device after that (local.iconAt) wins, otherwise the doc keeps its icon.
  // Ids are compared, never max()ed. Ids are checked against the game's list (and again by the rules).
  const toMs = v => v == null ? 0 : typeof v === 'number' ? v : typeof v.toMillis === 'function' ? v.toMillis() : 0;
  const okIcon = id => (window.Arcade && window.Arcade.iconOf ? window.Arcade.iconOf(id) : (typeof id === 'string' ? id : 'atom'));
  const mergeIcon = (doc, local) => {
    doc = doc || {}; local = local || {};
    const docIcon = typeof doc.icon === 'string' ? doc.icon : null;
    if (!docIcon || (local.icon && (local.iconAt || 0) > toMs(doc.updated))) return okIcon(local.icon);
    return okIcon(docIcon);
  };
  // Until the teacher republishes firestore.rules, the old rules reject an 'icon' key, which would block every
  // save. If that happens, write once more without the icon and stop sending it for this session.
  let iconWrites = true;
  const denied = e => /permission-denied/.test(String(e && e.code));
  async function setPlayer(ref, data) {
    if (!iconWrites) delete data.icon;
    try { await F.setDoc(ref, data); }
    catch (e) {
      if (!('icon' in data) || !denied(e)) throw e;
      iconWrites = false; delete data.icon;
      await F.setDoc(ref, data);
    }
  }
  const who = u => { const [cls, nick] = u.email.split('@')[0].split('_'); return { cls, nick }; };

  const changeCbs = [], statusCbs = [];
  let last = null, busy = false, timer = null, pending = null, pendingIcon = null;
  const emit = (user, prog, meta) => { last = [user, prog, meta]; changeCbs.forEach(cb => cb(user, prog, meta)); };
  const setStatus = s => statusCbs.forEach(cb => cb(s));

  // Last known server doc for the signed-in uid, so a save merges against it instead of re-reading every time.
  // Stale after 2 minutes or after a failed write; then the next save reads the server again.
  const CACHE_MS = 120000;
  let cache = null;
  async function flush() {
    const u = auth.currentUser;
    // A guest (anonymous) session never writes /players.
    if (!pending || !u || u.isAnonymous) return;
    const p = pending, pi = pendingIcon; pending = null;
    setStatus('saving');
    try {
      const ref = F.doc(db, 'players', u.uid);
      let doc;
      if (cache && cache.uid === u.uid && Date.now() - cache.at < CACHE_MS) doc = cache.doc;
      else { cache = null; const snap = await F.getDoc(ref); doc = snap.exists() ? snap.data() : null; }
      const merged = doc ? merge(doc.progress || EMPTY, p) : p;
      const id = who(u);
      const out = { progress: merged, nick: id.nick, cls: id.cls, icon: mergeIcon(doc, pi), updated: F.serverTimestamp() };
      await setPlayer(ref, out);
      cache = { uid: u.uid, at: Date.now(), doc: { progress: merged, icon: out.icon || (doc && doc.icon), updated: Date.now() } };
      setStatus('saved');
    } catch (e) {
      cache = null;
      pending = pending || p;
      setStatus('offline');
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('online', flush);

  A.onAuthStateChanged(auth, async u => {
    if (busy) return;
    if (!u) { cache = null; emit(null, null); return; }
    // An anonymous VS guest is not an account: no /players read, no nickname, shown as signed out.
    if (u.isAnonymous) { emit(null, null); return; }
    let prog = null, meta = { icon: null, updated: 0 };
    try {
      const s = await F.getDoc(F.doc(db, 'players', u.uid));
      cache = { uid: u.uid, at: Date.now(), doc: s.exists() ? s.data() : null };
      if (s.exists()) { const d = s.data(); prog = d.progress || null; meta = { icon: typeof d.icon === 'string' ? d.icon : null, updated: toMs(d.updated) }; }
    } catch (e) { setStatus('offline'); }
    emit(who(u), prog, meta);
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
    onChange(cb) { changeCbs.push(cb); if (last) cb(last[0], last[1], last[2]); },
    onStatus(cb) { statusCbs.push(cb); },
    // meta: {icon, iconAt} from the game. iconAt is when the icon was picked on this device (0 = not picked here).
    save(progress, meta) { pending = progress; if (meta) pendingIcon = meta; clearTimeout(timer); timer = setTimeout(flush, 1200); },
    // Pure merge helpers, exposed for tests.
    _merge: { progress: merge, icon: mergeIcon },
    async signUp(cls, nick, pin, keep, initial, icon) {
      const c = norm(cls), n = norm(nick);
      busy = true;
      try {
        await A.setPersistence(auth, keep ? A.browserLocalPersistence : A.browserSessionPersistence);
        const cred = await A.createUserWithEmailAndPassword(auth, email(c, n), pass(pin, c));
        const progress = Object.assign({}, EMPTY, initial || {}), ic = okIcon(icon);
        await setPlayer(F.doc(db, 'players', cred.user.uid), { progress, nick: n, cls: c, icon: ic, updated: F.serverTimestamp() });
        busy = false;
        emit({ cls: c, nick: n }, progress, { icon: ic, updated: Date.now() });
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
