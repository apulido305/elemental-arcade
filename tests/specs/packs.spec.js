// Packs: earning (VS win, first Gold Legend), the odds table and roller, no duplicates, opening (swipe, click,
// button, reduced motion), guests on the device only, the cloud merge, rules for unlocks and icons, screenshots.
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { TS, hostArena, joinByCodeOk, startMatch, correctIndexes, playMatch } from '../helpers/vs.js';
import { expectDenied, signedKid, openLobby, guest } from '../helpers/arena.js';
import { layoutProblems } from '../helpers/layout.js';

const KEY = 'elemental-arcade-v1';
const SHOTS = '../docs/packs/';
const packs = p => p.evaluate(() => Arcade.S.packs.map(x => x.id));
// Answer the current solo question correctly (or wrongly) through the real buttons.
async function answerQ(p, right = true) {
  const i = await p.evaluate(r => { const q = Arcade.V.qs[Arcade.V.qi]; const k = q.opts.findIndex(o => o.ok); return r ? k : (k + 1) % q.opts.length; }, right);
  await p.locator(`[data-act="answer"][data-i="${i}"]`).click();
}
const curCard = p => p.evaluate(() => Arcade.V.qs[Arcade.V.qi].item.id);
// A fixed pack (finish, rare icon, gold) so screenshots and flips are the same every run.
const demoPack = p => p.evaluate(() => { const A = Arcade; A.ALL.slice(0, 6).forEach(it => { A.S.owned[it.id] = 3; });
  A.S.packs.push({ id: 'gold:demo', at: Date.now(), reason: 'gold', cardId: A.ALL[0].id, seed: 1, week: 1,
    slots: [{ kind: 'finish', card: A.ALL[1].id, finish: 'ember', src: 'finish' }, { kind: 'icon', icon: 'axolotl', src: 'b2' }, { kind: 'gold', icon: 'cat-gold', src: 'gold' }] });
  A.S.packLog.push('gold:demo'); A.save(); A.render(); });

test.describe('odds and the roller', () => {
  test('each slot sums to 100; the roller is deterministic per seed; a big simulation matches the table', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const r = await p.evaluate(() => {
      const A = Arcade, fresh = () => ({ icons: new Set(), fin: new Set(), cards: ['x1', 'x2', 'x3'] });
      const sums = A.PACK_ODDS.map(t => Math.round(t.reduce((s, x) => s + x[1], 0) * 1000) / 1000);
      const same = JSON.stringify(A.rollPack(42, 7, fresh())) === JSON.stringify(A.rollPack(42, 7, fresh()));
      const differ = JSON.stringify(A.rollPack(42, 7, fresh())) !== JSON.stringify(A.rollPack(43, 7, fresh()));
      const sim = n => { const c = [{}, {}, {}]; for (let s = 1; s <= n; s++) A.rollPack(s * 2654435761 >>> 0, 7, fresh()).forEach((x, i) => { c[i][x.src] = (c[i][x.src] || 0) + 1; }); return c.map(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / n * 100]))); };
      return { sums, same, differ, odds: A.PACK_ODDS, s10k: sim(10000), s250k: sim(250000) };
    });
    expect(r.sums).toEqual([100, 100, 100]);
    expect(r.same).toBe(true); expect(r.differ).toBe(true);
    // 10,000 draws: sampling noise alone is about +-1 point (2 sigma) on a 62/38 split, so this checks within 1.0.
    // 250,000 draws: noise is about +-0.2, so this is the 0.2-point check.
    for (const [sim, tol] of [[r.s10k, 1.0], [r.s250k, 0.2]]) r.odds.forEach((tab, i) => tab.forEach(([src, w]) => {
      expect(Math.abs((sim[i][src] || 0) - w), `slot ${i + 1} ${src}: ${(sim[i][src] || 0).toFixed(3)} vs ${w}`).toBeLessThanOrEqual(tol);
    }));
  });

  test('never a duplicate: owned icons fall through (band down, then XP), and nothing repeats inside a pack', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const r = await p.evaluate(() => {
      const A = Arcade, commons = A.WIN_ICONS.filter(i => i.band === 0).map(i => i.id), all = A.WIN_ICONS.map(i => i.id).concat(A.GOLD_IDS);
      let dup = 0, ownedPull = 0, commonPulls = 0, nonXpWhenAllOwned = 0;
      for (let s = 1; s <= 4000; s++) {
        const have = { icons: new Set(commons), fin: new Set(), cards: ['x'] }, slots = A.rollPack(s, 3, have);
        const icons = slots.filter(x => x.icon).map(x => x.icon);
        if (new Set(icons).size !== icons.length) dup++;
        if (icons.some(i => commons.includes(i))) ownedPull++;
        if (slots[1].src === 'b0') { commonPulls++; if (slots[1].kind !== 'xp') ownedPull += 0; }
        const full = A.rollPack(s, 3, { icons: new Set(all), fin: new Set(['x|foil', 'x|holo', 'x|night', 'x|ember']), cards: ['x'] });
        if (full.some(x => x.kind !== 'xp')) nonXpWhenAllOwned++;
      }
      return { dup, ownedPull, commonPulls, nonXpWhenAllOwned };
    });
    expect(r.dup).toBe(0); expect(r.ownedPull).toBe(0); expect(r.commonPulls).toBeGreaterThan(2000);
    expect(r.nonXpWhenAllOwned).toBe(0);   // owns everything: every slot pays XP
  });

  test('gold icons render from the existing rare art (no new icon image per gold id), and every winnable icon has art', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const srcs = await p.evaluate(() => Arcade.GOLD_IDS.concat(Arcade.WIN_ICONS.map(i => i.id)).map(id => { const d = document.createElement('div'); d.innerHTML = Arcade.iconSVG(id, 64); return [id, d.querySelector('img').getAttribute('src')]; }));
    expect(srcs.length).toBe(84);
    for (const [id, src] of srcs) {
      if (id.endsWith('-gold')) expect(src).toBe('img/icons/gold/' + id.slice(0, -5) + '.webp');   // the base icon's rare art
      const r = await p.request.get(arena.origin + '/' + src);
      expect(r.status(), src).toBe(200);
    }
  });
});

test.describe('earning', () => {
  test('crossing 15 on a card queues one pack; going to 16 does not; a normal tier-up and solo play do not', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    await p.evaluate(() => { Arcade.deckItems('s20').forEach(it => { Arcade.S.owned[it.id] = 2; }); Arcade.save(); Arcade.render(); });
    await p.locator('[data-act="play"]').click();
    await answerQ(p);                                                                  // 2 -> 3 is Holo: no pack
    expect(await packs(p)).toEqual([]);
    await p.evaluate(() => { Arcade.deckItems('s20').forEach(it => { Arcade.S.owned[it.id] = 14; }); });
    await p.locator('[data-act="next"]').click();
    const id = await curCard(p);
    await answerQ(p);                                                                  // 14 -> 15: Gold Legend
    expect(await packs(p)).toEqual(['gold:' + id]);
    await expect(p.locator('#toast')).toContainText('Pack earned');
    await p.evaluate(() => { Arcade.deckItems('s20').forEach(it => { Arcade.S.owned[it.id] = Math.max(Arcade.S.owned[it.id], 15); }); });
    await p.locator('[data-act="next"]').click();
    await answerQ(p);                                                                  // 15 -> 16: nothing
    expect(await packs(p)).toEqual(['gold:' + id]);
    expect(await p.evaluate(c => Arcade.earnPack('gold', c), id)).toBe(false);         // that card never pays again
    await p.evaluate(() => { Arcade.S.packs = []; Arcade.render(); });                 // even after the pack is gone
    expect(await p.evaluate(c => Arcade.earnPack('gold', c), id)).toBe(false);
    await expect(p.locator('[data-ui="pack-badge"]')).toHaveCount(0);
  });

  test('a VS win queues one pack per match (not twice), the loser gets none, and the result says so', async ({ arena }) => {
    test.setTimeout(120000);
    const host = await arena.device({ width: DESKTOP, timeScale: TS }), kid = await arena.device({ width: PHONE, timeScale: TS });
    for (const d of [host, kid]) await d.goto('/');
    await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo');
    const code = await hostArena(host, { deck: 's20', room: 'mixed' });
    await joinByCodeOk(kid, code); await startMatch(host);
    const correct = await correctIndexes(host, arena, code);
    await Promise.all([playMatch(host, correct, () => ({ delay: 30 })), playMatch(kid, correct, () => ({ delay: 60, pick: 'wrong' }))]);
    for (const d of [host, kid]) await expect(d.page.locator('[data-vs="podium"]')).toBeVisible();
    const today = await host.page.evaluate(() => 'day:' + Arcade.dayKey());
    expect(await packs(host.page)).toEqual(['vs:' + code, today]);                     // the win, plus the first match of the day
    expect(await packs(kid.page)).toEqual([today]);                                    // the loser: no win pack, but the daily one
    await expect(kid.page.locator('[data-vs="daily-earned"]')).toBeVisible();
    await expect(host.page.locator('[data-vs="pack-earned"]')).toBeVisible();
    await expect(kid.page.locator('[data-vs="pack-earned"]')).toHaveCount(0);
    expect(await host.page.evaluate(c => Arcade.earnPack('vs', c), code)).toBe(false);   // the same match cannot pay twice
    expect(await packs(host.page)).toEqual(['vs:' + code, today]);
    // the pack reached the account (cloud save), and the rules accepted it
    const uid = await host.page.evaluate(() => Cloud.uid());
    await expect.poll(() => (arena.backend.adminGet('players/' + uid).progress.packs || []).map(x => x.id), { timeout: 8000 }).toEqual(['vs:' + code, today]);
    expect(arena.backend.denials.filter(d => d.op !== 'get' && d.op !== 'list'), JSON.stringify(arena.backend.denials.slice(0, 2))).toEqual([]);
  });
});

test.describe('opening', () => {
  test('a guest opens with reduced motion (no tear), keeps the unlock in localStorage, and never writes /players', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE, reducedMotion: true }), p = dev.page;
    await dev.goto('/');
    await demoPack(p);
    await expect(p.locator('[data-ui="pack-badge"]')).toHaveText('1');
    await p.locator('[data-act="binder"]').click();
    await p.locator('[data-act="pack-open"]').click();
    await expect(p.locator('[data-pk="tear"]')).toHaveText('Open');
    await expect(p.locator('.pkhint')).toHaveCount(0);                                // no swipe instructions
    await p.locator('[data-pk="tear"]').click();
    await expect(p.locator('.pkcard.up')).toHaveCount(3);                             // all three face up at once
    await p.locator('[data-pk="done"]').click();
    const s = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
    expect(s.unlocked).toEqual(['axolotl', 'cat-gold']);
    expect(s.packs).toEqual([]); expect(s.packLog).toContain('open:gold:demo');
    expect(s.finishes[await p.evaluate(() => Arcade.ALL[1].id)]).toEqual(['ember']);
    await p.reload(); await p.waitForSelector('[data-act="deck"]');
    await p.locator('[data-act="icons"]').click();
    await expect(p.locator('[data-act="icon-pick"][data-id="cat-gold"]')).toBeVisible();
    await expect(p.locator('[data-act="icon-pick"][data-id="dragon"]')).toHaveCount(0);   // still locked
    await p.locator('[data-act="icon-pick"][data-id="cat-gold"]').click(); await p.locator('[data-act="icon-use"]').click();
    await expect(p.locator('[data-act="icons"] .av')).toHaveAttribute('data-icon', 'cat-gold');
    expect(arena.backend.adminList('players')).toEqual([]);
    expect(arena.backend.denials).toEqual([]);
    // a locked id is refused even if it lands in storage by hand
    await p.evaluate(k => { const g = JSON.parse(localStorage.getItem(k)); g.icon = 'dragon-gold'; localStorage.setItem(k, JSON.stringify(g)); }, KEY);
    await p.reload(); await p.waitForSelector('[data-act="deck"]');
    await expect(p.locator('[data-act="icons"] .av')).toHaveAttribute('data-icon', 'atom');
  });

  test('phone: a swipe across the top tears it; then each card flips; finish shows on the card and can be swapped', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE, firebase: 'blocked' }), p = dev.page;
    await dev.goto('/'); await demoPack(p);
    await p.locator('[data-act="binder"]').click(); await p.waitForTimeout(400);
    await p.screenshot({ path: SHOTS + 'binder-badge-390.png' });
    await p.locator('[data-act="pack-open"]').click(); await p.waitForTimeout(350);
    await p.screenshot({ path: SHOTS + 'pack-390.png' });
    expect(await layoutProblems(p)).toEqual([]);
    const box = await p.locator('[data-pk="pack"]').boundingBox();
    await p.mouse.move(box.x + 12, box.y + 14); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + 12 + i * box.width * .09, box.y + 16);
    await p.mouse.up();
    await expect(p.locator('[data-ui="pack-cards"]')).toBeVisible();
    await expect(p.locator('[data-pk="done"]')).toBeHidden();
    for (const i of [0, 1, 2]) { await p.locator(`[data-pk="flip"][data-i="${i}"]`).click(); if (i < 2) await expect(p.locator('[data-pk="done"]')).toBeHidden(); }
    await p.waitForTimeout(900);
    await p.screenshot({ path: SHOTS + 'flips-390.png' });
    expect(await layoutProblems(p)).toEqual([]);
    await p.locator('[data-pk="done"]').click();
    const card = await p.evaluate(() => Arcade.ALL[1].id);
    await expect(p.locator(`[data-act="open"][data-id="${card}"] .cw`)).toHaveClass(/fin-ember/);
    await p.locator(`[data-act="open"][data-id="${card}"]`).click();
    await p.locator('[data-act="finish"][data-id=""]').click();
    await expect(p.locator('#modal-root .cw')).not.toHaveClass(/fin-ember/);
    await p.locator('[data-act="finish"][data-id="ember"]').click();
    await expect(p.locator('#modal-root .cw')).toHaveClass(/fin-ember/);
  });

  test('computer: clicking the pack tears it (the button is there too); screenshots at 1100', async ({ arena }) => {
    const dev = await arena.device({ width: DESKTOP, firebase: 'blocked' }), p = dev.page;
    await dev.goto('/'); await demoPack(p);
    await p.locator('[data-act="binder"]').click(); await p.waitForTimeout(400);
    await p.screenshot({ path: SHOTS + 'binder-badge-1100.png' });
    await p.locator('[data-act="pack-open"]').click(); await p.waitForTimeout(350);
    await expect(p.locator('[data-pk="tear"]')).toHaveText('Tear open');
    await p.screenshot({ path: SHOTS + 'pack-1100.png' });
    await p.locator('[data-pk="pack"]').click();
    await expect(p.locator('[data-ui="pack-cards"]')).toBeVisible();
    await p.waitForTimeout(700);
    await p.screenshot({ path: SHOTS + 'dealt-1100.png' });
    for (const i of [0, 1, 2]) await p.locator(`[data-pk="flip"][data-i="${i}"]`).click();
    await p.waitForTimeout(900);
    await p.screenshot({ path: SHOTS + 'flips-1100.png' });
    // closing early keeps the pack, with the same three results (stored, not rerolled)
    await p.locator('[data-pk="close"]').click();
    const kept = await p.evaluate(() => Arcade.S.packs.map(x => x.slots.map(s => s.icon || s.finish || s.xp)));
    expect(kept).toEqual([['ember', 'axolotl', 'cat-gold']]);
  });
});

test.describe('signed in: merge and rules', () => {
  test('merge: no duplicate pack, an opened pack does not come back, unlocks and finishes are unions', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    const m = await p.evaluate(() => {
      const A = { id: 'vs:AAAAAA', slots: [] }, B = { id: 'gold:x', slots: [] }, C = { id: 'gold:y', slots: [] };
      const doc = { packs: [A, B], packLog: ['vs:AAAAAA', 'gold:x', 'gold:y', 'open:gold:y'], unlocked: ['cat'], finishes: { h: ['foil'] }, finishOn: { h: 'foil' }, xp: 50 };
      const here = { packs: [A, C], packLog: ['vs:AAAAAA', 'gold:y', 'gold:x', 'open:gold:x'], unlocked: ['dog', 'cat'], finishes: { h: ['night'] }, finishOn: { h: 'night' }, xp: 80 };
      return Cloud._merge.progress(doc, here);
    });
    expect(m.packs.map(x => x.id)).toEqual(['vs:AAAAAA']);                         // B and C were opened on one side
    expect(m.unlocked.sort()).toEqual(['cat', 'dog']);
    expect(m.finishes.h.sort()).toEqual(['foil', 'night']);
    expect(m.finishOn.h).toBe('night');                                            // this device's pick
    expect(m.xp).toBe(80);
    expect(m.packLog).toEqual(expect.arrayContaining(['open:gold:x', 'open:gold:y']));
  });

  test('rules: unlocked must be pack icon ids, finishOn must be a finish; the icon must be free or unlocked (doc and seat)', async ({ arena }) => {
    const kid = await signedKid(arena, 'kid'), F = kid.F, me = kid.ref('players', kid.uid);
    const base = (await F.getDoc(me)).data();
    const put = (prog, icon) => F.setDoc(me, Object.assign({}, base, { progress: Object.assign({}, base.progress, prog), icon: icon || 'atom', updated: F.serverTimestamp() }));
    await expectDenied(put({ unlocked: ['unicorn'] }), 'pack icon ids');
    await expectDenied(put({ unlocked: ['atom'] }), 'pack icon ids');               // free icons are never "unlocked"
    await expectDenied(put({ finishOn: { h: 'sparkly' } }), 'finish ids');
    await expectDenied(put({ unlocked: [] }, 'cat'), 'unlocked in this doc');       // locked
    await expectDenied(put({ unlocked: ['cat'] }, 'cat-gold'), 'unlocked in this doc');   // plain cat does not unlock gold
    await put({ unlocked: ['cat-gold'], finishOn: { h: 'ember' }, finishes: { h: ['ember'] }, packs: [], packLog: ['open:gold:h'] }, 'cat-gold');   // gold without plain: fine
    // seats: an account may use an unlocked icon, not a locked one; a guest may use any pack icon id
    const { host, code } = await openLobby(arena);
    await expectDenied(signedKid(arena, 'kid2').then(k => k.join(code, { check: false, playerExtra: { icon: 'cat-gold' } })), 'unlocked by this account');
    await kid.join(code, { check: false, playerExtra: { icon: 'cat-gold' } });
    const g = await guest(arena); await g.join(code, { check: false, playerExtra: { icon: 'dragon-gold' } });
    await expectDenied(g.F.setDoc(g.ref('players', g.uid), { progress: {}, nick: 'x', cls: 'y', updated: g.F.serverTimestamp() }));   // guests still never write /players
    expect(host.uid).toBeTruthy();
  });
});

test.describe('daily pack', () => {
  // Play a whole solo round on the current screen (every answer right).
  async function playRound(p) {
    await p.locator('[data-act="play"]').click();
    for (;;) {
      await answerQ(p);
      const nx = p.locator('[data-act="next"]');
      await nx.click();
      if (await p.locator('[data-ui="results-bar"]').count()) break;
    }
  }
  test('signed in: a reminder pop-up once a day; the first finished room earns one pack; a second room does not', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE, dailyReminder: true }), p = dev.page;
    await dev.goto('/');
    await dev.signUp('class1', 'daily');
    await expect(p.locator('[data-ui="daily-modal"]')).toBeVisible();
    await expect(p.locator('[data-ui="daily-modal"]')).toContainText('Complete 1 room or VS match to earn it');
    await expect(p.locator('[data-ui="daily-modal"]')).toContainText('Practice every day to win a free pack');
    await p.waitForTimeout(300);
    await p.screenshot({ path: SHOTS + 'daily-reminder-390.png' });
    expect(await layoutProblems(p)).toEqual([]);
    expect(await packs(p)).toEqual([]);                                                // signing in alone earns nothing
    await p.locator('[data-daily="later"]').click();
    await expect(p.locator('[data-ui="daily-modal"]')).toHaveCount(0);
    await p.reload(); await p.waitForSelector('[data-act="deck"]'); await dev.cloudReady();
    await expect(p.locator('[data-ui="daily-modal"]')).toHaveCount(0);                // once a day
    await playRound(p);
    const today = await p.evaluate(() => 'day:' + Arcade.dayKey());
    expect(await packs(p)).toEqual([today]);
    await expect(p.locator('[data-ui="pack-ready"]')).toContainText('Daily pack earned');
    await p.locator('[data-act="home"]').first().click();
    await playRound(p);
    expect(await packs(p)).toEqual([today]);                                           // one per day
    await expect(p.locator('[data-ui="pack-ready"]')).toHaveCount(0);
    await p.locator('.iconbtn[data-act="binder"]').click();
    await expect(p.locator('[data-act="pack-open"]')).toContainText('Earned: daily practice');
    // the claim syncs: tomorrow on this account pays again, today on another device does not
    const uid = await p.evaluate(() => Cloud.uid());
    await expect.poll(() => (arena.backend.adminGet('players/' + uid).progress.packLog || []).includes(today), { timeout: 8000 }).toBe(true);
    const other = await arena.device({ width: PHONE, dailyReminder: true }), q = other.page;
    await other.goto('/'); await other.signIn('class1', 'daily');
    await expect(q.locator('[data-ui="daily-modal"]')).toHaveCount(0);                 // already claimed today
    expect(await q.evaluate(() => Arcade.dailyPack())).toBe(false);
  });

  test('the Play a room button starts a round; guests never get a daily pack or the pop-up', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE, dailyReminder: true }), p = dev.page;
    await dev.goto('/');
    await playRound(p);                                                                // guest
    expect(await packs(p)).toEqual([]);
    await expect(p.locator('[data-ui="daily-modal"]')).toHaveCount(0);
    await p.locator('[data-act="home"]').first().click();
    await dev.signUp('class1', 'player2');
    await p.locator('[data-daily="play"]').click();
    await expect(p.locator('.qmeta')).toBeVisible();
  });

  test('labels say why a pack was earned, not what is in it', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const t = await p.evaluate(() => { const A = Arcade, it = A.ALL[0]; A.S.packs.push({ id: 'gold:' + it.id, reason: 'gold', cardId: it.id, slots: [] }, { id: 'vs:ABCDEF', reason: 'vs', matchId: 'ABCDEF', slots: [] }, { id: 'day:2026-10-10', reason: 'day', day: '2026-10-10', slots: [] }); A.render(); return it.name; });
    await p.locator('[data-act="binder"]').click();
    await expect(p.locator('[data-act="pack-open"]')).toHaveText([new RegExp('Earned: ' + t + ' reached Gold Legend'), /Earned: VS win/, /Earned: daily practice/]);
  });
});
