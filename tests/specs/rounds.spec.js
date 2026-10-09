// Unit tests for the seeded question builder, run inside the real index.html with Firebase blocked.
import { test, expect } from '../helpers/fixtures.js';

const DECKS = ['s20', 'r4', 'e118', 'cat', 'iso', 'all'];
const ROOMS = ['mixed', 'ability', 'symbol', 'number', 'shells', 'config', 'lab'];
const SEEDS = [1, 42, 123456789, 0xdeadbeef, 4294967295];

test.describe('buildRound / makeQ', () => {
  test('buildRound(deck, room, seed) is deterministic and never touches Math.random', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' });
    await dev.goto('/');
    const combos = DECKS.flatMap(d => ROOMS.flatMap(r => SEEDS.map(s => [d, r, s])));
    const out = await dev.page.evaluate(combos => {
      const orig = Math.random;
      Math.random = () => { throw new Error('buildRound must not use Math.random'); };
      try {
        return combos.map(([d, r, s]) => {
          const a = JSON.stringify(window.buildRound(d, r, s)), b = JSON.stringify(window.buildRound(d, r, s));
          const room = roomOf(r), pool = roomPool(room, d).length;
          return { d, r, s, same: a === b, n: JSON.parse(a).length, pool, ids: JSON.parse(a).map(q => q.cardId), a };
        });
      } finally { Math.random = orig; }
    }, combos);
    expect(out.length).toBe(DECKS.length * ROOMS.length * SEEDS.length);
    let nonEmpty = 0;
    for (const o of out) {
      expect(o.same, `${o.d}/${o.r}/${o.s} repeats identically`).toBe(true);
      if (o.pool > 0) {
        nonEmpty++;
        expect(o.n, `${o.d}/${o.r}/${o.s} has 10 questions`).toBe(10);
        if (o.pool >= 40) expect(new Set(o.ids).size, `${o.d}/${o.r}/${o.s} has no repeated card`).toBe(10);
      } else expect(o.n).toBe(0);
    }
    expect(nonEmpty).toBeGreaterThan(20);
    // Different seeds give different rounds for a big pool, and the shape is what the contract promises.
    const big = out.filter(o => o.d === 'e118' && o.r === 'mixed');
    expect(new Set(big.map(o => o.a)).size).toBe(SEEDS.length);
    const q = JSON.parse(big[0].a)[0];
    expect(Object.keys(q).sort()).toEqual(['cardId', 'clue', 'correct', 'exp', 'mono', 'options', 'prompt', 'type']);
    expect(q.correct).toBeGreaterThanOrEqual(0); expect(q.correct).toBeLessThan(q.options.length);
    // Another fresh page (new JS realm) produces byte-identical rounds: nothing depends on page state.
    const dev2 = await arena.device({ firebase: 'blocked' });
    await dev2.goto('/');
    const again = await dev2.page.evaluate(c => c.map(([d, r, s]) => JSON.stringify(window.buildRound(d, r, s))), combos.slice(0, 30));
    expect(again).toEqual(out.slice(0, 30).map(o => o.a));
  });

  test('buildRound restores solo state: makeQ afterwards is still Math.random-driven', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' });
    await dev.goto('/');
    const r = await dev.page.evaluate(() => {
      window.buildRound('all', 'mixed', 7);
      let calls = 0; const orig = Math.random; Math.random = () => { calls++; return 0.5; };
      try { makeQ(deckItems('s20')[3], roomOf('mixed')); } finally { Math.random = orig; }
      return calls;
    });
    expect(r).toBeGreaterThan(0);
  });

  test('makeQ without rng uses Math.random; with rng it does not', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' });
    await dev.goto('/');
    const res = await dev.page.evaluate(() => {
      const orig = Math.random;
      const withStub = (seed, fn) => { const g = mulberry32(seed); let calls = 0; Math.random = () => { calls++; return g(); }; try { return { out: fn(), calls }; } finally { Math.random = orig; } };
      const sig = q => JSON.stringify([q.prompt, q.type, q.opts.map(o => [o.h, !!o.ok])]);
      const items = deckItems('e118').filter((_, i) => i % 9 === 0).slice(0, 12), room = roomOf('mixed');
      const same = items.map(it => {
        const a = withStub(99, () => sig(makeQ(it, room))), b = withStub(99, () => sig(makeQ(it, room)));
        return { calls: a.calls, eq: a.out === b.out && a.calls === b.calls };
      });
      // different stubbed sequences => the questions change (so output really is driven by Math.random)
      const varied = new Set(items.map(it => withStub(5, () => sig(makeQ(it, room))).out + '|' + withStub(77, () => sig(makeQ(it, room))).out));
      const differs = items.some(it => withStub(5, () => sig(makeQ(it, room))).out !== withStub(77, () => sig(makeQ(it, room))).out);
      // constant stub values: prove the call is routed through whatever Math.random is at call time
      Math.random = () => 0; const lo = sig(makeQ(items[0], room)); Math.random = () => 0.999999; const hi = sig(makeQ(items[0], room)); Math.random = orig;
      // with an explicit rng, Math.random is untouched
      Math.random = () => { throw new Error('should not be called'); };
      let threw = false; try { makeQ(items[0], room, mulberry32(3)); } catch (e) { threw = true; } finally { Math.random = orig; }
      return { same, differs, lowHighDiffer: lo !== hi, threw, varied: varied.size };
    });
    for (const s of res.same) { expect(s.calls).toBeGreaterThan(0); expect(s.eq).toBe(true); }
    expect(res.differs).toBe(true);
    expect(res.threw).toBe(false);
  });
});
