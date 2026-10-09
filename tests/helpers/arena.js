// Shared helpers for Node-only (browserless) arena tests.
import { expect } from '@playwright/test';

/** Assert a promise rejects with a FirebaseError whose code is permission-denied (optionally with a rule-reason substring). */
export async function expectDenied(promise, reasonPart, backend) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  expect(err, 'expected the write/read to be rejected by the rules fake').not.toBeNull();
  expect(err.name).toBe('FirebaseError');
  expect(err.code).toBe('permission-denied');
  if (reasonPart) expect(err.detail || '', `rule reason for: ${reasonPart}`).toContain(reasonPart);
  return err;
}

export async function expectCode(promise, code) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  expect(err, `expected rejection with ${code}`).not.toBeNull();
  expect(err.code).toBe(code);
  return err;
}

/** Host + lobby with open settings. Returns {host, code}. */
export async function openLobby(arena, o = {}) {
  const host = arena.client('host');
  await host.signUp(o.cls || 'class1', o.nick || 'host');
  const code = await host.createMatch(o.match || {});
  return { host, code };
}
export async function signedKid(arena, nick, cls = 'class1') { const c = arena.client(nick); await c.signUp(cls, nick); return c; }
export async function guest(arena, nick = 'Bold Boron') { const c = arena.client('guest-' + nick); await c.signInGuest(nick); return c; }

/** Move the backend clock so that `now` is `frac` of the way into question q's 15 s window (scaled). Needs startAt set. */
export function toQuestion(arena, code, q, frac = 0.1) {
  const m = arena.backend.adminGet('matches/' + code), ts = arena.backend.timeScale;
  const target = m.startAt.__ts + (5000 + q * 17500 + frac * 15000) * ts;
  arena.backend.advanceClock(target - arena.backend.now());
}
