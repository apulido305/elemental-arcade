// UI + scripting helpers for VS Arena browser tests.
import { expect } from '@playwright/test';

export const TS = 0.12;   // VS_TIME_SCALE for e2e: a full match takes ~22 s

/** Open VS Arena from the home screen. */
export async function openVs(dev) {
  if (await dev.page.locator('#vs').isVisible()) return;
  await dev.page.locator('[data-vs="vs-open"]').click();
  await expect(dev.page.locator('#vs')).toBeVisible();
}

/** Signed-in student hosts an arena from the menu and lands in the lobby. Returns the 6-char code. */
export async function hostArena(dev, o = {}) {
  const p = dev.page;
  await openVs(dev);
  if (o.deck) await p.selectOption('[data-vs="deck"]', o.deck);
  if (o.room) await p.selectOption('[data-vs="room"]', o.room);
  if (o.cap != null) await p.fill('[data-vs="cap"]', String(o.cap));
  if (o.listed != null) await p.setChecked('[data-vs="listed"]', o.listed);
  if (o.allowGuests != null) await p.setChecked('[data-vs="allow-guests"]', o.allowGuests);
  await p.locator('[data-vs="host"]').click();
  await expect(p.locator('[data-vs="code"]')).toHaveText(/^[A-Z2-9]{6}$/);
  return (await p.locator('[data-vs="code"]').innerText()).trim();
}

export async function joinByCode(dev, code, { open = true } = {}) {
  const p = dev.page;
  if (open) await openVs(dev);
  await p.fill('[data-vs="join-code-input"]', code);
  await p.locator('[data-vs="join-submit"]').click();
}
export async function joinByCodeOk(dev, code) {
  await joinByCode(dev, code);
  await expect(dev.page.locator('[data-vs="code"]')).toHaveText(code);
}
export async function joinFromLobby(dev, code) {
  await openVs(dev);
  await dev.page.locator(`[data-vs="lobby-join"][data-code="${code}"]`).click();
  await expect(dev.page.locator('[data-vs="code"]')).toHaveText(code);
}
export async function startMatch(host, players = 2) {
  const btn = host.page.locator('[data-vs="start"]');
  await expect(btn).toBeEnabled();
  await btn.click();
}
export const errorText = dev => dev.page.locator('[data-vs="error"]:not([hidden])');

/** The ten correct option indexes for a match (computed in the page with the same buildRound the app uses). */
export async function correctIndexes(dev, arena, code) {
  const m = arena.backend.adminGet('matches/' + code);
  return dev.page.evaluate(([d, r, s]) => window.Arcade.buildRound(d, r, s).map(q => q.correct), [m.deck, m.room, m.seed]);
}
export async function promptsOf(dev, arena, code) {
  const m = arena.backend.adminGet('matches/' + code);
  return dev.page.evaluate(([d, r, s]) => window.Arcade.buildRound(d, r, s).map(q => q.prompt), [m.deck, m.room, m.seed]);
}

/**
 * Drive one browser player through the match. plan(q) -> {delay: ms real, pick: 'correct'|'wrong'|'none'|0..3} (default: correct, fast).
 * Resolves with the prompts the player saw (index = question) when the result screen appears.
 */
export async function playMatch(dev, correct, plan = () => ({}), { stopAfter = 9 } = {}) {
  const p = dev.page, seen = [];
  let last = -1;
  for (;;) {
    const h = await p.waitForFunction(last => {
      if (document.querySelector('[data-vs="podium"]') || document.querySelector('[data-vs="gone-msg"]')) return 'done';
      const e = document.querySelector('#vs-qno'), o = document.querySelector('[data-vs="opt"]:not([disabled])');
      if (!e || !o) return null;
      const n = +/Question (\d+)/.exec(e.textContent)[1] - 1;
      return n > last ? n + 1 : null;   // +1: 0 would read as "not ready"
    }, last, { timeout: 90000, polling: 25 });
    const v = await h.jsonValue();
    if (v === 'done') break;
    const n = v - 1;
    last = n;
    seen[n] = (await p.locator('[data-vs="question"]').innerText()).trim();
    const c = plan(n) || {};
    if (c.delay) await p.waitForTimeout(c.delay);
    const pick = c.pick ?? 'correct';
    if (pick !== 'none') {
      const idx = pick === 'correct' ? correct[n] : pick === 'wrong' ? (correct[n] + 1) % 4 : pick;
      await p.locator(`[data-vs="opt"][data-i="${idx}"]`).click({ timeout: 3000 }).catch(() => {});
    }
    if (n >= stopAfter) { /* keep looping until podium */ }
  }
  return seen;
}

/**
 * Scripted (browserless) players answering in real time against the match clock.
 * players: [{client, plan(q) -> {frac: 0..1 of the question window, correct: bool} | null}]. Returns {done, errors}.
 */
export function scriptedPlay(arena, code, players, { questions = 10 } = {}) {
  const ts = arena.backend.timeScale, m = arena.backend.adminGet('matches/' + code), start = m.startAt.__ts;
  const errors = [], timers = [];
  const done = Promise.all(players.flatMap(({ client, plan }) => Array.from({ length: questions }, (_, q) => {
    const c = plan(q); if (!c) return Promise.resolve();
    const at = start + (5000 + q * 17500 + c.frac * 15000) * ts;
    return new Promise(res => timers.push(setTimeout(async () => {
      try { await client.answer(code, q, { choice: c.correct ? 0 : 1, correct: c.correct, elapsedMs: Math.round(c.frac * 15000 * ts), points: c.correct ? 100 + Math.round(50 * (1 - c.frac)) : 0 }); }
      catch (e) { errors.push(`${client.name} q${q}: ${e.code || e.message}`); }
      res();
    }, Math.max(0, at - Date.now()))));
  })));
  return { done, errors, cancel: () => timers.forEach(clearTimeout) };
}

/** Scripted signed-in classmates seated in an open lobby. */
export async function seatKids(arena, code, names, { cls = 'class1', guests = 0 } = {}) {
  const out = [];
  for (const n of names) { const c = arena.client(n); await c.signUp(cls, n); await c.join(code); out.push(c); }
  const GN = ['Swift Neon', 'Calm Cobalt', 'Brave Argon', 'Keen Zinc', 'Jolly Iron', 'Sunny Radon'];
  for (let i = 0; i < guests; i++) { const g = arena.client('guest' + i); await g.signInGuest(GN[i]); await g.join(code); out.push(g); }
  return out;
}
