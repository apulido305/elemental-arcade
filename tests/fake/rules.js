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
// Profile icon ids (index.html ICONS). Optional on /players and on seats; anything else is rejected.
export const ICON_IDS = ['atom', 'bolt', 'beaker', 'crystal', 'flame', 'droplet', 'magnet', 'moon', 'star', 'comet', 'rocket', 'flask', 'crown', 'shield', 'spark', 'wave'];
const MAX_CAP = 20, MIN_CAP = 2;

export const MATCH_KEYS = ['hostUid', 'hostNick', 'cls', 'deck', 'room', 'seed', 'cap', 'allowGuests', 'listed', 'status',
  'createdAt', 'expireAt', 'playerCount', 'startAt', 'alive', 'aggUid', 'aggUntil', 'winnerUid', 'endedAt', 'rematch'];
export const PLAYER_KEYS = ['nick', 'guest', 'joinedAt', 'lastSeen', 'score', 'correct', 'totalMs', 'answeredQ', 'reaction',
  'reactionAt', 'abandoned', 'left', 'streak'];
const SEAT_KEYS = PLAYER_KEYS.concat(['icon']);     // icon is optional: hasOnly allows it, hasAll does not require it
const PLAYER_REQUIRED = ['nick', 'guest', 'joinedAt', 'lastSeen', 'score', 'correct', 'totalMs', 'answeredQ', 'abandoned', 'left'];
export const ANSWER_KEYS = ['q', 'choice', 'elapsedMs', 'correct', 'points', 'at'];
const PROGRESS_KEYS = ['owned', 'miss', 'stars', 'xp', 'rounds', 'best', 'vs', 'vsAt'];
const TOP_PLAYER_KEYS = ['progress', 'nick', 'cls', 'icon', 'updated'];

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
const iconOk = d => !('icon' in d) || ICON_IDS.includes(d.icon);
const validCode = s => isStr(s) && s.length === 6 && [...s].every(ch => CODE_ALPHABET.includes(ch));

const alt = (name, ...clauses) => ({ name, clauses });
const asAlts = op => (Array.isArray(op) && op.length && !Array.isArray(op[0]) && op[0].clauses ? op : [alt('rule', ...op)]);

// ---- shared predicates ----
// Time windows come from the real rules (ms at VS_TIME_SCALE 1); c.ts is the backend's timeScale so tests can run fast.
const grace = c => Math.max(2000 * c.ts, 400);          // clock-drift grace: 2 s real, but never tighter than 400 ms in scaled runs
const qOpensAt = (c, m, q) => ms(m.startAt) + (5000 + q * 17500) * c.ts;
const clockOver = (c, m) => c.time > ms(m.startAt) + 178000 * c.ts;
const signedIn = ['signed in', c => c.signedIn];
const notAnon = ['not anonymous (isAccount)', c => c.signedIn && !c.anon];
const matchPath = c => 'matches/' + c.params.code;
const seatPath = (c, uid) => matchPath(c) + '/players/' + uid;
const answerPath = (c, uid, q) => matchPath(c) + '/answers/' + uid + '_' + q;
const isParticipant = c => c.signedIn && c.exists(seatPath(c, c.uid));
const matchStatus = c => (c.get(matchPath(c)) || {}).status;
const ownPlayerDoc = c => c.get('players/' + c.uid);
const participantClause = ['participant', c => isParticipant(c)];

// ---- matches/{code} ----
const matchCreate = [
  signedIn, notAnon,
  ['code is 6 chars from the alphabet', c => validCode(c.params.code)],
  ['exactly the allowed keys', c => hasOnly(c.inc, MATCH_KEYS) && hasAll(c.inc, MATCH_KEYS)],
  ['hostUid == uid', c => c.inc.hostUid === c.uid],
  ['cls and hostNick match the host /players doc', c => { const p = ownPlayerDoc(c); return !!p && c.inc.cls === p.cls && c.inc.hostNick === p.nick; }],
  ['deck and room are known ids', c => DECK_IDS.includes(c.inc.deck) && ROOM_IDS.includes(c.inc.room)],
  ['seed is a uint32', c => intIn(c.inc.seed, 0, 4294967295)],
  ['cap is an int 2..20', c => intIn(c.inc.cap, MIN_CAP, MAX_CAP)],
  ['allowGuests and listed are booleans', c => isBool(c.inc.allowGuests) && isBool(c.inc.listed)],
  ["status == 'lobby'", c => c.inc.status === 'lobby'],
  ['createdAt == request.time (serverTimestamp)', c => ms(c.inc.createdAt) === c.time],
  ['expireAt is a timestamp <= now + 6 min', c => isTs(c.inc.expireAt) && ms(c.inc.expireAt) <= c.time + 6 * 60 * 1000 * c.ts],
  ['playerCount == 1, alive == 1', c => c.inc.playerCount === 1 && c.inc.alive === 1],
  ['startAt == null', c => c.inc.startAt === null],
  ['aggUid == uid, aggUntil is a timestamp', c => c.inc.aggUid === c.uid && isTs(c.inc.aggUntil)],
  ['winnerUid, endedAt, rematch are null', c => c.inc.winnerUid === null && c.inc.endedAt === null && c.inc.rematch === null]
];
const SETTINGS = ['deck', 'room', 'seed', 'cap', 'allowGuests', 'listed'];
const has = (c, k) => c.changed.includes(k);
const isHostOf = c => c.res.hostUid === c.uid;

const matchUpdate = [
  alt('1. anyone signed in expires a lobby after expireAt',
    signedIn,
    ["res.status == 'lobby'", c => c.res.status === 'lobby'],
    ['request.time > expireAt', c => c.time > ms(c.res.expireAt)],
    ['only status changes', c => subset(c.changed, ['status'])],
    ["status becomes 'expired'", c => c.inc.status === 'expired']),
  alt('2. host edits lobby settings',
    signedIn, ['caller is the host', c => isHostOf(c)],
    ['lobby before and after', c => c.res.status === 'lobby' && c.inc.status === 'lobby'],
    ['only deck, room, seed, cap, allowGuests, listed change', c => subset(c.changed, SETTINGS)],
    ['deck and room known', c => DECK_IDS.includes(c.inc.deck) && ROOM_IDS.includes(c.inc.room)],
    ['seed is a uint32', c => intIn(c.inc.seed, 0, 4294967295)],
    ['cap 2..20 and >= playerCount', c => intIn(c.inc.cap, MIN_CAP, MAX_CAP) && c.inc.cap >= c.res.playerCount],
    ['allowGuests and listed booleans', c => isBool(c.inc.allowGuests) && isBool(c.inc.listed)]),
  alt('3. host starts the match',
    signedIn, ['caller is the host', c => isHostOf(c)],
    ['lobby -> playing', c => c.res.status === 'lobby' && c.inc.status === 'playing'],
    ['playerCount >= 2', c => c.res.playerCount >= 2],
    ['request.time < expireAt', c => c.time < ms(c.res.expireAt)],
    ['only status, startAt, aggUid, aggUntil, alive change', c => subset(c.changed, ['status', 'startAt', 'aggUid', 'aggUntil', 'alive'])],
    ['startAt == request.time', c => ms(c.inc.startAt) === c.time]),
  alt('4. host announces the rematch code',
    signedIn, ['caller is the host', c => isHostOf(c)],
    ["res.status == 'done' and no rematch yet", c => c.res.status === 'done' && c.res.rematch === null],
    ['only rematch changes', c => subset(c.changed, ['rematch'])],
    ['rematch is a valid code', c => isStr(c.inc.rematch) && validCode(c.inc.rematch)]),
  alt('5. seated players end the match / publish alive / claim the aggregator role',
    signedIn, ['caller is seated', c => isParticipant(c)],
    ["res.status == 'playing'", c => c.res.status === 'playing'],
    ['only status, winnerUid, endedAt, alive, aggUid, aggUntil change', c => subset(c.changed, ['status', 'winnerUid', 'endedAt', 'alive', 'aggUid', 'aggUntil'])],
    ['status stays playing, or becomes abandoned, or done with winnerUid unset before', c => c.inc.status === 'playing' || c.inc.status === 'abandoned' || (c.inc.status === 'done' && c.res.winnerUid === null)],
    ['before startAt+178s only an account may end the match (a guest cannot cut it short)', c => c.inc.status === 'playing' || !c.anon || clockOver(c, c.res)],
    ['done must set winnerUid', c => c.inc.status !== 'done' || has(c, 'winnerUid')],
    ['winnerUid only with done, and must be seated', c => !has(c, 'winnerUid') || (c.inc.status === 'done' && isStr(c.inc.winnerUid) && c.exists(seatPath(c, c.inc.winnerUid)))],
    ['endedAt == request.time exactly when ending', c => c.inc.status === 'playing' ? !has(c, 'endedAt') : ms(c.inc.endedAt) === c.time],
    ['alive: account only, int 0..20', c => !has(c, 'alive') || (!c.anon && intIn(c.inc.alive, 0, MAX_CAP))],
    ['aggUid: account only, self, previous lease expired', c => !has(c, 'aggUid') || (!c.anon && c.inc.aggUid === c.uid && ms(c.res.aggUntil) < c.time)],
    ['aggUntil: account only, self is aggUid, within 2 min', c => !has(c, 'aggUntil') || (!c.anon && c.inc.aggUid === c.uid && isTs(c.inc.aggUntil) && ms(c.inc.aggUntil) <= c.time + 120000 * c.ts)]),
  alt('6. seat count +1 / -1 together with own seat create / delete (lobby only)',
    signedIn,
    ['lobby before and after', c => c.res.status === 'lobby' && c.inc.status === 'lobby'],
    ['only playerCount changes, as an int', c => subset(c.changed, ['playerCount']) && isInt(c.inc.playerCount)],
    ['+1 <= cap with own new seat, or -1 with own seat deleted', c => {
      const me = seatPath(c, c.uid);
      return (c.inc.playerCount === c.res.playerCount + 1 && c.inc.playerCount <= c.res.cap && !c.exists(me) && c.existsAfter(me)) ||
             (c.inc.playerCount === c.res.playerCount - 1 && c.inc.playerCount >= 0 && c.exists(me) && !c.existsAfter(me));
    }])
];

// ---- matches/{code}/players/{pid} ----
const SEAT_MUTABLE = ['lastSeen', 'score', 'correct', 'totalMs', 'answeredQ', 'reaction', 'reactionAt', 'abandoned', 'left', 'streak', 'icon'];
const seatCreate = [
  signedIn, ['pid == uid', c => c.params.pid === c.uid],
  ['exactly the 13 seat keys (icon optional)', c => hasOnly(c.inc, SEAT_KEYS) && hasAll(c.inc, PLAYER_KEYS)],
  ['icon (if present) is a preset id', c => iconOk(c.inc)],
  ['guest == (provider is anonymous)', c => c.inc.guest === c.anon],
  ['joinedAt == request.time', c => ms(c.inc.joinedAt) === c.time],
  ['score, correct, totalMs, streak 0; answeredQ -1', c => c.inc.score === 0 && c.inc.correct === 0 && c.inc.totalMs === 0 && c.inc.answeredQ === -1 && c.inc.streak === 0],
  ['abandoned and left false; reaction and reactionAt null', c => c.inc.abandoned === false && c.inc.left === false && c.inc.reaction === null && c.inc.reactionAt === null],
  ['guest nick is "Adjective Element"; account nick is own /players nick', c => c.anon
    ? isStr(c.inc.nick) && /^[A-Z][a-z]{2,11} [A-Z][a-z]{2,11}$/.test(c.inc.nick)
    : (!!ownPlayerDoc(c) && c.inc.nick === ownPlayerDoc(c).nick)]
];
const seatCreateHost = alt('host seat, created in the same batch as the match',
  ...seatCreate,
  ['the match does not exist yet and is created in this batch by this user with playerCount 1', c => { if (c.exists(matchPath(c))) return false; const a = c.getAfter(matchPath(c)); return !!a && a.hostUid === c.uid && a.playerCount === 1; }]);
const seatCreateJoin = alt('join an open lobby',
  ...seatCreate,
  ['match exists, status lobby', c => c.exists(matchPath(c)) && matchStatus(c) === 'lobby'],
  ['playerCount < cap', c => { const m = c.get(matchPath(c)); return !!m && m.playerCount < m.cap; }],
  ['request.time < expireAt', c => { const m = c.get(matchPath(c)); return !!m && c.time < ms(m.expireAt); }],
  ['guests need allowGuests', c => !c.anon || (c.get(matchPath(c)) || {}).allowGuests === true],
  ['same commit bumps playerCount by exactly 1', c => { const m = c.get(matchPath(c)), a = c.getAfter(matchPath(c)); return !!m && !!a && a.playerCount === m.playerCount + 1; }]);
const seatUpdateSelf = alt('update own seat',
  signedIn, ['pid == uid', c => c.params.pid === c.uid],
  ['seat keys only', c => hasOnly(c.inc, SEAT_KEYS)],
  ['icon (if present) is a preset id', c => iconOk(c.inc)],
  ['only lastSeen, score, correct, totalMs, answeredQ, reaction, reactionAt, abandoned, left, streak, icon change (nick, guest, joinedAt fixed)', c => subset(c.changed, SEAT_MUTABLE)],
  ['answeredQ never decreases and is <= 9', c => c.inc.answeredQ >= c.res.answeredQ && c.inc.answeredQ <= 9],
  ['an abandoned player stays abandoned', c => !(c.res.abandoned === true && c.inc.abandoned !== true)],
  ['score/correct/totalMs/answeredQ move only with a brand-new answer doc, by exactly its values', c => {
    if (!c.changed.some(k => ['score', 'correct', 'totalMs', 'answeredQ'].includes(k))) return true;
    const ap = answerPath(c, c.uid, c.inc.answeredQ);
    if (!(c.inc.answeredQ > c.res.answeredQ) || c.exists(ap) || !c.existsAfter(ap)) return false;
    const a = c.getAfter(ap);
    return c.inc.score === c.res.score + a.points && c.inc.correct === c.res.correct + (a.correct ? 1 : 0) && c.inc.totalMs === c.res.totalMs + a.elapsedMs;
  }],
  ['score grows by <= 150 per write, <= 1500', c => c.inc.score >= c.res.score && c.inc.score - c.res.score <= 150 && c.inc.score <= 1500],
  ['correct non-decreasing and <= 10; totalMs non-decreasing', c => c.inc.correct >= c.res.correct && c.inc.correct <= 10 && c.inc.totalMs >= c.res.totalMs],
  ['streak 0..10', c => c.inc.streak >= 0 && c.inc.streak <= 10],
  ['reaction is null or one of nice, hmm, fire, gg, oops', c => c.inc.reaction === null || REACTIONS.includes(c.inc.reaction)],
  ['finished matches only accept lastSeen, reaction, reactionAt, left', c => ['lobby', 'playing'].includes(matchStatus(c)) || subset(c.changed, ['lastSeen', 'reaction', 'reactionAt', 'left'])]);
const seatMarkAbandoned = alt("aggregator marks someone else's seat abandoned",
  signedIn, notAnon, participantClause, ['not own seat', c => c.params.pid !== c.uid],
  ['match is playing', c => matchStatus(c) === 'playing'],
  ['only abandoned changes, to true', c => subset(c.changed, ['abandoned']) && c.inc.abandoned === true]);

// ---- matches/{code}/answers/{aid} ----
const answerCreate = [
  signedIn, participantClause,
  ["match is 'playing'", c => matchStatus(c) === 'playing'],
  ['exactly the allowed keys', c => hasOnly(c.inc, ANSWER_KEYS) && hasAll(c.inc, ANSWER_KEYS)],
  ['q int 0..9 and id == {uid}_{q}', c => intIn(c.inc.q, 0, 9) && c.params.aid === c.uid + '_' + c.inc.q],
  ['choice int 0..3', c => intIn(c.inc.choice, 0, 3)],
  ['elapsedMs >= 0, correct boolean', c => typeof c.inc.elapsedMs === 'number' && c.inc.elapsedMs >= 0 && isBool(c.inc.correct)],
  ['points int 0..150, 0 when wrong', c => intIn(c.inc.points, 0, 150) && (c.inc.correct || c.inc.points === 0)],
  ['the same batch sets seat.answeredQ == q', c => { const s = c.getAfter(seatPath(c, c.uid)); return !!s && s.answeredQ === c.inc.q; }],
  ['seat is not abandoned', c => { const s = c.get(seatPath(c, c.uid)); return !!s && s.abandoned !== true; }],
  ['elapsedMs <= 15000 (scaled)', c => c.inc.elapsedMs <= 15000 * c.ts],
  ['only while the question is on screen: qOpens - grace <= time <= qOpens + 17 s', c => {
    const m = c.get(matchPath(c)); if (!m || !isTs(m.startAt)) return false;
    const open = qOpensAt(c, m, c.inc.q);
    return c.time >= open - grace(c) && c.time <= open + 17000 * c.ts;
  }]
];

// ---- matches/{code}/presence/{pid} ----
const presenceWrite = [
  signedIn, ['pid == uid', c => c.params.pid === c.uid], participantClause,
  ['keys hasOnly [at]', c => hasOnly(c.inc, ['at'])]
];

// ---- /players/{uid} (existing rule + vs, vsAt; anonymous users get nothing) ----
const playersOwn = [signedIn, notAnon, ['uid == auth.uid', c => c.params.uid === c.uid]];
const playersWrite = playersOwn.concat([
  ['keys hasOnly progress, nick, cls, icon, updated', c => hasOnly(c.inc, TOP_PLAYER_KEYS)],
  ['icon (if present) is a preset id', c => iconOk(c.inc)],
  ['progress is a map with whitelisted keys', c => isObj(c.inc.progress) && hasOnly(c.inc.progress, PROGRESS_KEYS)],
  ['progress.vs (if present) is a map with keys w, l, streak, best, played', c => !('vs' in c.inc.progress) || (isObj(c.inc.progress.vs) && hasOnly(c.inc.progress.vs, ['w', 'l', 'streak', 'best', 'played']))],
  ['progress.vsAt (if present) is a number', c => !('vsAt' in c.inc.progress) || typeof c.inc.progress.vsAt === 'number']
]);

export const RULES = [
  { path: 'players/{uid}', get: playersOwn, create: playersWrite, update: playersWrite },
  {
    path: 'matches/{code}',
    get: [signedIn],
    list: [signedIn, notAnon,
      ['query pins listed == true', c => c.q.wheres.some(w => w.field === 'listed' && w.op === '==' && w.value === true)],
      ["query pins status == 'lobby'", c => c.q.wheres.some(w => w.field === 'status' && w.op === '==' && w.value === 'lobby')],
      ["query pins cls == caller's cls", c => { const p = ownPlayerDoc(c); return !!p && c.q.wheres.some(w => w.field === 'cls' && w.op === '==' && w.value === p.cls); }]],
    create: matchCreate,
    update: matchUpdate
  },
  {
    path: 'matches/{code}/players/{pid}',
    get: [signedIn, ['participant, or reading own (maybe missing) seat', c => c.params.pid === c.uid || isParticipant(c)]],
    list: [signedIn, participantClause],
    create: [seatCreateHost, seatCreateJoin],
    update: [seatUpdateSelf, seatMarkAbandoned],
    delete: [signedIn, ['pid == uid', c => c.params.pid === c.uid], ["match is in 'lobby'", c => matchStatus(c) === 'lobby']]
  },
  {
    path: 'matches/{code}/answers/{aid}',
    get: [signedIn, ['owner only ({uid}_{q})', c => c.params.aid.split('_')[0] === c.uid]],
    create: answerCreate
  },
  {
    path: 'matches/{code}/presence/{pid}',
    get: [signedIn, participantClause], list: [signedIn, participantClause],
    create: presenceWrite, update: presenceWrite
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
