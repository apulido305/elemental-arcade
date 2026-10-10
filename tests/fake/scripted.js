// Node-side scripted clients: the same fake SDK as the browser (so rules, transactions and auth behave
// identically), wired straight to the Backend with no browser. Used for tests that don't need a UI and
// for driving "other players" while a browser plays.
import { createRequire } from 'node:module';
import { createSdk, MemoryStorage } from './sdk.js';
import { CODE_ALPHABET } from './rules.js';
createRequire(import.meta.url)('../../binder.js');
const B = globalThis.Binder;

export const wire = v => JSON.parse(JSON.stringify(v));

export function directTransport(backend) {
  return {
    call: (op, args, token) => backend.call(op, wire(args || {}), token).then(r => wire(r ?? null)),
    listen: (spec, token, cb) => backend.listen(token, wire(spec), ev => queueMicrotask(() => cb(wire(ev))))
  };
}

// The shared Binder account scheme (binder.js), so UI sign-ups and scripted sign-ups can sign in as each other.
// Accounts made before the Binder use Elemental's original scheme (B.LEGACY_SCHEMES): see legacyAccount() below.
export const norm = B.norm;
export const accountEmail = B.accountEmail;
export const accountPass = B.accountPass;
export const LEGACY = B.LEGACY_SCHEMES[0];
// A new account's profile (/players/{uid}) and an empty game doc (/players/{uid}/games/{gameId}).
export const EMPTY_PROFILE = () => ({ xp: 0, level: 1, unlocked: [], finishes: {}, finishOn: {}, packs: [], packLog: [] });
export const EMPTY_PROGRESS = () => B.emptyGame();
export const makeCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const arenaError = (reason, message) => Object.assign(new Error(message || reason), { reason });

export class ScriptedClient {
  /** @param backend Backend  @param opts {name, options: sdk options such as txMaxAttempts} */
  constructor(backend, { name = 'client', options = { txMaxAttempts: 40, txBackoffMs: 5 } } = {}) {
    this.backend = backend; this.name = name;
    this.sdk = createSdk({ transport: directTransport(backend), storage: { local: new MemoryStorage(), session: new MemoryStorage() }, options });
    this.A = this.sdk.auth; this.F = this.sdk.firestore;
    this.app = this.sdk.app.initializeApp({ apiKey: 'fake' });
    this.auth = this.A.getAuth(this.app); this.db = this.F.getFirestore(this.app);
    this.nick = null; this.cls = null;
  }
  get uid() { return this.auth.currentUser ? this.auth.currentUser.uid : null; }
  get isGuest() { return !!(this.auth.currentUser && this.auth.currentUser.isAnonymous); }
  ref(...p) { return this.F.doc(this.db, ...p); }

  // ----- auth -----
  async signUp(cls, nick, pin = '1234') {
    this.cls = norm(cls); this.nick = norm(nick);
    await this.A.setPersistence(this.auth, this.A.browserLocalPersistence);
    const cred = await this.A.createUserWithEmailAndPassword(this.auth, accountEmail(cls, nick), accountPass(pin, cls));
    await this.F.setDoc(this.ref('players', cred.user.uid), Object.assign(EMPTY_PROFILE(), { nick: this.nick, cls: this.cls, updated: this.F.serverTimestamp() }));
    return cred.user;
  }
  /** An account exactly as pre-Binder Elemental made it: the legacy email scheme and one doc holding 'progress'. Such docs
   *  already exist; the rules no longer let anyone write a new 'progress' map (it is frozen), so the doc is seeded. */
  async legacySignUp(cls, nick, pin = '1234', progress = {}, icon = 'atom') {
    this.cls = norm(cls); this.nick = norm(nick);
    await this.A.setPersistence(this.auth, this.A.browserLocalPersistence);
    const cred = await this.A.createUserWithEmailAndPassword(this.auth, LEGACY.email(cls, nick), LEGACY.pass(pin, cls));
    this.backend.adminSet('players/' + cred.user.uid, { progress: Object.assign({ owned: {}, miss: {}, stars: {}, xp: 0, rounds: 0, best: 0, vs: B.VS0(), vsAt: 0 }, progress), nick: this.nick, cls: this.cls, icon, updated: { __ts: this.backend.now() } });
    return cred.user;
  }
  async signIn(cls, nick, pin = '1234') {
    this.cls = norm(cls); this.nick = norm(nick);
    await this.A.setPersistence(this.auth, this.A.browserLocalPersistence);
    return (await this.A.signInWithEmailAndPassword(this.auth, accountEmail(cls, nick), accountPass(pin, cls))).user;
  }
  async signInGuest(nick = 'Bold Boron') {
    this.nick = nick; this.cls = null;
    await this.A.setPersistence(this.auth, this.A.browserSessionPersistence);
    return (await this.A.signInAnonymously(this.auth)).user;
  }
  signOut() { return this.A.signOut(this.auth); }

  // ----- arena operations (shapes follow SPEC.md "Data model") -----
  playerDoc(extra = {}) {
    const F = this.F;
    return Object.assign({ nick: this.nick, guest: this.isGuest, joinedAt: F.serverTimestamp(), lastSeen: F.serverTimestamp(), score: 0, correct: 0,
      totalMs: 0, answeredQ: -1, reaction: null, reactionAt: null, abandoned: false, left: false, streak: 0 }, extra);
  }
  matchDoc(o = {}) {
    const F = this.F, now = this.backend.now();
    return Object.assign({
      game: 'chem', hostUid: this.uid, hostNick: this.nick, cls: this.cls, deck: 's20', room: 'mixed', seed: (Math.random() * 0x100000000) >>> 0, cap: 20,
      allowGuests: true, listed: true, status: 'lobby', createdAt: F.serverTimestamp(), expireAt: F.Timestamp.fromMillis(now + 5 * 60 * 1000 * this.backend.timeScale),
      playerCount: 1, startAt: null, alive: 1, aggUid: this.uid, aggUntil: F.Timestamp.fromMillis(now + 30000 * this.backend.timeScale), winnerUid: null, endedAt: null, rematch: null
    }, o);
  }
  /** Host creates a match + own player doc in one batch (what vs.js does). Returns the code. */
  async createMatch(o = {}) {
    const code = o.code || makeCode(); const { code: _c, ...fields } = o;
    const b = this.F.writeBatch(this.db);
    b.set(this.ref('matches', code), this.matchDoc(fields));
    b.set(this.ref('matches', code, 'players', this.uid), this.playerDoc());
    await b.commit();
    return code;
  }
  async getMatch(code) { const s = await this.F.getDoc(this.ref('matches', code)); return s.exists() ? s.data() : null; }
  async players(code) { const s = await this.F.getDocs(this.F.collection(this.db, 'matches', code, 'players')); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
  /** Join transaction. check:true mimics the UI's pre-checks (distinct reasons); check:false goes straight at the rules. */
  async join(code, { check = true, nick, playerExtra } = {}) {
    const F = this.F, mref = this.ref('matches', code), pref = this.ref('matches', code, 'players', this.uid);
    if (nick) this.nick = nick;
    return F.runTransaction(this.db, async tx => {
      const m = await tx.get(mref);
      if (check) {
        if (!m.exists()) throw arenaError('missing', 'No arena has that code.');
        const d = m.data();
        if (d.status === 'expired' || (d.status === 'lobby' && this.backend.now() > d.expireAt.toMillis())) throw arenaError('expired', 'That lobby expired.');
        if (d.status === 'playing') throw arenaError('started', 'This arena already started.');
        if (d.status !== 'lobby') throw arenaError('finished', 'That arena is over.');
        if (d.playerCount >= d.cap) throw arenaError('full', 'That arena is full.');
        if (this.isGuest && !d.allowGuests) throw arenaError('guests-off', 'Guests are not allowed in this arena.');
      }
      tx.set(pref, this.playerDoc(playerExtra));
      tx.update(mref, { playerCount: F.increment(1) });
    });
  }
  async leaveLobby(code) {
    const F = this.F;
    return F.runTransaction(this.db, async tx => { await tx.get(this.ref('matches', code)); tx.delete(this.ref('matches', code, 'players', this.uid)); tx.update(this.ref('matches', code), { playerCount: F.increment(-1) }); });
  }
  start(code) { return this.F.updateDoc(this.ref('matches', code), { status: 'playing', startAt: this.F.serverTimestamp() }); }
  /** Answer q: answer doc + own player doc update in one batch, as in SPEC. */
  async answer(code, q, { choice = 0, elapsedMs = 1000, correct = true, points, streak } = {}) {
    const F = this.F; const pts = points ?? (correct ? 100 + Math.round(50 * (1 - Math.min(15000, elapsedMs) / 15000)) : 0);
    const b = F.writeBatch(this.db);
    b.set(this.ref('matches', code, 'answers', `${this.uid}_${q}`), { q, choice, elapsedMs, correct, points: pts, at: F.serverTimestamp() });
    b.update(this.ref('matches', code, 'players', this.uid), { score: F.increment(pts), correct: F.increment(correct ? 1 : 0), totalMs: F.increment(elapsedMs),
      answeredQ: q, lastSeen: F.serverTimestamp(), streak: streak ?? (correct ? F.increment(1) : 0) });
    return b.commit();
  }
  finish(code, winnerUid) { return this.F.updateDoc(this.ref('matches', code), { status: 'done', winnerUid, endedAt: this.F.serverTimestamp() }); }
  expire(code) { return this.F.updateDoc(this.ref('matches', code), { status: 'expired' }); }
  async listLobby({ cls = this.cls } = {}) {
    const F = this.F;
    const s = await F.getDocs(F.query(F.collection(this.db, 'matches'), F.where('listed', '==', true), F.where('status', '==', 'lobby'), F.where('cls', '==', cls)));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}
