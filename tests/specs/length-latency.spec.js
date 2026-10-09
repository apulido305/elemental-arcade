// Round length (10 / 15 / 20 questions, solo and VS) and slow connections in VS: late answer writes still count,
// a player who skips questions is not marked abandoned, and the podium comes from a final server read.
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { TS, hostArena, joinByCodeOk, startMatch, correctIndexes, playMatch, scriptedPlay, seatKids } from '../helpers/vs.js';
import { layoutProblems } from '../helpers/layout.js';

const answersOf = (arena, code) => arena.backend.adminList(`matches/${code}/answers`);
const seatsOf = (arena, code) => Object.fromEntries(arena.backend.adminList(`matches/${code}/players`).map(p => [p.id, p]));
const sumFor = (answers, uid) => answers.filter(a => a.id.startsWith(uid + '_')).reduce((s, a) => s + a.points, 0);
const fieldScore = async (dev, nick) => {
  const row = (await dev.page.locator('[data-vs="field"] tbody tr').allInnerTexts()).find(r => r.toLowerCase().includes(nick));
  return +row.trim().split(/\s+/).slice(-2)[0];
};

test.describe('solo round length', () => {
  test('picker: 10 by default, 15 and 20 make longer rounds, the choice survives a reload, fits at 390 px', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE, firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const btn = n => p.locator(`[data-act="qn"][data-id="${n}"]`);
    await expect(btn(10)).toHaveAttribute('aria-pressed', 'true');
    await expect(btn(15)).toHaveAttribute('aria-pressed', 'false');
    expect(await layoutProblems(p)).toEqual([]);                       // the three buttons are 44 px targets, no sideways scroll
    await btn(15).click();
    await expect(btn(15)).toHaveAttribute('aria-pressed', 'true');
    await p.locator('[data-act="play"]').click();                       // Mixed Pack on the 20-card starter deck
    await expect(p.locator('.qmeta')).toContainText('1 of 15');
    await p.reload(); await p.waitForSelector('[data-act="deck"]');
    await expect(btn(15)).toHaveAttribute('aria-pressed', 'true');
    await btn(20).click();
    await p.locator('[data-act="play"]').click();
    await expect(p.locator('.qmeta')).toContainText('1 of 20');
    expect(await layoutProblems(p)).toEqual([]);                       // 20 progress pips still fit the HUD
    // a room with fewer cards than the setting plays each card once (never more than the pool, at least 5)
    const n = await p.evaluate(() => { const r = Arcade.ROOMS.find(x => x.id === 'mixed'); return Arcade.roomPool(r, 'r4').length; });
    await p.getByRole('button', { name: 'Quit' }).click();
    await p.locator('[data-act="deck"][data-id="r4"]').click();
    await p.locator('[data-act="play"]').click();
    await expect(p.locator('.qmeta')).toContainText('1 of ' + Math.min(20, Math.max(5, n)));
  });

  test('buildRound: 10 is the default; 15 and 20 give that many questions, deterministic, without Math.random', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const out = await p.evaluate(() => {
      const orig = Math.random; Math.random = () => { throw new Error('no Math.random in buildRound'); };
      try {
        const rows = [];
        for (const d of ['s20', 'r4', 'e118', 'cat']) for (const r of ['mixed', 'symbol', 'ion']) for (const s of [1, 2, 3, 99]) {
          const def = JSON.stringify(buildRound(d, r, s)), ten = JSON.stringify(buildRound(d, r, s, 10)), bad = JSON.stringify(buildRound(d, r, s, 12));
          const n15 = buildRound(d, r, s, 15), n20 = buildRound(d, r, s, 20);
          rows.push({ d, r, s, def10: def === ten, badIs10: bad === ten, len10: JSON.parse(ten).length, len15: n15.length, len20: n20.length,
            same20: JSON.stringify(n20) === JSON.stringify(buildRound(d, r, s, 20)), pool: roomPool(roomOf(r), d).length });
        }
        return rows;
      } finally { Math.random = orig; }
    });
    for (const x of out) {
      const where = `${x.d}/${x.r}/${x.s}`;
      expect(x.def10, where).toBe(true); expect(x.badIs10, where).toBe(true); expect(x.same20, where).toBe(true);
      if (x.pool) { expect(x.len10, where).toBe(10); expect(x.len15, where).toBe(15); expect(x.len20, where).toBe(20); }
    }
  });
});

test.describe('VS round length', () => {
  test('host picks 15 questions: lobby shows it, every phone plays 15, scores and podium cover all 15', async ({ arena }) => {
    test.setTimeout(150000);
    const host = await arena.device({ width: DESKTOP, timeScale: TS }), kid = await arena.device({ width: PHONE, timeScale: TS });
    for (const d of [host, kid]) await d.goto('/');
    await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo');
    const code = await hostArena(host, { deck: 's20', room: 'mixed', qn: 15 });
    expect(arena.backend.adminGet('matches/' + code).qn).toBe(15);
    await joinByCodeOk(kid, code);
    await expect(kid.page.locator('#vs-qlen')).toHaveText('15 questions');
    await startMatch(host);
    const correct = await correctIndexes(host, arena, code);
    expect(correct.length).toBe(15);
    const [sh, sk] = await Promise.all([
      playMatch(host, correct, () => ({ delay: 30 })),
      playMatch(kid, correct, q => ({ delay: 200, pick: q % 3 ? 'correct' : 'wrong' }))
    ]);
    expect(sh.length).toBe(15); expect(sk.filter(Boolean).length).toBeGreaterThanOrEqual(13);
    for (const d of [host, kid]) await expect(d.page.locator('[data-vs="podium"]')).toBeVisible();
    const seats = seatsOf(arena, code), answers = answersOf(arena, code);
    const uh = await host.page.evaluate(() => Cloud.uid());
    expect(seats[uh]).toMatchObject({ answeredQ: 14, correct: 15 });
    expect(seats[uh].score).toBe(sumFor(answers, uh));
    await expect(host.page.locator('[data-vs="podium"] .p1')).toContainText('hosty');
    await expect(host.page.getByText('/15 right')).toBeVisible();
    await expect(host.page.locator('[data-vs="breakdown"] tbody tr')).toHaveCount(15);
    expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
  });
});

test.describe('VS slow connections', () => {
  test("a phone whose answer writes take 1.7 s still scores every answer, the last one included, and the podium shows it", async ({ arena }) => {
    test.setTimeout(150000);
    const ts = 0.2;   // 3 s questions: room for a write that lands after the question closes but inside the late window
    const host = await arena.device({ width: DESKTOP, timeScale: ts }), kid = await arena.device({ width: PHONE, timeScale: ts });
    // The kid's network: every answer write is held 1.7 s before it reaches the server. Everything else is normal.
    await kid.context.route('**/__fb/rpc', async route => {
      const b = route.request().postDataJSON();
      if (b && b.op === 'fs.commit' && (b.args.writes || []).some(w => w.path.includes('/answers/'))) await new Promise(r => setTimeout(r, 1700));
      await route.continue();
    });
    // note whether the "Checking final scores" panel was shown before the podium
    await kid.page.addInitScript(() => { new MutationObserver(() => { if (document.querySelector('[data-vs="final-check"]')) window.__sawCheck = true; }).observe(document, { childList: true, subtree: true }); });
    for (const d of [host, kid]) await d.goto('/');
    await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'slowpoke');
    const code = await hostArena(host, { deck: 's20', room: 'mixed' });
    await joinByCodeOk(kid, code);
    await startMatch(host);
    const correct = await correctIndexes(host, arena, code);
    // Host: fast and always wrong. Kid: right every time, clicking 2 s into a 3 s question, so each write lands
    // about 0.7 s after the question has closed (the old rules refused anything later than 0.4 s).
    await Promise.all([
      playMatch(host, correct, () => ({ delay: 30, pick: 'wrong' })),
      playMatch(kid, correct, () => ({ delay: 2000, pick: 'correct' }))
    ]);
    for (const d of [host, kid]) await expect(d.page.locator('[data-vs="podium"]')).toBeVisible({ timeout: 20000 });
    const uk = await kid.page.evaluate(() => Cloud.uid());
    const answers = answersOf(arena, code), seats = seatsOf(arena, code);
    expect(answers.filter(a => a.id.startsWith(uk + '_')).length).toBe(10);          // all ten landed, q9 after the match ended
    expect(seats[uk]).toMatchObject({ answeredQ: 9, correct: 10, abandoned: false });
    expect(seats[uk].score).toBe(sumFor(answers, uk));
    expect(arena.backend.adminGet('matches/' + code).status).toBe('done');
    // both screens: the kid wins, and the field shows the server total (the last answer included)
    for (const d of [host, kid]) {
      await expect(d.page.locator('[data-vs="podium"] .p1')).toContainText('slowpoke');
      expect(await fieldScore(d, 'slowpoke')).toBe(seats[uk].score);
    }
    expect(await kid.page.evaluate(() => !!window.__sawCheck)).toBe(true);
    await expect(kid.page.locator('[data-vs="lost-points"]')).toHaveCount(0);
    await expect(kid.page.getByText('10/10 right')).toBeVisible();
    expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
  });

  test('a player who skips every other question (and sends no heartbeat) is not marked abandoned and keeps a podium place', async ({ arena }) => {
    test.setTimeout(120000);
    const host = await arena.device({ width: DESKTOP, timeScale: TS });
    await host.goto('/'); await host.signUp('class1', 'hosty');
    const code = await hostArena(host, { deck: 's20', room: 'mixed' });
    const [skip] = await seatKids(arena, code, ['skipper']);
    await expect(host.page.locator('[data-vs="lobby-players"] li')).toHaveCount(2);
    await startMatch(host);
    const correct = await correctIndexes(host, arena, code);
    const run = scriptedPlay(arena, code, [{ client: skip, plan: q => q % 2 ? { frac: 0.3, correct: true } : null }]);
    await Promise.all([playMatch(host, correct, q => ({ delay: 30, pick: q < 3 ? 'correct' : 'wrong' })), run.done]);
    expect(run.errors).toEqual([]);
    await expect(host.page.locator('[data-vs="podium"]')).toBeVisible();
    const seat = seatsOf(arena, code)[skip.uid];
    expect(seat).toMatchObject({ abandoned: false, answeredQ: 9, correct: 5 });
    const row = host.page.locator(`[data-vs="field"] tr[data-uid="${skip.uid}"]`);
    await expect(row).not.toContainText('Left');
    await expect(host.page.locator('[data-vs="podium"] .p1')).toContainText('skipper');   // 5 right beats the host's 3
    expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
  });
});

test('screenshots: round-length picker (home), VS host menu and lobby', async ({ arena }) => {
  const dir = '../docs/length-latency/';
  for (const w of [PHONE, DESKTOP]) {
    const dev = await arena.device({ width: w, timeScale: TS }), p = dev.page;
    await dev.goto('/');
    await dev.signUp('class1', 'hosty' + w);
    await p.locator('[data-act="qn"][data-id="15"]').click();
    await p.locator('[data-ui="play-now"]').screenshot({ path: dir + `home-picker-${w}.png` });
    expect(await layoutProblems(p)).toEqual([]);
    await p.locator('[data-vs="vs-open"]').click();
    await p.selectOption('[data-vs="qn"]', '20');
    await p.screenshot({ path: dir + `vs-host-menu-${w}.png` });
    expect(await layoutProblems(p)).toEqual([]);
    await p.locator('[data-vs="host"]').click();
    await expect(p.locator('#vs-qlen')).toHaveText('20 questions');
    await p.screenshot({ path: dir + `vs-lobby-${w}.png` });
    expect(await layoutProblems(p)).toEqual([]);
  }
});
