// Ion Maker (ion), Metal Detector (metal) and Review Room (review): seeded question content, room locks on the
// home grid, and the solo-only Review Room. Runs inside the real index.html with Firebase blocked (except R5d).
import { test, expect } from '../helpers/fixtures.js';
import { openVs } from '../helpers/vs.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const MINUS = '−';
const ION_SYMS = ['Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'N', 'P', 'O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'];
// Common ion of each main-group element: magnitude + sign (written out here, not copied from the game).
const CHG = {
  Li: '1+', Na: '1+', K: '1+', Rb: '1+', Cs: '1+', Be: '2+', Mg: '2+', Ca: '2+', Sr: '2+', Ba: '2+', Al: '3+',
  N: '3' + MINUS, P: '3' + MINUS, O: '2' + MINUS, S: '2' + MINUS, Se: '2' + MINUS,
  F: '1' + MINUS, Cl: '1' + MINUS, Br: '1' + MINUS, I: '1' + MINUS
};
const ionText = sym => sym + (CHG[sym][0] === '1' ? '' : CHG[sym][0]) + CHG[sym][1];
const metalClass = f => f === 'Metalloid' ? 'metalloid' : (f === 'Nonmetal' || f === 'Halogen' || f === 'Noble Gas') ? 'nonmetal' : 'metal';
const real = errs => errs.filter(e => !/Failed to load resource|ERR_FAILED/.test(e));

test.describe('Ion Maker (room ion)', () => {
  test('R1 ion questions: 4 distinct options, one right answer, correct facts, deterministic, no Math.random', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const cards = await p.evaluate(() => ALL.map(x => ({ id: x.id, name: x.name, sym: x.sym, cat: x.cat, zn: +x.zn, family: x.family, s1v: x.s1v })));
    const runs = await p.evaluate(([decks, seeds]) => {
      const strip = h => { const e = document.createElement('div'); e.innerHTML = h; return e.textContent; };
      const orig = Math.random;
      Math.random = () => { throw new Error('buildRound must not use Math.random'); };
      try {
        return decks.flatMap(d => seeds.map(s => {
          const a = JSON.stringify(buildRound(d, 'ion', s)), b = JSON.stringify(buildRound(d, 'ion', s));
          const qs = JSON.parse(a).map(q => ({ ...q, optText: q.options.map(strip) }));
          return { d, s, same: a === b, pool: roomPool(roomOf('ion'), d).length, qs };
        }));
      } finally { Math.random = orig; }
    }, [['s20', 'r4', 'e118'], SEEDS]);
    expect(runs.length).toBe(3 * SEEDS.length);
    const byId = new Map(cards.map(c => [c.id, c]));
    const problems = [], kinds = { valence: 0, ion: 0, charge: 0 };
    for (const r of runs) {
      const where = `${r.d}/seed ${r.s}`;
      if (!r.same) problems.push(`${where}: a second call differs`);
      if (r.pool > 0 && r.qs.length !== 10) problems.push(`${where}: ${r.qs.length} questions, want 10`);
      for (const q of r.qs) {
        const at = `${where} "${q.prompt}"`;
        const card = byId.get(q.cardId);
        if (!card || card.cat !== 'el' || !ION_SYMS.includes(card.sym)) { problems.push(`${at}: card ${q.cardId} is not an ion-room element`); continue; }
        if (q.type !== 'ion') problems.push(`${at}: type ${q.type}`);
        if (q.optText.length !== 4 || new Set(q.optText).size !== 4) problems.push(`${at}: options ${JSON.stringify(q.optText)}`);
        if (!(q.correct >= 0 && q.correct < q.optText.length)) problems.push(`${at}: correct index ${q.correct}`);
        const got = q.optText[q.correct], s1 = +card.s1v, v = s1 <= 2 ? s1 : s1 - 10;
        const sign = CHG[card.sym][1];
        let want;
        if (q.prompt === `How many valence electrons does ${card.name} have?`) { kinds.valence++; want = String(v); }
        else if (q.prompt === `What ion does ${card.name} usually form?`) { kinds.ion++; want = ionText(card.sym); }
        else {
          const m = /^How many electrons does (.+) (lose|gain) to form its ion\?$/.exec(q.prompt);
          if (m && m[1] === card.name && m[2] === (sign === '+' ? 'lose' : 'gain')) { kinds.charge++; want = CHG[card.sym][0]; }
        }
        if (want === undefined) { problems.push(`${at}: unexpected prompt for ${card.sym}`); continue; }
        if (got !== want) problems.push(`${at}: correct option "${got}", want "${want}"`);
      }
    }
    expect(problems.length, problems.slice(0, 5).join(' | ')).toBe(0);
    for (const k of ['valence', 'ion', 'charge']) expect(kinds[k], `${k} questions across all runs`).toBeGreaterThanOrEqual(20);
    expect(dev.errors.filter(e => !/Failed to load resource|ERR_FAILED/.test(e))).toEqual([]);
  });
});

test.describe('Metal Detector (room metal)', () => {
  test('R10 metal questions: 4 distinct options, one right answer, decoys from other classes, no At or Z >= 104', async ({ arena }) => {
    const DECKS = ['s20', 'r4', 'r5', 'r6', 'r7', 'e118', 'all'];
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const cards = await p.evaluate(() => ALL.map(x => ({ id: x.id, name: x.name, sym: x.sym, cat: x.cat, zn: +x.zn, family: x.family })));
    const runs = await p.evaluate(([decks, seeds]) => {
      const strip = h => { const e = document.createElement('div'); e.innerHTML = h; return e.textContent; };
      const orig = Math.random;
      Math.random = () => { throw new Error('buildRound must not use Math.random'); };
      try {
        return decks.flatMap(d => seeds.map(s => {
          const a = JSON.stringify(buildRound(d, 'metal', s)), b = JSON.stringify(buildRound(d, 'metal', s));
          const qs = JSON.parse(a).map(q => ({ ...q, optText: q.options.map(strip) }));
          return { d, s, same: a === b, qs };
        }));
      } finally { Math.random = orig; }
    }, [DECKS, SEEDS]);
    expect(runs.length).toBe(DECKS.length * SEEDS.length);
    const byId = new Map(cards.map(c => [c.id, c]));
    const elByName = new Map(cards.filter(c => c.cat === 'el').map(c => [c.name, c]));
    const excluded = c => c.sym === 'At' || c.zn >= 104;
    const problems = [], perDeck = {};
    for (const r of runs) {
      const where = `${r.d}/seed ${r.s}`;
      if (!r.same) problems.push(`${where}: a second call differs`);
      perDeck[r.d] = (perDeck[r.d] || 0) + r.qs.length;
      for (const q of r.qs) {
        const at = `${where} "${q.prompt}"`;
        const card = byId.get(q.cardId);
        if (!card || card.cat !== 'el' || excluded(card)) { problems.push(`${at}: card ${q.cardId} is not a classified element`); continue; }
        if (q.type !== 'metal') problems.push(`${at}: type ${q.type}`);
        if (q.optText.length !== 4 || new Set(q.optText).size !== 4) problems.push(`${at}: options ${JSON.stringify(q.optText)}`);
        if (!(q.correct >= 0 && q.correct < q.optText.length)) { problems.push(`${at}: correct index ${q.correct}`); continue; }
        const cls = metalClass(card.family);
        const m = /^Which one is a (metal|nonmetal|metalloid)\?$/.exec(q.prompt);
        if (!m || m[1] !== cls) problems.push(`${at}: prompt does not match class ${cls}`);
        if (q.optText[q.correct] !== card.name) problems.push(`${at}: correct option "${q.optText[q.correct]}", want "${card.name}"`);
        q.optText.forEach((t, i) => {
          if (i === q.correct) return;
          const oc = elByName.get(t);
          if (!oc) problems.push(`${at}: decoy "${t}" is not an element card`);
          else if (excluded(oc)) problems.push(`${at}: decoy ${oc.sym} is At or Z >= 104`);
          else if (metalClass(oc.family) === cls) problems.push(`${at}: decoy ${oc.sym} is also a ${cls}`);
        });
      }
    }
    expect(problems.length, problems.slice(0, 5).join(' | ')).toBe(0);
    for (const d of DECKS.filter(d => d !== 'r7')) expect(perDeck[d], `${d} questions across all seeds`).toBeGreaterThan(0);
    expect(dev.errors.filter(e => !/Failed to load resource|ERR_FAILED/.test(e))).toEqual([]);
  });
});

test.describe('home grid: Ion Maker, Metal Detector, Review Room', () => {
  test('R5e names on the grid; both element rooms open on All 118 and lock on Isotopes with a reason', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const tile = id => p.locator(`button.room[data-id="${id}"]`);
    await expect(tile('ion').locator('.nm')).toHaveText('Ion Maker');
    await expect(tile('metal').locator('.nm')).toHaveText('Metal Detector');
    await expect(tile('review').locator('.nm')).toHaveText('Review Room');
    await p.locator('[data-act="deck"][data-id="e118"]').click();
    await expect(tile('ion')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(tile('metal')).not.toHaveAttribute('aria-disabled', 'true');
    await p.locator('[data-act="deck"][data-id="iso"]').click();
    await expect(tile('ion')).toHaveAttribute('aria-disabled', 'true');
    await expect(tile('metal')).toHaveAttribute('aria-disabled', 'true');
    await tile('ion').click({ force: true });
    await expect(p.locator('[data-ui="room-status"]')).toContainText('main-group element cards');
    await tile('metal').click({ force: true });
    await expect(p.locator('[data-ui="room-status"]')).toContainText('Metal Detector needs element cards');
    expect(await p.evaluate(() => Arcade.V.screen)).toBe('home');
    expect(real(dev.errors)).toEqual([]);
  });
});

test.describe('Review Room (solo only)', () => {
  test('R5a fresh profile: locked, and a tap says why and starts nothing', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const tile = p.locator('button.room[data-id="review"]');
    await expect(tile).toHaveAttribute('aria-disabled', 'true');
    await expect(tile).toContainText('Locked: needs 3 missed cards.');
    await tile.click({ force: true });
    await expect(p.locator('[data-ui="room-status"]')).toHaveText('No misses yet. Nice.');
    expect(await p.evaluate(() => Arcade.V.screen)).toBe('home');
    expect(real(dev.errors)).toEqual([]);
  });

  test('R5b two misses stay locked; three unlock it and the round is exactly those cards', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const ids = await p.evaluate(() => deckItems('s20').slice(0, 3).map(x => x.id));
    const tile = p.locator('button.room[data-id="review"]');
    await p.evaluate(ids => { S.miss[ids[0]] = 1; S.miss[ids[1]] = 1; save(); render(); }, ids);
    await expect(tile).toHaveAttribute('aria-disabled', 'true');
    await p.evaluate(ids => { S.miss[ids[2]] = 1; save(); render(); }, ids);
    await expect(tile).not.toHaveAttribute('aria-disabled', 'true');
    await tile.click();
    expect(await p.evaluate(() => [Arcade.V.screen, Arcade.V.roomId])).toEqual(['quiz', 'review']);
    const qs = await p.evaluate(() => Arcade.V.qs.map(q => q.item.id));
    expect(qs.length).toBe(3);
    expect(new Set(qs).size).toBe(3);
    for (const id of qs) expect(ids).toContain(id);
    expect(real(dev.errors)).toEqual([]);
  });

  test('R5c right answers clear one miss each (a and b drop out, c goes 2 to 1)', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const ids = await p.evaluate(() => deckItems('s20').slice(0, 3).map(x => x.id));
    await p.evaluate(ids => { S.miss = { [ids[0]]: 1, [ids[1]]: 1, [ids[2]]: 2 }; save(); render(); }, ids);
    await p.locator('button.room[data-id="review"]').click();
    for (let i = 0; i < 3; i++) {
      const k = await p.evaluate(() => Arcade.V.qs[Arcade.V.qi].opts.findIndex(o => o.ok));
      await p.locator(`[data-act="answer"][data-i="${k}"]`).click();
      await p.locator('[data-act="next"]').click();
    }
    await expect(p.locator('[data-act="again"]')).toBeVisible();
    expect(await p.evaluate(() => ({ ...S.miss }))).toEqual({ [ids[2]]: 1 });
    expect(real(dev.errors)).toEqual([]);
  });

  test('R5c2 a wrong answer in Review adds one to that card and clears nothing', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const ids = await p.evaluate(() => deckItems('s20').slice(0, 3).map(x => x.id));
    await p.evaluate(ids => { S.miss = { [ids[0]]: 1, [ids[1]]: 1, [ids[2]]: 1 }; save(); render(); }, ids);
    await p.locator('button.room[data-id="review"]').click();
    const first = await p.evaluate(() => Arcade.V.qs[0].item.id);
    const k = await p.evaluate(() => (Arcade.V.qs[0].opts.findIndex(o => o.ok) + 1) % 4);
    await p.locator(`[data-act="answer"][data-i="${k}"]`).click();
    expect(await p.evaluate(() => ({ ...S.miss }))).toEqual({ ...Object.fromEntries(ids.map(id => [id, id === first ? 2 : 1])) });
    expect(real(dev.errors)).toEqual([]);
  });

  test('R5d Review is not offered to VS: no room option, and buildRound returns nothing for it', async ({ arena }) => {
    const dev = await arena.device(), p = dev.page;
    await dev.goto('/');
    await dev.signUp('class1', 'reviewer');
    await openVs(dev);
    const values = await p.locator('[data-vs="room"] option').evaluateAll(os => os.map(o => o.value));
    expect(values).toContain('ion');
    expect(values).toContain('metal');
    expect(values).not.toContain('review');
    expect(await p.evaluate(() => buildRound('s20', 'review', 1))).toEqual([]);
    expect(dev.errors).toEqual([]);
  });
});
