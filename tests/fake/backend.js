// In-memory fake Firebase backend (Auth + Firestore). Lives in the Node test process and is shared by every
// browser context and scripted client. Rules (./rules.js) run on every get, list and write with the caller's auth.
import { evaluate } from './rules.js';
import { FirebaseError } from './sdk.js';

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isTs = v => v !== null && typeof v === 'object' && typeof v.__ts === 'number';
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !isTs(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rand = n => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

export class Backend {
  constructor(opts = {}) {
    this.docs = new Map();            // path -> {data|null, version}
    this.users = new Map();           // uid -> {uid, email, password, anonymous}
    this.byEmail = new Map();
    this.tokens = new Map();          // token -> uid
    this.listeners = new Set();
    this.clockOffset = 0;             // ms added to Date.now() (advanceClock)
    this.rulesEnabled = opts.rules !== false;
    this.anonymousEnabled = true;     // set false to emulate the Anonymous provider being off in the console
    this.offline = false;             // true: every call fails with 'unavailable'
    this.denials = [];                // [{op, path, uid, reason}] every rules rejection, for assertions
    this.commits = 0;
  }
  now() { return Date.now() + this.clockOffset; }
  advanceClock(ms) { this.clockOffset += ms; }

  // ---------- auth ----------
  authFor(token) {
    const uid = token && this.tokens.get(token);
    const u = uid && this.users.get(uid);
    return u ? { uid: u.uid, anon: !!u.anonymous, email: u.email || null } : null;
  }
  _session(u) { const token = 't_' + rand(24); this.tokens.set(token, u.uid); return { token, user: { uid: u.uid, email: u.email || null, anonymous: !!u.anonymous } }; }
  _authCall(op, args, token) {
    if (op === 'auth.whoami') { const a = this.authFor(token); return a ? { user: { uid: a.uid, email: a.email, anonymous: a.anon } } : { user: null }; }
    if (op === 'auth.signOut') {
      const uid = this.tokens.get(token); this.tokens.delete(token);
      const u = uid && this.users.get(uid);
      if (u && u.anonymous) this.users.delete(uid);
      this._relisten(token);
      return {};
    }
    if (op === 'auth.signInAnon') {
      if (!this.anonymousEnabled) throw new FirebaseError('auth/admin-restricted-operation', 'This operation is restricted to administrators only.');
      const cur = this.authFor(token);
      if (cur && cur.anon) return this._session(this.users.get(cur.uid));
      const u = { uid: 'anon_' + rand(20), email: null, anonymous: true };
      this.users.set(u.uid, u); return this._session(u);
    }
    const email = String(args.email || '').toLowerCase();
    if (op === 'auth.signUp') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new FirebaseError('auth/invalid-email', 'The email address is badly formatted.');
      if (this.byEmail.has(email)) throw new FirebaseError('auth/email-already-in-use', 'The email address is already in use by another account.');
      if (String(args.password || '').length < 6) throw new FirebaseError('auth/weak-password', 'Password should be at least 6 characters.');
      const u = { uid: 'user_' + rand(22), email, password: args.password, anonymous: false };
      this.users.set(u.uid, u); this.byEmail.set(email, u.uid); return this._session(u);
    }
    if (op === 'auth.signIn') {
      const u = this.users.get(this.byEmail.get(email));
      if (!u || u.password !== args.password) throw new FirebaseError('auth/invalid-credential', 'Firebase: Error (auth/invalid-credential).');
      return this._session(u);
    }
    throw new FirebaseError('unimplemented', 'unknown op ' + op);
  }

  // ---------- rpc entry point (browser server and in-process transports both use this) ----------
  async call(op, args, token) {
    if (this.offline) throw new FirebaseError('unavailable', 'Failed to get document because the client is offline.');
    if (op.startsWith('auth.')) return this._authCall(op, args || {}, token);
    const auth = this.authFor(token);
    if (op === 'fs.getDoc') return this.getDoc(auth, args.path);
    if (op === 'fs.getDocs') return this.getDocs(auth, args.path, args.constraints || []);
    if (op === 'fs.commit') return this.commit(auth, args);
    throw new FirebaseError('unimplemented', 'unknown op ' + op);
  }

  // ---------- firestore ----------
  _doc(path) { const d = this.docs.get(path); return d && d.data ? d.data : null; }
  _version(path) { const d = this.docs.get(path); return d ? d.version : 0; }
  _ctx(auth, time, post) {
    const pre = p => this._doc(p), after = p => (post && post.has(p) ? post.get(p) : pre(p));
    return {
      uid: auth && auth.uid, anon: !!(auth && auth.anon), signedIn: !!auth, time,
      get: p => clone(pre(p)), exists: p => pre(p) !== null,
      getAfter: p => clone(after(p)), existsAfter: p => after(p) !== null
    };
  }
  _deny(op, path, auth, reason) {
    this.denials.push({ op, path, uid: auth && auth.uid, reason });
    const e = new FirebaseError('permission-denied', 'Missing or insufficient permissions.');
    e.detail = reason; return e;
  }
  _checkRead(auth, op, path, q) {
    if (!this.rulesEnabled) return;
    const ctx = Object.assign(this._ctx(auth, this.now(), null), { res: op === 'get' ? this._doc(path) : null, inc: null, changed: [], q });
    const r = evaluate(op, path, ctx);
    if (!r.allowed) throw this._deny(op, path, auth, r.reason);
  }

  getDoc(auth, path) {
    this._checkRead(auth, 'get', path);
    return { data: clone(this._doc(path)), version: this._version(path) };
  }
  _matchWhere(data, c) {
    const val = c.field.split('.').reduce((a, k) => (a == null ? undefined : a[k]), data);
    const norm = x => (isTs(x) ? x.__ts : x);
    const a = norm(val), b = norm(c.value);
    switch (c.op) {
      case '==': return sameJson(a, b);
      case '!=': return !sameJson(a, b);
      case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
      case 'in': return Array.isArray(c.value) && c.value.some(x => sameJson(norm(x), a));
      default: throw new FirebaseError('invalid-argument', 'unsupported where operator ' + c.op);
    }
  }
  _queryDocs(path, constraints) {
    const wheres = constraints.filter(c => c.kind === 'where'), lim = constraints.find(c => c.kind === 'limit');
    const depth = path.split('/').length + 1, prefix = path + '/';
    let out = [];
    for (const [p, d] of this.docs) {
      if (!d.data || !p.startsWith(prefix) || p.split('/').length !== depth) continue;
      if (wheres.every(w => this._matchWhere(d.data, w))) out.push({ id: p.slice(prefix.length), data: d.data, version: d.version });
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (lim) out = out.slice(0, lim.n);
    return { wheres, out };
  }
  getDocs(auth, path, constraints) {
    const { wheres, out } = this._queryDocs(path, constraints);
    this._checkRead(auth, 'list', path, { wheres, limit: (constraints.find(c => c.kind === 'limit') || {}).n });
    return { docs: out.map(d => ({ id: d.id, data: clone(d.data) })) };
  }

  // resolve serverTimestamp / increment against the existing value
  _resolve(val, existing, t) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if ('__sv' in val) return { __ts: t };
      if ('__inc' in val) return (typeof existing === 'number' ? existing : 0) + val.__inc;
      if (isTs(val)) return val;
      const out = {}; for (const k of Object.keys(val)) out[k] = this._resolve(val[k], isPlain(existing) ? existing[k] : undefined, t); return out;
    }
    if (Array.isArray(val)) return val.map(x => this._resolve(x, undefined, t));
    return val;
  }
  _applyUpdate(before, data, t) {
    const out = clone(before);
    for (const key of Object.keys(data)) {
      const parts = key.split('.'); let cur = out, ex = before;
      for (let i = 0; i < parts.length - 1; i++) { if (!isPlain(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; ex = isPlain(ex) ? ex[parts[i]] : undefined; }
      const last = parts[parts.length - 1];
      cur[last] = this._resolve(data[key], isPlain(ex) ? ex[last] : undefined, t);
    }
    return out;
  }
  _deepMerge(a, b) {
    const out = clone(a);
    for (const k of Object.keys(b)) out[k] = isPlain(b[k]) && isPlain(out[k]) ? this._deepMerge(out[k], b[k]) : b[k];
    return out;
  }

  /** Atomic: optimistic read-version check, apply writes to a working copy, rules on each write, then publish. */
  commit(auth, { reads = [], writes = [] }) {
    const t = this.now();
    for (const r of reads) if (this._version(r.path) !== r.version) throw new FirebaseError('aborted', 'Transaction aborted due to document contention.');
    const work = new Map(), steps = [];
    const cur = p => (work.has(p) ? work.get(p) : this._doc(p));
    for (const w of writes) {
      const before = cur(w.path); let after;
      if (w.op === 'delete') after = null;
      else if (w.op === 'update') {
        if (!before) throw new FirebaseError('not-found', 'No document to update: ' + w.path);
        after = this._applyUpdate(before, w.data, t);
      } else {
        after = w.merge && before ? this._deepMerge(before, this._resolve(w.data, before, t)) : this._resolve(w.data, undefined, t);
      }
      work.set(w.path, after);
      steps.push({ w, before: clone(before), after: clone(after) });
    }
    if (this.rulesEnabled) {
      const base = this._ctx(auth, t, work);
      for (const s of steps) {
        if (s.w.op === 'delete' && !s.before) continue;
        const op = s.w.op === 'delete' ? 'delete' : s.before ? 'update' : 'create';
        const changed = s.after && s.before ? [...new Set([...Object.keys(s.before), ...Object.keys(s.after)])].filter(k => !sameJson(s.before[k], s.after[k]))
          : s.after ? Object.keys(s.after) : [];
        const r = evaluate(op, s.w.path, Object.assign({}, base, { res: s.before, inc: s.after, changed, q: null }));
        if (!r.allowed) throw this._deny(op, s.w.path, auth, r.reason);
      }
    }
    for (const [p, data] of work) this.docs.set(p, { data, version: this._version(p) + 1 });
    this.commits++;
    this._notify(new Set(work.keys()));
    return { time: t };
  }

  // ---------- realtime listeners ----------
  /** spec: {kind:'doc',path} | {kind:'query',path,constraints}. push({snap}|{error}). Returns unsubscribe. */
  listen(token, spec, push) {
    const L = { token, spec, push, sig: null, dead: false };
    this.listeners.add(L);
    queueMicrotask(() => this._eval(L));
    return () => { L.dead = true; this.listeners.delete(L); };
  }
  _eval(L) {
    if (L.dead) return;
    if (this.offline) return;
    const auth = this.authFor(L.token);
    try {
      let snap, sig;
      if (L.spec.kind === 'doc') {
        this._checkRead(auth, 'get', L.spec.path);
        snap = { data: clone(this._doc(L.spec.path)) }; sig = this._version(L.spec.path);
      } else {
        const { wheres, out } = this._queryDocs(L.spec.path, L.spec.constraints || []);
        this._checkRead(auth, 'list', L.spec.path, { wheres, limit: ((L.spec.constraints || []).find(c => c.kind === 'limit') || {}).n });
        snap = { docs: out.map(d => ({ id: d.id, data: clone(d.data) })) }; sig = out.map(d => d.id + '@' + d.version).join(',');
      }
      if (sig === L.sig) return;
      L.sig = sig; L.push({ snap });
    } catch (e) {
      L.dead = true; this.listeners.delete(L);
      L.push({ error: { code: e.code || 'unknown', message: e.message } });
    }
  }
  _notify(paths) {
    for (const L of [...this.listeners]) {
      const sp = L.spec.path;
      const hit = L.spec.kind === 'doc' ? paths.has(sp) : [...paths].some(p => p.startsWith(sp + '/') && p.split('/').length === sp.split('/').length + 1);
      // players/answers rules read other docs; re-evaluating on any change under the same match keeps access changes live
      if (hit) queueMicrotask(() => this._eval(L));
    }
  }
  _relisten(token) { for (const L of [...this.listeners]) if (L.token === token) queueMicrotask(() => this._eval(L)); }

  // ---------- test/admin helpers (bypass rules) ----------
  adminSet(path, data) { const d = this._resolve(clone(data), undefined, this.now()); this.docs.set(path, { data: d, version: this._version(path) + 1 }); this._notify(new Set([path])); }
  adminGet(path) { return clone(this._doc(path)); }
  adminList(path) { return this._queryDocs(path, []).out.map(d => ({ id: d.id, ...clone(d.data) })); }
  denialsFor(substr) { return this.denials.filter(d => d.reason.includes(substr)); }
}

export const T = ms => ({ __ts: ms });   // wire-form Timestamp for adminSet
