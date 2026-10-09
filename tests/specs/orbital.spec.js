// Orbital Builder has two levels: HS (room 'shells', electrons per shell as n=1, n=2 ...) and College
// (room 'config', 1s² 2s² ... notation, the original room id so earned stars carry over).
import { test, expect, PHONE } from '../helpers/fixtures.js';

test('HS Orbital Builder: n= notation, right answer from the card, shells hidden on the clue, no polyatomic ions', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const r = await dev.page.evaluate(() => {
    const room = Arcade.roomOf('shells');
    // every card that supports the room gets a valid question (seeded, many seeds)
    const bad = [], seen = new Set();
    for (const deck of ['s20', 'e118', 'cat', 'an', 'iso', 'all']) {
      for (let s = 1; s <= 40; s++) {
        for (const q of Arcade.buildRound(deck, 'shells', s * 7919)) {
          const it = Arcade.BY[q.cardId], right = q.options[q.correct];
          const want = it.shells.split(',').map((n, i) => 'n=' + (i + 1) + ': ' + n.trim()).join(' · ');
          seen.add(it.cat);
          if (right !== want) bad.push(it.name + ': ' + right + ' != ' + want);
          if (new Set(q.options).size !== q.options.length || q.options.length < 2) bad.push(it.name + ': options ' + q.options.join(' | '));
          if (q.options.some(o => !/^n=1: \d+( · n=\d: \d+)*$/.test(o))) bad.push(it.name + ': bad format ' + q.options.join(' | '));
          if (it.cat === 'poly') bad.push('polyatomic in HS room: ' + it.name);
        }
      }
    }
    return { bad: bad.slice(0, 10), cats: [...seen].sort(), room: { name: room.name, types: room.types },
      college: Arcade.roomOf('config').name, mixed: Arcade.roomOf('mixed').types, pool: Arcade.roomPool(room, 'all').some(x => x.cat === 'poly') };
  });
  expect(r.bad).toEqual([]);
  expect(r.cats).toEqual(['an', 'cat', 'el', 'iso']);
  expect(r.room).toEqual({ name: 'Orbital Builder: HS', types: ['shells'] });
  expect(r.college).toBe('Orbital Builder: College');
  expect(r.mixed).toContain('shells'); expect(r.mixed).toContain('config');
  expect(r.pool).toBe(false);
});

test('HS room on screen: options read n=1 ..., the tile does not give the shells away, explanation names the count', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, firebase: 'blocked' }), p = dev.page;
  await dev.goto('/');
  await expect(p.locator('[data-act="room"][data-id="shells"]')).toContainText('Orbital Builder: HS');
  await expect(p.locator('[data-act="room"][data-id="config"]')).toContainText('Orbital Builder: College');
  await p.locator('[data-act="room"][data-id="shells"]').click();
  const it = await p.evaluate(() => { const q = Arcade.V.qs[0]; return { shells: q.item.shells, ok: q.opts.findIndex(o => o.ok), z: q.item.z }; });
  await expect(p.locator('.opt').first()).toContainText('n=1:');
  // the tile's shell column is empty (hidden), while the atomic number still shows
  const shellCol = await p.locator('.clue .tile div[style*="flex-direction:column"]').first().innerText();
  expect(shellCol.trim()).toBe('');
  await p.locator(`[data-act="answer"][data-i="${it.ok}"]`).click();
  const n = it.shells.split(',').reduce((a, b) => a + +b, 0);
  await expect(p.locator('.fb')).toContainText(`${n} electron`);
  expect(dev.errors.filter(e => !/Failed to load resource|ERR_FAILED/.test(e))).toEqual([]);
});
