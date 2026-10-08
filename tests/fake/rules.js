// Rules fake: a data-driven JS port of the VS Arena security rules (SPEC.md "Data model") plus the existing
// /players rule (progress whitelist now also allows vs, vsAt). It is evaluated by the backend on every
// read, list and write. Keep it readable: it is meant to be diffed against the real firestore.rules.
//
// Shape:  RULES = [{ path: 'a/{x}/b/{y}', get|list|create|update|delete: <op> }]
//   <op>     = clause list (all must pass)  OR  [alt(name, ...clauses), ...] (any alternative may pass)
//   clause   = [label, (c) => boolean]
// Anything not matched by a RULES entry is denied (Firestore default).
//
// Context c:
//   c.uid, c.anon (anonymous provider), c.signedIn      c.params (path wildcards)   c.time (request.time ms)
//   c.res  resource.data (before, or null)              c.inc request.resource.data (after the write, or null)
//   c.q    {wheres:[{field,op,value}], limit}  for list
//   c.get(path)/c.exists(path)  state BEFORE the commit;  c.getAfter(path)/c.existsAfter(path)  state AFTER it
//   c.changed  top-level keys whose value differs between res and inc (request.resource.data.diff().affectedKeys())

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const DECK_IDS = ['s20', 'r4', 'r5', 'r6', 'r7', 'e118', 'cat', 'an', 'iso', 'all'];
export const ROOM_IDS = ['ability', 'symbol', 'number', 'config', 'table', 'type', 'lab', 'mixed'];
export const REACTIONS = ['nice', 'hmm', 'fire', 'gg', 'oops'];
const MAX_CAP = 20, MIN_CAP = 2, LOBBY_MS = 5 * 60 * 1000, SLACK_MS = 60 * 1000, AGG_MS = 60 * 1000;

export const MATCH_KEYS = ['hostUid', 'hostNick', 'cls', 'deck', 'room', 'seed', 'cap', 'allowGuests', 'listed', 'status',
  'createdAt', 'expireAt', 'playerCount', 'startAt', 'alive', 'aggUid', 'aggUntil', 'winnerUid', 'endedAt', 'rematch'];
export const PLAYER_KEYS = ['nick', 'guest', 'joinedAt', 'lastSeen', 'score', 'correct', 'totalMs', 'answeredQ', 'reaction',
  'reactionAt', 'abandoned', 'left', 'streak'];
const PLAYER_REQUIRED = ['nick', 'guest', 'joinedAt', 'lastSeen', 'score', 'correct', 'totalMs', 'answeredQ', 'abandoned', 'left'];
export const ANSWER_KEYS = ['q', 'choice', 'elapsedMs', 'correct', 'points', 'at'];
const PROGRESS_KEYS = ['owned', 'miss', 'stars', 'xp', 'rounds', 'best', 'vs', 'vsAt'];
const TOP_PLAYER_KEYS = ['progress', 'nick', 'cls', 'updated'];

// ---- tiny helpers (the Firestore-rules vocabulary) ----
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !('__ts' in v);
const isTs = v => v !== null && typeof v === 'object' && typeof v.__ts === 'number';
const ms = v => (isTs(v) ? v.__ts : NaN);
const isInt = v => Number.isInteger(v);
const isStr = v => typeof v === 'string';
const isBool = v => typeof v === 'boolean';
const intIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
const keys = o => (isObj(o) ? Object.keys(o) : []);
const hasOnly = (o, allowed) => isObj(o) && keys(o).every(k => allowed.includes(k));
const hasAll = (o, req) => isObj(o) && req.every(k => k in o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const subset = (arr, allowed) => arr.every(k => allowed.includes(k));
const validCode = s => isStr(s) && s.length === 6 && [...s].every(ch => CODE_ALPHABET.includes(ch));

const alt = (name, ...clauses) => ({ name, clauses });
const asAlts = op => (Array.isArray(op) && op.length && !Array.isArray(op[0]) && op[0].clauses ? op : [alt('rule', ...op)]);

// ---- shared predicates ----
const signedIn = ['signed in', c => c.signedIn];
const notAnon = ['not anonymous', c => c.signedIn && !c.anon];
const matchPath = c => 'matches/' + c.params.code;
const playerPath = (c, uid) => matchPath(c) + '/players/' + uid;
const isParticipant = c => c.signedIn && c.exists(playerPath(c, c.uid));
const matchStatus = c => (c.get(matchPath(c)) || {}).status;

// ---- matches/{code} ----
const matchShape = ['match has exactly the allowed keys', c => hasOnly(c.inc, MATCH_KEYS) && hasAll(c.inc, MATCH_KEYS)];
const matchCreate = [
  signedIn, notAnon,
  ['code is 6 chars from the alphabet', c => validCode(c.params.code)],
  matchShape,
  ['hostUid == uid', c => c.inc.hostUid === c.uid],
  ['host has a /players doc; cls and hostNick match it', c => { const p = c.get('players/' + c.uid); return !!p && c.inc.cls === p.cls && c.inc.hostNick === p.nick; }],
  ['deck and room are known ids', c => DECK_IDS.includes(c.inc.deck) && ROOM_IDS.includes(c.inc.room)],
  ['seed is a uint32', c => intIn(c.inc.seed, 0, 4294967295)],
  ['cap is an int 2..20', c => intIn(c.inc.cap, MIN_CAP, MAX_CAP)],
  ['allowGuests and listed are booleans', c => isBool(c.inc.allowGuests) && isBool(c.inc.listed)],
  ["status == 'lobby'", c => c.inc.status === 'lobby'],
  ['createdAt == request.time (serverTimestamp)', c => ms(c.inc.createdAt) === c.time],
  ['expireAt is a Timestamp within ~5 min of now', c => isTs(c.inc.expireAt) && ms(c.inc.expireAt) <= c.time + LOBBY_MS + SLACK_MS && ms(c.inc.expireAt) > c.time - SLACK_MS],
  ['playerCount == 1, alive == 1', c => c.inc.playerCount === 1 && c.inc.alive === 1],
  ['startAt, winnerUid, endedAt, rematch are null', c => c.inc.startAt === null && c.inc.winnerUid === null && c.inc.endedAt === null && c.inc.rematch === null],
  ['aggUid == uid and aggUntil is a Timestamp <= now+60s', c => c.inc.aggUid === c.uid && isTs(c.inc.aggUntil) && ms(c.inc.aggUntil) <= c.time + AGG_MS + SLACK_MS],
  ["host's player doc is created in the same batch", c => c.existsAfter(playerPath(c, c.uid))]
];

const SETTINGS = ['deck', 'room', 'seed', 'cap', 'allowGuests', 'listed'];
const AGG = ['alive', 'aggUid', 'aggUntil'];
const MUTABLE = [...SETTINGS, 'startAt', 'rematch', 'status', 'winnerUid', 'endedAt', ...AGG, 'playerCount'];
const touched = (c, list) => c.changed.some(k => list.includes(k));
const isHost = c => c.res.hostUid === c.uid;
const matchUpdateParticipant = [
  signedIn,
  ['stays a well-formed match', c => hasOnly(c.inc, MATCH_KEYS) && hasAll(c.inc, MATCH_KEYS)],
  ['only mutable fields change (hostUid, hostNick, cls, createdAt, expireAt are fixed)', c => subset(c.changed, MUTABLE)],
  ['caller is a participant (or is joining in this commit)', c => c.exists(playerPath(c, c.uid)) || c.existsAfter(playerPath(c, c.uid))],
  ['finished matches only accept rematch; expired/abandoned accept nothing',
    c => c.res.status === 'lobby' || c.res.status === 'playing' || (c.res.status === 'done' && subset(c.changed, ['rematch']))],
  ['settings: host only, lobby only, valid values, cap >= playerCount', c => !touched(c, SETTINGS) || (
    isHost(c) && c.res.status === 'lobby' && DECK_IDS.includes(c.inc.deck) && ROOM_IDS.includes(c.inc.room) &&
    intIn(c.inc.seed, 0, 4294967295) && intIn(c.inc.cap, MIN_CAP, MAX_CAP) && c.inc.cap >= c.res.playerCount &&
    isBool(c.inc.allowGuests) && isBool(c.inc.listed))],
  ['startAt: host only, together with lobby->playing, startAt == request.time', c => !touched(c, ['startAt']) || (
    isHost(c) && c.res.status === 'lobby' && c.inc.status === 'playing' && ms(c.inc.startAt) === c.time)],
  ['status moves forward only: lobby->playing (host, with startAt), playing->done|abandoned (participant)', c => !touched(c, ['status']) || (
    (c.res.status === 'lobby' && c.inc.status === 'playing' && isHost(c) && touched(c, ['startAt'])) ||
    (c.res.status === 'playing' && (c.inc.status === 'done' || c.inc.status === 'abandoned')))],
  ['winnerUid/endedAt change only with done|abandoned; done needs a real winner, abandoned has none', c => {
    const ending = touched(c, ['status']) && (c.inc.status === 'done' || c.inc.status === 'abandoned');
    if (!touched(c, ['winnerUid', 'endedAt']) && !ending) return true;
    if (!ending || !isTs(c.inc.endedAt)) return false;
    return c.inc.status === 'done' ? (isStr(c.inc.winnerUid) && c.exists(playerPath(c, c.inc.winnerUid))) : c.inc.winnerUid === null;
  }],
  ['rematch: host only, once, on a done match, valid code', c => !touched(c, ['rematch']) || (
    isHost(c) && c.res.status === 'done' && c.res.rematch === null && validCode(c.inc.rematch))],
  ['alive/aggUid/aggUntil: non-anonymous aggregator (self, or claim a stale lease)', c => !touched(c, AGG) || (
    !c.anon && c.inc.aggUid === c.uid && (c.res.aggUid === c.uid || ms(c.res.aggUntil) < c.time) &&
    isTs(c.inc.aggUntil) && ms(c.inc.aggUntil) <= c.time + AGG_MS + SLACK_MS &&
    intIn(c.inc.alive, 0, MAX_CAP) && c.inc.alive <= c.inc.playerCount)],
  ['playerCount: +1 with own new player doc (lobby, not expired, within cap) or -1 with own player doc deleted (lobby)', c => {
    if (!touched(c, ['playerCount'])) return true;
    const me = playerPath(c, c.uid);
    if (c.res.status !== 'lobby') return false;
    if (c.inc.playerCount === c.res.playerCount + 1) return !c.exists(me) && c.existsAfter(me) && c.inc.playerCount <= c.res.cap && c.time < ms(c.res.expireAt);
    if (c.inc.playerCount === c.res.playerCount - 1) return c.exists(me) && !c.existsAfter(me);
    return false;
  }]
];
const matchUpdateExpire = [
  signedIn,
  ['only status changes', c => same(c.changed, ['status'])],
  ["lobby -> expired", c => c.res.status === 'lobby' && c.inc.status === 'expired'],
  ['request.time > expireAt', c => c.time > ms(c.res.expireAt)]
];

// ---- matches/{code}/players/{pid} ----
const playerShape = ['player doc has the allowed keys (and the required ones on create)', c => hasOnly(c.inc, PLAYER_KEYS)];
const playerInitial = ['initial score 0, correct 0, totalMs 0, answeredQ -1, abandoned/left false, timestamps', c =>
  hasAll(c.inc, PLAYER_REQUIRED) && c.inc.score === 0 && c.inc.correct === 0 && c.inc.totalMs === 0 && c.inc.answeredQ === -1 &&
  c.inc.abandoned === false && c.inc.left === false && isTs(c.inc.joinedAt) && isTs(c.inc.lastSeen) &&
  (c.inc.streak === undefined || c.inc.streak === 0) && (c.inc.reaction == null) && (c.inc.reactionAt == null)];
const ownPlayer = ['pid == uid', c => c.params.pid === c.uid];
const playerCreateHost = alt('host creates the match and own player doc in one batch',
  signedIn, notAnon, ownPlayer, playerShape, playerInitial,
  ['guest == false', c => c.inc.guest === false],
  ['the match is created in the same batch by this user', c => !c.exists(matchPath(c)) && c.existsAfter(matchPath(c)) && c.getAfter(matchPath(c)).hostUid === c.uid]);
const playerCreateJoin = alt('join an open match',
  signedIn, ownPlayer, playerShape, playerInitial,
  ['match exists, status lobby, not expired', c => { const m = c.get(matchPath(c)); return !!m && m.status === 'lobby' && c.time < ms(m.expireAt); }],
  ['playerCount < cap', c => { const m = c.get(matchPath(c)); return !!m && m.playerCount < m.cap; }],
  ['guest == (provider is anonymous)', c => c.inc.guest === c.anon],
  ['anonymous callers need allowGuests', c => !c.anon || c.get(matchPath(c)).allowGuests === true],
  ['nick: signed-in must equal own /players nick; guest nick is a short string', c => {
    if (c.anon) return isStr(c.inc.nick) && c.inc.nick.length >= 1 && c.inc.nick.length <= 24;
    const p = c.get('players/' + c.uid); return !!p && c.inc.nick === p.nick;
  }],
  ['same commit bumps match.playerCount by exactly 1', c => c.existsAfter(matchPath(c)) && c.getAfter(matchPath(c)).playerCount === c.get(matchPath(c)).playerCount + 1]);
const playerUpdateSelf = alt('update own player doc',
  signedIn, ownPlayer,
  ['allowed keys only', c => hasOnly(c.inc, PLAYER_KEYS) && hasAll(c.inc, PLAYER_REQUIRED)],
  ['guest, joinedAt, nick never change', c => !c.changed.some(k => ['guest', 'joinedAt', 'nick'].includes(k))],
  ['answeredQ only increases', c => !c.changed.includes('answeredQ') || (isInt(c.inc.answeredQ) && c.inc.answeredQ > c.res.answeredQ)],
  ['an abandoned player cannot come back', c => c.res.abandoned !== true || c.inc.abandoned === true],
  ['reaction is one of the 5 presets (or null)', c => !c.changed.includes('reaction') || c.inc.reaction === null || (isStr(c.inc.reaction) && REACTIONS.includes(c.inc.reaction.toLowerCase()))]);
const playerMarkAbandoned = alt('aggregator marks another player abandoned (documented deviation)',
  signedIn, notAnon,
  ['not own doc', c => c.params.pid !== c.uid],
  ['caller is a participant', c => isParticipant(c)],
  ['match is playing', c => matchStatus(c) === 'playing'],
  ['only abandoned changes, to true', c => same(c.changed, ['abandoned']) && c.inc.abandoned === true]);
const playerDelete = [
  signedIn, ownPlayer,
  ['match is in lobby', c => matchStatus(c) === 'lobby'],
  ['same commit lowers match.playerCount by 1', c => c.existsAfter(matchPath(c)) && c.getAfter(matchPath(c)).playerCount === c.get(matchPath(c)).playerCount - 1]
];

// ---- matches/{code}/answers/{aid} ----
const answerCreate = [
  signedIn,
  ['answer id is {uid}_{q}, q in 0..9 and equals the q field', c => isObj(c.inc) && intIn(c.inc.q, 0, 9) && c.params.aid === c.uid + '_' + c.inc.q],
  ['exactly the allowed keys', c => hasOnly(c.inc, ANSWER_KEYS) && hasAll(c.inc, ANSWER_KEYS)],
  ['caller is a participant', c => isParticipant(c)],
  ["match status is 'playing'", c => matchStatus(c) === 'playing'],
  ['choice int 0..3, elapsedMs number 0..60000, correct boolean', c => intIn(c.inc.choice, 0, 3) && typeof c.inc.elapsedMs === 'number' && c.inc.elapsedMs >= 0 && c.inc.elapsedMs <= 60000 && isBool(c.inc.correct)],
  ['points int 0..150, and 0 when wrong', c => intIn(c.inc.points, 0, 150) && (c.inc.correct || c.inc.points === 0)],
  ['at is a Timestamp', c => isTs(c.inc.at)]
];

// ---- matches/{code}/presence/{pid} ----
const presenceWrite = [
  signedIn, ownPlayer,
  ['caller is a participant', c => isParticipant(c)],
  ['only {at: Timestamp}', c => hasOnly(c.inc, ['at']) && hasAll(c.inc, ['at']) && isTs(c.inc.at)]
];

// ---- /players/{uid} (existing rule + vs, vsAt; anonymous users get nothing) ----
const playersOwn = [signedIn, notAnon, ['uid == auth.uid', c => c.params.uid === c.uid]];
const playersWrite = playersOwn.concat([
  ['keys hasOnly progress, nick, cls, updated', c => hasOnly(c.inc, TOP_PLAYER_KEYS)],
  ['progress is a map with whitelisted keys (incl. vs, vsAt)', c => isObj(c.inc.progress) && hasOnly(c.inc.progress, PROGRESS_KEYS)]
]);

export const RULES = [
  { path: 'players/{uid}', get: playersOwn, create: playersWrite, update: playersWrite },
  {
    path: 'matches/{code}',
    get: [signedIn],
    list: [signedIn, notAnon,
      ['query pins listed == true', c => c.q.wheres.some(w => w.field === 'listed' && w.op === '==' && w.value === true)],
      ["query pins status == 'lobby'", c => c.q.wheres.some(w => w.field === 'status' && w.op === '==' && w.value === 'lobby')],
      ["query pins cls == caller's cls", c => { const p = c.get('players/' + c.uid); return !!p && c.q.wheres.some(w => w.field === 'cls' && w.op === '==' && w.value === p.cls); }]],
    create: matchCreate,
    update: [alt('participant/host update', ...matchUpdateParticipant), alt('anyone may expire a stale lobby', ...matchUpdateExpire)]
  },
  {
    path: 'matches/{code}/players/{pid}',
    get: [signedIn, ['participant, or reading own doc', c => c.params.pid === c.uid || isParticipant(c)]],
    list: [signedIn, ['participant', c => isParticipant(c)]],
    create: [playerCreateHost, playerCreateJoin],
    update: [playerUpdateSelf, playerMarkAbandoned],
    delete: playerDelete
  },
  {
    path: 'matches/{code}/answers/{aid}',
    get: [signedIn, ['owner only ({uid}_{q})', c => c.params.aid.startsWith(c.uid + '_')]],
    create: answerCreate
  },
  {
    path: 'matches/{code}/presence/{pid}',
    get: [signedIn, ['participant', c => isParticipant(c)]],
    list: [signedIn, ['participant', c => isParticipant(c)]],
    create: presenceWrite, update: presenceWrite,
    delete: [signedIn, ownPlayer]
  }
];

// ---- evaluation ----
function matchPattern(pattern, segs) {
  const p = pattern.split('/');
  if (p.length !== segs.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    const m = /^\{(\w+)\}$/.exec(p[i]);
    if (m) params[m[1]] = segs[i]; else if (p[i] !== segs[i]) return null;
  }
  return params;
}

/** op: 'get'|'list'|'create'|'update'|'delete'. For 'list' pass the collection path. Returns {allowed, reason}. */
export function evaluate(op, path, ctx) {
  const segs = path.split('/');
  for (const r of RULES) {
    const pat = op === 'list' ? r.path.split('/').slice(0, -1).join('/') : r.path;
    const params = matchPattern(pat, segs);
    if (!params) continue; // list patterns drop the doc-id wildcard; list rules never use it
    const spec = r[op];
    if (!spec) return { allowed: false, reason: `${r.path}: no '${op}' rule` };
    const c = Object.assign({}, ctx, { params });
    const why = [];
    for (const a of asAlts(spec)) {
      let failed = null;
      for (const [label, fn] of a.clauses) {
        let ok = false;
        try { ok = !!fn(c); } catch (e) { ok = false; }
        if (!ok) { failed = label; break; }
      }
      if (failed === null) return { allowed: true, reason: a.name };
      why.push(`${a.name}: failed "${failed}"`);
    }
    return { allowed: false, reason: `${r.path} ${op} denied (${why.join(' | ')})` };
  }
  return { allowed: false, reason: `no rule matches ${path}` };
}
