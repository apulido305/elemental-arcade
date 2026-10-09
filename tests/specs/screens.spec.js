// Screenshots for the PR (docs/vs-arena/<name>-<390|1100>.png) plus layout checks at both widths:
// no horizontal scroll, tap targets >= 44 px, no clipped headings.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { hostArena, joinByCode, openVs, startMatch, correctIndexes, playMatch, scriptedPlay, seatKids } from '../helpers/vs.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'vs-arena');
const NAMES = ['maya', 'jordan', 'priya', 'devon', 'sam', 'lena', 'omar', 'zoe', 'caleb', 'tessa'];

/** Problems a teacher would notice on a phone: sideways scroll, tiny tap targets, text spilling out of its box. */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [], vs = document.getElementById('vs');
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
    if (vs && !vs.hidden && vs.scrollWidth > vs.clientWidth + 1) out.push('overlay scrolls sideways: ' + vs.scrollWidth + ' > ' + vs.clientWidth);
    const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    if (vs && !vs.hidden) {
      vs.querySelectorAll('button, select, input:not([type=checkbox]):not([type=hidden]), label.vs-chk, a[href]').forEach(e => {
        if (!vis(e) || e.disabled && false) return;
        const r = e.getBoundingClientRect();
        if (r.height < 43.5) out.push('tap target ' + Math.round(r.height) + 'px: ' + (e.dataset.vs || e.className || e.tagName) + ' "' + (e.textContent || '').trim().slice(0, 20) + '"');
      });
      vs.querySelectorAll('h1, h2, h3, .vs-plate, .vs-pod .nm, .vs-lobbyrow b, .vs-bigcode, .vs-rankchip, .vs-lrow .nm').forEach(e => {
        if (!vis(e)) return;
        const cs = getComputedStyle(e);
        // ellipsis on ladder names is intended; anything else that overflows its box is clipped text
        if (cs.textOverflow === 'ellipsis') return;
        if (e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible') out.push('clipped text: ' + e.textContent.trim().slice(0, 30));
        const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.push('off screen: ' + e.textContent.trim().slice(0, 30));
      });
    }
    return out;
  });
}
const shot = async (page, name, w, opts = {}) => {
  const file = path.join(OUT, `${name}-${w}.png`);
  await page.screenshot({ path: file, ...opts });
  return file;
};
/** Capture the whole scrolling overlay (it is position:fixed with its own scroll) by growing the viewport to its content height. */
async function shotTall(dev, name, w) {
  const h = await dev.page.evaluate(() => Math.ceil(document.querySelector('#vs .vs-wrap').getBoundingClientRect().height) + 8);
  const vp = dev.page.viewportSize();
  await dev.page.setViewportSize({ width: vp.width, height: Math.max(vp.height, Math.min(h, 2600)) });
  await dev.page.waitForTimeout(150);
  const file = await shot(dev.page, name, w);
  await dev.page.setViewportSize(vp);
  return file;
}

for (const w of [PHONE, DESKTOP]) {
  test.describe(`screenshots ${w}px`, () => {
    test(`class lobby and join-by-code with a generated guest name (${w})`, async ({ arena }) => {
      test.setTimeout(90000);
      const mate = await arena.device({ width: w, fonts: true }), guest = await arena.device({ width: w, fonts: true });
      await mate.goto('/'); await guest.goto('/');
      await mate.signUp('period3', 'jordan');
      // three open arenas from the same class, with a few players already in each
      const hostA = arena.client('ha'); await hostA.signUp('period3', 'mrpulido'); const a = await hostA.createMatch({ deck: 's20', room: 'mixed', cap: 20 });
      const hostB = arena.client('hb'); await hostB.signUp('period3', 'maya'); const b = await hostB.createMatch({ deck: 'r4', room: 'symbol', cap: 8 });
      const hostC = arena.client('hc'); await hostC.signUp('period3', 'devon'); await hostC.createMatch({ deck: 'e118', room: 'config', cap: 12 });
      await seatKids(arena, a, ['priya', 'sam', 'lena', 'omar']); await seatKids(arena, b, ['zoe']);
      await openVs(mate);
      await expect(mate.page.locator('[data-vs="lobby-join"]')).toHaveCount(3);
      await shot(mate.page, 'class-lobby', w);
      expect(await layoutProblems(mate.page)).toEqual([]);

      await openVs(guest);
      await guest.page.fill('[data-vs="join-code-input"]', a);
      await expect(guest.page.locator('[data-vs="guest-name"]')).toHaveText(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      await shot(guest.page, 'join-by-code', w);
      expect(await layoutProblems(guest.page)).toEqual([]);
      await guest.page.locator('[data-vs="join-submit"]').click();
      await expect(guest.page.locator('[data-vs="code"]')).toHaveText(a);
      expect(await layoutProblems(guest.page)).toEqual([]);
      await shot(guest.page, 'lobby-waiting', w);
      expect(mate.errors).toEqual([]); expect(guest.errors).toEqual([]);
    });

    test(`2-player VS splash (${w})`, async ({ arena }) => {
      test.setTimeout(90000);
      const host = await arena.device({ width: w, timeScale: 1, fonts: true });
      await host.goto('/'); await host.signUp('period3', 'maya');
      const code = await hostArena(host);
      await seatKids(arena, code, ['jordan']);
      await startMatch(host);
      const splash = host.page.locator('[data-vs="splash"]');
      await expect(splash).toHaveAttribute('data-mode', 'duel');
      await host.page.waitForTimeout(1450);                                 // plates in, VS slammed
      await shot(host.page, 'splash-duel', w);
      expect(await layoutProblems(host.page)).toEqual([]);
      await expect(host.page.locator('[data-vs="countdown"]')).toHaveText(/^[123]$/, { timeout: 5000 });
      await host.page.waitForTimeout(150);
      await shot(host.page, 'countdown', w);
    });

    test(`arena splash with 10 players (${w})`, async ({ arena }) => {
      test.setTimeout(90000);
      const host = await arena.device({ width: w, timeScale: 1, fonts: true });
      await host.goto('/'); await host.signUp('period3', 'mrpulido');
      const code = await hostArena(host);
      await seatKids(arena, code, NAMES.slice(0, 7), { guests: 2 });
      await expect(host.page.locator('[data-vs="lobby-players"] li')).toHaveCount(10);
      await shotTall(host, 'lobby-full', w);
      await startMatch(host);
      await expect(host.page.locator('[data-vs="splash"]')).toHaveAttribute('data-mode', 'arena');
      await host.page.waitForTimeout(1500);                                  // nameplates dealt, ARENA slammed
      await shot(host.page, 'splash-arena', w);
      await expect(host.page.locator('[data-vs="splash"]')).toContainText('+ 2 more');
      expect(await layoutProblems(host.page)).toEqual([]);
    });

    test(`mid-match ladder with 10 players and the podium (${w})`, async ({ arena }) => {
      test.setTimeout(240000);
      const ts = 0.3;
      const me = await arena.device({ width: w, timeScale: ts, fonts: true });
      await me.goto('/'); await me.signUp('period3', 'mrpulido');
      const code = await hostArena(me);
      const kids = await seatKids(arena, code, NAMES.slice(0, 7), { guests: 2 });
      await startMatch(me);
      const correct = await correctIndexes(me, arena, code);
      // scripted players answer with varied skill and speed so the ladder has a real spread and reshuffles
      const skill = [0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
      const play = scriptedPlay(arena, code, kids.map((client, i) => ({ client, plan: q => ({ frac: 0.08 + ((i * 7 + q * 3) % 10) / 14, correct: ((i * 5 + q * 7) % 10) / 10 < skill[i] }) })));
      const mine = playMatch(me, correct, q => ({ delay: 600 * ts, pick: q % 3 === 2 ? 'wrong' : 'correct' }));
      // a question in the middle of the match, ladder populated
      await me.page.waitForFunction(() => /Question 6 /.test(document.querySelector('#vs-qno')?.textContent || '') && document.querySelectorAll('[data-vs="ladder-row"]').length >= 5, null, { polling: 50, timeout: 120000 });
      if (w === PHONE) { await me.page.locator('[data-vs="ladder-toggle"]').click(); }
      await expect(me.page.locator('[data-vs="ladder-row"]')).toHaveCount(10);
      await me.page.waitForTimeout(250);
      await shotTall(me, 'ladder-mid-match', w);
      const probs = await layoutProblems(me.page);
      expect(probs).toEqual([]);
      await mine; await play.done;
      await expect(me.page.locator('[data-vs="podium"]')).toBeVisible();
      await me.page.waitForTimeout(1200);                                    // podium rise animation done
      await shotTall(me, 'podium', w);
      expect(await layoutProblems(me.page)).toEqual([]);
      expect(play.errors).toEqual([]);
      expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
      expect(me.errors).toEqual([]);
    });
  });
}
