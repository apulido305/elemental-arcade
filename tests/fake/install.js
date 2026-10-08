// Playwright side: serve the fake firebase-app/auth/firestore modules in place of gstatic, and wire pages to the
// shared backend server. Also helpers to block Firebase entirely and to stub the Google Fonts requests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SDK_SRC = () => fs.readFileSync(path.join(DIR, 'sdk.js'), 'utf8');

const GLUE = `
import { createSdk, FirebaseError } from './fake-sdk.js';
const cid = 'c_' + Math.random().toString(36).slice(2);
const origin = location.origin;
const post = async (p, body) => {
  let r;
  try { r = await fetch(origin + '/__fb/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }); }
  catch (e) { throw new FirebaseError('unavailable', 'Failed to reach the fake backend (offline).'); }
  return r.json();
};
const handlers = new Map(); let es = null, ready = null, n = 0;
function stream() {   // lazy: an open SSE connection would stop Playwright's networkidle from ever settling
  if (ready) return ready;
  ready = new Promise(res => {
    es = new EventSource(origin + '/__fb/stream?cid=' + cid);
    es.onmessage = e => { const m = JSON.parse(e.data); if (m.hello) res(); else { const h = handlers.get(m.lid); h && h(m); } };
  });
  return ready;
}
const transport = {
  async call(op, args, token) {
    const j = await post('rpc', { op, args, token });
    if (!j.ok) throw new FirebaseError(j.error.code, j.error.message);
    return j.result;
  },
  listen(spec, token, cb) {
    const lid = 'l' + (++n); handlers.set(lid, cb); let off = false;
    stream().then(() => { if (!off) post('listen', { cid, lid, spec, token }); });
    return () => { off = true; handlers.delete(lid); post('unlisten', { cid, lid }).catch(() => {}); };
  }
};
const store = k => { try { return window[k]; } catch (e) { return { getItem() { return null; }, setItem() {}, removeItem() {} }; } };
export const sdk = createSdk({ transport, storage: { local: store('localStorage'), session: store('sessionStorage') }, options: window.__FAKE_FB_OPTIONS || {} });
window.__fakeFirebase = { cid, sdk };
export { FirebaseError };
`;

const exportsOf = (ns, names) => `import { sdk } from './fake-browser.js';\n` +
  names.map(n => `export const ${n} = sdk.${ns}.${n};`).join('\n') + '\n';

// Exactly the SPEC surface; anything else is intentionally missing so accidental use fails loudly.
export const SURFACE = {
  app: ['initializeApp'],
  auth: ['getAuth', 'onAuthStateChanged', 'setPersistence', 'browserLocalPersistence', 'browserSessionPersistence',
    'createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'signInAnonymously', 'signOut'],
  firestore: ['getFirestore', 'doc', 'collection', 'getDoc', 'getDocs', 'setDoc', 'updateDoc', 'deleteDoc', 'onSnapshot', 'query',
    'where', 'limit', 'runTransaction', 'writeBatch', 'serverTimestamp', 'increment', 'Timestamp']
};

export function moduleSource(file) {
  switch (file) {
    case 'fake-sdk.js': return SDK_SRC();
    case 'fake-browser.js': return GLUE;
    case 'firebase-app.js': return exportsOf('app', SURFACE.app);
    case 'firebase-auth.js': return exportsOf('auth', SURFACE.auth);
    case 'firebase-firestore.js': return exportsOf('firestore', SURFACE.firestore);
    default: return null;
  }
}

const GSTATIC = 'https://www.gstatic.com/firebasejs/*/*.js';

/** Make a context talk to the shared backend through the fake SDK modules. */
export async function useFakeFirebase(context, { options } = {}) {
  await context.route(GSTATIC, route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const src = moduleSource(file);
    if (src == null) return route.fulfill({ status: 404, body: 'fake firebase: no module ' + file });
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: src });
  });
  if (options) await context.addInitScript(o => { window.__FAKE_FB_OPTIONS = o; }, options);
}

/** Simulate "Firebase unavailable" (CDN unreachable): cloud.js import fails, solo play must still work. */
export async function blockFirebase(context) {
  await context.route(GSTATIC, route => route.abort('failed'));
}

/** Keep tests hermetic and fast: Google Fonts are stubbed out (fallback fonts render). */
export async function stubFonts(context) {
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
}
