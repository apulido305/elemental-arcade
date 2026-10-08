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
