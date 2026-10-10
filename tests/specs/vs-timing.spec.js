// VS timing lives in three places that must agree: the vs.js constants, firestore.rules (qOpensAt, clockOver, the
// answer window) and tests/fake/rules.js. This reads all three as text and checks them against each other.
// If you change a number, change all three, rerun this, and republish firestore.rules in the Firebase console.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../helpers/fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const num = (src, re, what) => { const m = re.exec(src); expect(m, what).not.toBeNull(); return Number(m[1]); };

test('vs.js, firestore.rules and tests/fake/rules.js agree on the match clock', () => {
  const vs = read('vs.js'), rules = read('firestore.rules'), fake = read('tests/fake/rules.js');
  const Q = num(vs, /Q_BASE = (\d+)/, 'Q_BASE'), REV = num(vs, /REVEAL_BASE = (\d+)/, 'REVEAL_BASE'), LEAD = num(vs, /LEAD_BASE = (\d+)/, 'LEAD_BASE'), LATE = num(vs, /LATE_BASE = (\d+)/, 'LATE_BASE');
  const SLOT = Q + REV;
  expect({ Q, REV, LEAD, LATE }).toEqual({ Q: 15000, REV: 2500, LEAD: 5000, LATE: 8000 });   // the documented schedule
  // firestore.rules
  expect(num(rules, /qOpensAt\(m, q\) \{ return m\.startAt \+ duration\.value\((\d+) \+ q \* \d+, 'ms'\)/, 'rules qOpensAt lead')).toBe(LEAD);
  expect(num(rules, /qOpensAt\(m, q\) \{ return m\.startAt \+ duration\.value\(\d+ \+ q \* (\d+), 'ms'\)/, 'rules qOpensAt slot')).toBe(SLOT);
  expect(num(rules, /clockOver\(m\) \{ return request\.time > m\.startAt \+ duration\.value\(\d+ \+ qn\(m\) \* (\d+), 'ms'\)/, 'rules clockOver slot')).toBe(SLOT);
  const over = num(rules, /clockOver\(m\) \{ return request\.time > m\.startAt \+ duration\.value\((\d+) \+ qn\(m\)/, 'rules clockOver offset');
  expect(over).toBe(LEAD - REV + 500);   // the last question's reveal is over (+0.5 s slack)
  expect(num(rules, /qOpensAt\(get\(matchPath\(code\)\)\.data, request\.resource\.data\.q\) \+ duration\.value\((\d+), 'ms'\)/, 'rules answer window')).toBe(Q + LATE);
  expect(num(rules, /request\.resource\.data\.elapsedMs <= (\d+)/, 'rules elapsedMs cap')).toBe(Q);
  // tests/fake/rules.js
  expect(num(fake, /const LATE = (\d+);/, 'fake LATE')).toBe(LATE);
  expect(num(fake, /qOpensAt = \(c, m, q\) => ms\(m\.startAt\) \+ \((\d+) \+ q \* \d+\)/, 'fake lead')).toBe(LEAD);
  expect(num(fake, /qOpensAt = \(c, m, q\) => ms\(m\.startAt\) \+ \(\d+ \+ q \* (\d+)\)/, 'fake slot')).toBe(SLOT);
  expect(num(fake, /clockOver = \(c, m\) => c\.time > ms\(m\.startAt\) \+ \((\d+) \+ qn\(m\)/, 'fake clockOver offset')).toBe(over);
  expect(num(fake, /clockOver = \(c, m\) => c\.time > ms\(m\.startAt\) \+ \(\d+ \+ qn\(m\) \* (\d+)\)/, 'fake clockOver slot')).toBe(SLOT);
  expect(num(fake, /open \+ \((\d+) \+ LATE\) \* c\.ts/, 'fake window')).toBe(Q);
  expect(num(fake, /elapsedMs <= (\d+) \* c\.ts/, 'fake elapsedMs cap')).toBe(Q);
});

test('the page builds VS rounds the rules accept: every match room and deck id is whitelisted for this game', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const ids = await dev.page.evaluate(() => ({ game: Arcade.GAME, decks: Arcade.DECKS.map(d => d.id), rooms: Arcade.ROOMS.filter(r => !r.solo).map(r => r.id) }));
  const { DECKS_BY_GAME, ROOMS_BY_GAME } = await import('../fake/rules.js');
  expect(ids.game).toBe('chem');
  expect(ids.decks).toEqual(DECKS_BY_GAME.chem);
  expect(ids.rooms).toEqual(ROOMS_BY_GAME.chem);
});
