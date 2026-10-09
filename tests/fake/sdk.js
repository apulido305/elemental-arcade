// Fake Firebase client SDK (app + auth + firestore), isomorphic: runs in the browser (served in place of the
// gstatic modules) and in Node (scripted clients). It implements exactly the surface listed in SPEC.md.
// All state lives in the backend; this layer only does API shape, wire encoding and transaction retry.
//
//   createSdk({ transport, storage, options }) -> { app, auth, firestore }
//   transport.call(op, args, token) -> Promise<result>           (throws FirebaseError)
//   transport.listen(spec, token, onEvent) -> unsubscribe         (events: {snap} | {error:{code,message}})
//   storage = { local, session }   Storage-like (getItem/setItem/removeItem)
//   options.txMaxAttempts (default 5, same as the real SDK), options.txBackoffMs (default 15)

export class FirebaseError extends Error {
  constructor(code, message) { super(message || code); this.name = 'FirebaseError'; this.code = code; }
}

// ---- value types and wire encoding: {__ts:ms} Timestamp, {__sv:1} serverTimestamp, {__inc:n} increment ----
class Timestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static fromMillis(ms) { const s = Math.floor(ms / 1000); return new Timestamp(s, Math.round((ms - s * 1000) * 1e6)); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return !!o && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds; }
  valueOf() { return String(this.seconds).padStart(12, '0') + '.' + String(this.nanoseconds).padStart(9, '0'); }
}
class FieldValueSentinel { constructor(kind, n) { this.kind = kind; this.n = n; } }

function encode(v, path = '') {
  if (v === undefined) throw new FirebaseError('invalid-argument', 'Function setDoc() called with invalid data. Unsupported field value: undefined (found in field ' + path + ')');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!isFinite(v)) throw new FirebaseError('invalid-argument', 'Non-finite number at ' + path); return v; }
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v instanceof Date) return { __ts: v.getTime() };
  if (v instanceof FieldValueSentinel) return v.kind === 'server' ? { __sv: 1 } : { __inc: v.n };
  if (Array.isArray(v)) return v.map((x, i) => encode(x, path + '[' + i + ']'));
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = encode(v[k], path ? path + '.' + k : k); return o; }
  throw new FirebaseError('invalid-argument', 'Unsupported field value at ' + path);
}
function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  if ('__ts' in v) return Timestamp.fromMillis(v.__ts);
  const o = {}; for (const k of Object.keys(v)) o[k] = decode(v[k]); return o;
}

// ---- Firestore ----
const randId = () => { let s = ''; const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function createFirestore(ctx) {
  const { transport, getToken, options } = ctx;
  const call = (op, args) => transport.call(op, args, getToken());

  class DocumentReference {
    constructor(firestore, path) { this.type = 'document'; this.firestore = firestore; this.path = path; this.id = path.split('/').pop(); }
    get parent() { return new CollectionReference(this.firestore, this.path.split('/').slice(0, -1).join('/')); }
  }
  class CollectionReference {
    constructor(firestore, path) { this.type = 'collection'; this.firestore = firestore; this.path = path; this.id = path.split('/').pop(); }
  }
  class Query {
    constructor(firestore, path, constraints) { this.type = 'query'; this.firestore = firestore; this.path = path; this.constraints = constraints; }
  }
  class DocumentSnapshot {
    constructor(ref, raw) { this.ref = ref; this.id = ref.id; this._raw = raw; }
    exists() { return !!this._raw; }
    data() { return this._raw ? decode(JSON.parse(JSON.stringify(this._raw))) : undefined; }
    get(field) { const d = this.data(); return field.split('.').reduce((a, k) => (a == null ? undefined : a[k]), d); }
  }
  class QuerySnapshot {
    constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
    forEach(cb) { this.docs.forEach(cb); }
  }

  const segs = (args) => args.flatMap(a => String(a).split('/')).filter(Boolean);
  const api = {
    getFirestore(app) { return { type: 'firestore', app: app || null }; },
    collection(parent, ...rest) {
      const base = parent.type === 'firestore' ? [] : parent.path.split('/');
      const p = base.concat(segs(rest));
      if (p.length % 2 !== 1) throw new FirebaseError('invalid-argument', 'Invalid collection reference. Collection references must have an odd number of segments: ' + p.join('/'));
      return new CollectionReference(parent.type === 'firestore' ? parent : parent.firestore, p.join('/'));
    },
    doc(parent, ...rest) {
      if (parent.type === 'collection' && rest.length === 0) rest = [randId()];
      const base = parent.type === 'firestore' ? [] : parent.path.split('/');
      const p = base.concat(segs(rest));
      if (p.length % 2 !== 0) throw new FirebaseError('invalid-argument', 'Invalid document reference. Document references must have an even number of segments: ' + p.join('/'));
      return new DocumentReference(parent.type === 'firestore' ? parent : parent.firestore, p.join('/'));
    },
    where(field, op, value) { return { kind: 'where', field, op, value: encode(value, field) }; },
    limit(n) { return { kind: 'limit', n }; },
    query(coll, ...constraints) { return new Query(coll.firestore, coll.path, (coll.constraints || []).concat(constraints)); },
    serverTimestamp: () => new FieldValueSentinel('server'),
    increment: n => new FieldValueSentinel('inc', n),
    Timestamp,
    async getDoc(ref) { const r = await call('fs.getDoc', { path: ref.path }); return new DocumentSnapshot(ref, r.data); },
    async getDocs(q) {
      const r = await call('fs.getDocs', { path: q.path, constraints: q.constraints || [] });
      return new QuerySnapshot(r.docs.map(d => new DocumentSnapshot(new DocumentReference(q.firestore, q.path + '/' + d.id), d.data)));
    },
    setDoc: (ref, data, opts) => commitOne({ op: 'set', path: ref.path, data: encode(data), merge: !!(opts && opts.merge) }),
    updateDoc: (ref, data) => commitOne({ op: 'update', path: ref.path, data: encode(data) }),
    deleteDoc: ref => commitOne({ op: 'delete', path: ref.path }),
    onSnapshot(target, a, b) {
      const next = typeof a === 'function' ? a : a && a.next, err = typeof a === 'function' ? b : a && a.error;
      const isDoc = target.type === 'document';
      const spec = isDoc ? { kind: 'doc', path: target.path } : { kind: 'query', path: target.path, constraints: target.constraints || [] };
      let dead = false;
      const off = transport.listen(spec, getToken(), ev => {
        if (dead) return;
        if (ev.error) { dead = true; off && off(); err && err(new FirebaseError(ev.error.code, ev.error.message)); return; }
        const snap = isDoc ? new DocumentSnapshot(target, ev.snap.data)
          : new QuerySnapshot(ev.snap.docs.map(d => new DocumentSnapshot(new DocumentReference(target.firestore, target.path + '/' + d.id), d.data)));
        next && next(snap);
      });
      return () => { dead = true; off && off(); };
    },
    writeBatch() {
      const writes = []; let done = false;
      const b = {
        set(ref, data, opts) { writes.push({ op: 'set', path: ref.path, data: encode(data), merge: !!(opts && opts.merge) }); return b; },
        update(ref, data) { writes.push({ op: 'update', path: ref.path, data: encode(data) }); return b; },
        delete(ref) { writes.push({ op: 'delete', path: ref.path }); return b; },
        async commit() { if (done) throw new FirebaseError('failed-precondition', 'A write batch can no longer be used after commit() has been called.'); done = true; if (writes.length) await call('fs.commit', { reads: [], writes }); }
      };
      return b;
    },
    async runTransaction(db, fn) {
      const max = options.txMaxAttempts || 5;
      let lastErr;
      for (let attempt = 0; attempt < max; attempt++) {
        const reads = new Map(), writes = [];
        const tx = {
          async get(ref) {
            if (writes.length) throw new FirebaseError('invalid-argument', 'Firestore transactions require all reads to be executed before all writes.');
            const r = await call('fs.getDoc', { path: ref.path });
            if (!reads.has(ref.path)) reads.set(ref.path, r.version);
            return new DocumentSnapshot(ref, r.data);
          },
          set(ref, data, opts) { writes.push({ op: 'set', path: ref.path, data: encode(data), merge: !!(opts && opts.merge) }); return tx; },
          update(ref, data) { writes.push({ op: 'update', path: ref.path, data: encode(data) }); return tx; },
          delete(ref) { writes.push({ op: 'delete', path: ref.path }); return tx; }
        };
        const result = await fn(tx);
        try {
          await call('fs.commit', { reads: [...reads].map(([path, version]) => ({ path, version })), writes });
          return result;
        } catch (e) {
          if (e && e.code === 'aborted') { lastErr = e; await sleep((options.txBackoffMs ?? 15) * (1 + Math.random()) * (attempt + 1)); continue; }
          throw e;
        }
      }
      throw lastErr || new FirebaseError('aborted', 'Transaction failed all retries.');
    }
  };
  function commitOne(w) { return call('fs.commit', { reads: [], writes: [w] }).then(() => undefined); }
  return api;
}

// ---- Auth ----
const KEY = 'fakeauth:user';
function createAuth(ctx) {
  const { transport, storage } = ctx;
  const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const LOCAL = { type: 'LOCAL' }, SESSION = { type: 'SESSION' };
  const state = { user: null, token: null, persistence: 'local', listeners: new Set(), ready: null };
  const mk = u => u && { uid: u.uid, email: u.email || null, isAnonymous: !!u.anonymous, providerData: [], getIdToken: async () => state.token };
  const store = () => (state.persistence === 'session' ? storage.session : storage.local);
  const persist = () => {
    safe(() => storage.local.removeItem(KEY)); safe(() => storage.session.removeItem(KEY));
    if (state.user) safe(() => store().setItem(KEY, JSON.stringify({ token: state.token, user: state.user })));
  };
  const emit = () => { const u = mk(state.user); state.listeners.forEach(cb => Promise.resolve().then(() => state.listeners.has(cb) && cb(auth.currentUser))); return u; };
  const set = (user, token) => { state.user = user; state.token = token; auth.currentUser = mk(user); persist(); emit(); };
  const auth = { type: 'auth', currentUser: null, _state: state };

  // Restore a persisted user (session storage wins, like a tab that already had a login); validate with backend.
  state.ready = (async () => {
    for (const [mode, st] of [['session', storage.session], ['local', storage.local]]) {
      const raw = safe(() => st.getItem(KEY)); if (!raw) continue;
      try {
        const saved = JSON.parse(raw);
        const who = await transport.call('auth.whoami', {}, saved.token);
        if (who && who.user) { state.persistence = mode; state.user = who.user; state.token = saved.token; auth.currentUser = mk(who.user); return; }
      } catch (e) { /* stale */ }
      safe(() => st.removeItem(KEY));
    }
  })();

  const authCall = async (op, args) => { try { return await transport.call(op, args, state.token); } catch (e) { throw e; } };
  return {
    getAuth() { return auth; },
    browserLocalPersistence: LOCAL, browserSessionPersistence: SESSION,
    async setPersistence(a, p) { await state.ready; state.persistence = p === SESSION ? 'session' : 'local'; if (state.user) persist(); },
    onAuthStateChanged(a, cb) {
      // Like the real SDK: first callback after initialization (persisted user restored), then on every change.
      let active = true;
      const wrapped = u => cb(u);
      state.ready.then(() => { if (!active) return; state.listeners.add(wrapped); cb(auth.currentUser); });
      return () => { active = false; state.listeners.delete(wrapped); };
    },
    async createUserWithEmailAndPassword(a, email, password) {
      await state.ready; const r = await authCall('auth.signUp', { email, password }); set(r.user, r.token); return { user: auth.currentUser, providerId: null, operationType: 'signIn' };
    },
    async signInWithEmailAndPassword(a, email, password) {
      await state.ready; const r = await authCall('auth.signIn', { email, password }); set(r.user, r.token); return { user: auth.currentUser, providerId: null, operationType: 'signIn' };
    },
    async signInAnonymously() {
      await state.ready; const r = await authCall('auth.signInAnon', {}); set(r.user, r.token); return { user: auth.currentUser, providerId: null, operationType: 'signIn' };
    },
    async signOut() {
      await state.ready; const t = state.token;
      if (t) { try { await transport.call('auth.signOut', {}, t); } catch (e) { /* offline: still sign out locally */ } }
      set(null, null);
    }
  };
}

export function createSdk({ transport, storage, options = {} }) {
  const auth = createAuth({ transport, storage });
  const getToken = () => auth.getAuth()._state.token;
  const firestore = createFirestore({ transport, getToken, options });
  const apps = [];
  const app = {
    initializeApp(config, name = '[DEFAULT]') { const a = { name, options: config }; apps.push(a); return a; },
    getApp() { return apps[0]; }, getApps() { return apps.slice(); }
  };
  return { app, auth, firestore };
}

// Node helper: in-memory Storage
export class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
