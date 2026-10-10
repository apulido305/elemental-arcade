// Optional cloud saving for Elemental Arcade (Firebase Auth + Firestore), through the shared Binder (binder.js).
// Students sign up with class code + nickname + PIN. Firebase needs an email and password, so those three are turned
// into a private, made-up email and password (Binder.accountEmail / accountPass, the same in every arcade game).
// Accounts made before the Binder keep Elemental's original scheme; sign-in tries both (Binder.accountCandidates).
// Sign-in needs only nickname + PIN: /names/{nickname} holds the class code, written at sign-up.
// No real email is stored. This file owns sign-in; binder.js owns the data layout, merging and saving.
import { firebaseConfig } from './firebase-config.js';

const V = '10.14.1';
const configured = firebaseConfig && firebaseConfig.apiKey && !/YOUR_/.test(firebaseConfig.apiKey);

(async () => {
  if (!configured || !window.Binder) return;
  const B = window.Binder;
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
  B.init({ F, db });
  const GAME = B.current();
  // Both account schemes put {cls}_{nick} before the @.
  const who = u => B.whoFromEmail(u.email);
  const badCred = e => /invalid-credential|user-not-found|wrong-password|invalid-login/.test(String(e && e.code));

  // Nickname lookup and claim live in binder.js (shared with every game). Missing (an account made before the lookup)
  // means the student types their class code once; signing in with it then claims the name. Never throws.
  const lookupCls = n => B.lookupCls(n), claimName = u => B.claimName(u);
  const taken = () => { const e = new Error('nickname taken'); e.code = 'auth/email-already-in-use'; return e; };

  const changeCbs = [], statusCbs = [];
  let last = null, busy = false, view = null;
  // cb(user, progress, meta, view): progress is this game's progress joined with the account half (what the game
  // keeps in S); meta = {icon, updated} from the profile; view = {profile, games} (every game, for the Binder screen).
  const emit = (user, prog, meta) => { last = [user, prog, meta]; changeCbs.forEach(cb => cb(user, prog, meta, view)); };
  const progOf = v => B.joinProgress((v && v.games[GAME]) || {}, (v && v.profile) || {});
  const metaOf = v => ({ icon: v && v.profile && typeof v.profile.icon === 'string' ? v.profile.icon : null, updated: B.toMs(v && v.profile && v.profile.updated) });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') B.flush(); });
  window.addEventListener('online', () => B.flush());

  A.onAuthStateChanged(auth, async u => {
    if (busy) return;
    view = null;
    if (!u) { B.setUser(null); emit(null, null); return; }
    // An anonymous VS guest is not an account: no /players read, no nickname, shown as signed out.
    if (u.isAnonymous) { B.setUser(null); emit(null, null); return; }
    const id = who(u);
    B.setUser({ uid: u.uid, nick: id.nick, cls: id.cls });
    try { view = await B.loadBinder(u.uid); } catch (e) { statusCbs.forEach(cb => cb('offline')); }
    emit(id, view ? progOf(view) : null, metaOf(view));
    claimName(u);
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
    onChange(cb) { changeCbs.push(cb); if (last) cb(last[0], last[1], last[2], view); },
    onStatus(cb) { statusCbs.push(cb); B.onStatus(cb); },
    // progress: the game's whole progress (S); meta: {icon, iconAt} (iconAt = when the icon was picked on this device).
    save(progress, meta) { if (auth.currentUser && !auth.currentUser.isAnonymous) B.saveGame(GAME, progress, meta); },
    // Every game's progress for the Binder shelf (fresh read). Resolves null when signed out or offline.
    async binder() {
      const u = auth.currentUser; if (!u || u.isAnonymous) return null;
      try { await B.flush(); view = await B.loadBinder(u.uid); return view; } catch (e) { return view; }
    },
    lastBinder() { return view; },
    // Resolves 'existing' when the student already has an Elemental account made before the Binder (legacy scheme) with
    // this class code, nickname and PIN: they are signed in to it instead of getting a second account.
    async signUp(cls, nick, pin, keep, initial, icon) {
      const c = B.norm(cls), n = B.norm(nick);
      await A.setPersistence(auth, keep ? A.browserLocalPersistence : A.browserSessionPersistence);
      for (const k of B.accountCandidates(c, n, pin).filter(x => x.legacy)) {
        try { await A.signInWithEmailAndPassword(auth, k.email, k.pass); return 'existing'; } catch (e) { /* no such legacy account (or another PIN) */ }
      }
      // Nicknames are unique across classes, since sign-in has no class code.
      if (await lookupCls(n)) throw taken();
      busy = true;
      try {
        // A pre-Binder account with this class code and nickname but another PIN has no /names claim: without this
        // check it would get a second, Binder-scheme account (binder-spec "Accounts").
        if (await B.legacyTaken(A, auth, c, n)) throw taken();
        const cred = await A.createUserWithEmailAndPassword(auth, B.accountEmail(c, n), B.accountPass(pin, c));
        B.setUser({ uid: cred.user.uid, nick: n, cls: c });
        const made = await B.createAccount(cred.user.uid, { nick: n, cls: c }, GAME, initial || {}, icon);
        view = { profile: made.profile, games: { [GAME]: made.game } };
        await claimName(cred.user);   // before the account shows, so an immediate second sign-up already sees the name taken
        busy = false;
        emit({ cls: c, nick: n }, progOf(view), { icon: made.profile.icon || null, updated: Date.now() });
      } finally { busy = false; }
    },
    // cls is optional: without it the class code comes from /names (throws auth/need-class-code if it is not there).
    // Then the shared Binder scheme, then Elemental's original one, with the same class code, nickname and PIN.
    async signIn(nick, pin, keep, cls) {
      const n = B.norm(nick), c = B.norm(cls) || await lookupCls(n);
      if (!c) { const e = new Error('class code needed'); e.code = 'auth/need-class-code'; throw e; }
      await A.setPersistence(auth, keep ? A.browserLocalPersistence : A.browserSessionPersistence);
      let first = null;
      for (const k of B.accountCandidates(c, n, pin)) {
        try { await A.signInWithEmailAndPassword(auth, k.email, k.pass); return; }
        catch (e) { if (!badCred(e)) throw e; first = first || e; }
      }
      throw first;
    },
    async signOut() { await B.flush(); B.setUser(null); await A.signOut(auth); }
  };
  window.dispatchEvent(new Event('cloud-ready'));
})();
