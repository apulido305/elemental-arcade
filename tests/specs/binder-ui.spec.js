// The Binder screen: packs on top, a shelf of game spines (this game first), totals across games, then the open game's
// tabs and slots. Cell Arcade's cards come from its cards.json (stubbed here) and draw with this game's card renderer.
// Screenshots: docs/binder/<name>-<390|1100>.png.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { layoutProblems } from '../helpers/layout.js';
import { B, BIO_CARDS, serveBio } from '../helpers/cell.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'binder');
async function soloRound(page) {
  await page.locator('[data-act="play"]').first().click();
  for (let i = 0; i < 25; i++) {
    if (await page.locator('[data-act="again"]').count()) break;
    const k = await page.evaluate(() => Arcade.V.qs[Arcade.V.qi].opts.findIndex(o => o.ok));
    await page.locator(`.opts [data-act="answer"][data-i="${k}"]`).click();
    await page.locator('[data-act="next"]').click();
  }
  await expect(page.locator('[data-act="again"]')).toBeVisible();
}
// A guest who also played Cell Arcade on this browser (the shared 'arcade-v1' store): Nucleus at Gold Legend, Glycine at
// Full Art, Cysteine at Base. And a Cell Arcade icon unlocked there.
const bioGuest = p => p.evaluate(() => { const g = Binder.guestAll(); g.games.bio = { owned: { 'bio:org1': 15, 'bio:aa1': 6, 'bio:aa12': 1 } };
  g.profile.unlocked = (g.profile.unlocked || []).concat(['bio:frog']); localStorage.setItem('arcade-v1', JSON.stringify(g)); });

for (const w of [PHONE, DESKTOP]) {
  test(`shelf: a spine per game (this one first), totals, and Cell Arcade's cards from its cards.json (${w})`, async ({ arena }) => {
    const dev = await arena.device({ width: w, fonts: true, firebase: 'blocked' }), p = dev.page;
    await serveBio(dev.context);
    await dev.goto('/');
    await bioGuest(p);
    await p.reload(); await p.waitForSelector('[data-act="deck"]');
    await soloRound(p);
    await p.locator('[data-ui="results-bar"] [data-act="home"]').click();
    await p.locator('.iconbtn[data-act="binder"]').click();
    const spines = p.locator('[data-act="shelf"]');
    await expect(spines).toHaveCount(Object.keys(B.GAMES).length);
    await expect(spines.first()).toHaveAttribute('data-id', 'chem');
    await expect(spines.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(spines.first()).toContainText('Elemental Arcade');
    await expect(p.locator('[data-act="shelf"][data-id="bio"]')).toContainText(`3/${BIO_CARDS.cards.length} cards`);
    const mine = await p.evaluate(() => Object.keys(Arcade.S.owned).length);
    await expect(p.locator('[data-ui="totals"]')).toContainText(`${mine + 3}cards in every game`);
    await expect(p.locator('[data-ui="totals"]')).toContainText('1Gold Legend');
    await expect(p.locator('.grid .cell').first()).toBeVisible();                       // this game's cards under the shelf
    await p.waitForTimeout(300);
    expect(await layoutProblems(p)).toEqual([]);
    await p.screenshot({ path: path.join(OUT, `shelf-${w}.png`), fullPage: false });
    // Cell Arcade's spine: its cards, its progress, the tier from its count, the amino acid badge
    await p.locator('[data-act="shelf"][data-id="bio"]').click();
    await expect(p.locator('[data-act="shelf"][data-id="bio"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(p.locator('.grid .cell')).toHaveCount(3);
    await expect(p.locator('.grid .slot')).toHaveCount(1);
    await expect(p.locator('.grid .slot')).toContainText('#1');                          // E. coli: number in its category
    await expect(p.locator('.grid [data-act="open"][data-id="bio:org1"]')).toHaveAttribute('aria-label', 'Nucleus, Gold Legend');
    await expect(p.locator('.grid [data-act="open"][data-id="bio:aa1"] .post1')).toHaveText('G');
    await expect(p.locator('[data-ui="game-open"]')).toHaveAttribute('href', B.GAMES.bio.url);
    await p.locator('[data-act="tab"][data-id="aa"]').click();
    await expect(p.locator('.grid .cell')).toHaveCount(2);
    await p.waitForTimeout(300);
    expect(await layoutProblems(p)).toEqual([]);
    await p.screenshot({ path: path.join(OUT, `bio-shelf-${w}.png`), fullPage: false });
    // the enlarge modal works for another game's card (Full Art: procedural art, no illustration)
    await p.locator('.grid [data-act="open"][data-id="bio:aa1"]').click();
    await expect(p.locator('#modal-root .modal')).toContainText('Full Art · answered correctly 6 times');
    await expect(p.locator('#modal-root .card')).toContainText('Glycine');
    await expect(p.locator('#modal-root .card')).toContainText('Codons (mRNA)');
    await expect(p.locator('#modal-root .card')).toContainText('Mass 75 Da');
    await expect(p.locator('#modal-root .post1')).toHaveText('G');
    expect(await p.locator('#modal-root .card sup').count()).toBe(0);                     // a badge, not a charge superscript
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(OUT, `foreign-modal-${w}.png`), fullPage: false });
    await p.keyboard.press('Escape');
    await expect(p.locator('#modal-root .modal')).toHaveCount(0);
    // the picker lists the Cell Arcade icon unlocked there
    await p.locator('[data-act="icons"]').click();
    await expect(p.locator('[data-act="icon-pick"][data-id="bio:frog"]')).toHaveCount(1);
    expect(dev.errors).toEqual([]);
  });
}

test('another game whose cards.json cannot be loaded: its spine says so and links to it; nothing throws', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, firebase: 'blocked' }), p = dev.page;
  await dev.goto('/');
  await p.locator('.iconbtn[data-act="binder"]').click();
  await p.locator('[data-act="shelf"][data-id="bio"]').click();
  await expect(p.locator('[data-ui="foreign-msg"]')).toContainText('not linked to the Binder yet');
  await expect(p.locator('[data-ui="foreign-msg"] a')).toHaveAttribute('href', B.GAMES.bio.url);
  expect(await layoutProblems(p)).toEqual([]);
  expect(dev.errors).toEqual([]);
});

test('a pack from Cell Arcade with its cards.json loaded shows the finished card on the flip; screenshot', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE, fonts: true, firebase: 'blocked' }), p = dev.page;
  await serveBio(dev.context);
  await dev.goto('/');
  await bioGuest(p);
  await p.evaluate(() => { const g = Binder.guestAll(); g.profile.packs = [{ id: 'vs:BIOBIO', at: Date.now(), reason: 'vs', matchId: 'BIOBIO', game: 'bio', seed: 1, week: 1,
    slots: [{ kind: 'finish', card: 'bio:aa1', finish: 'ember', name: 'Glycine', src: 'finish' }, { kind: 'icon', icon: 'bio:octopus', src: 'b1' }, { kind: 'gold', icon: 'cat-gold', src: 'gold' }] }];
    g.profile.packLog = ['vs:BIOBIO']; localStorage.setItem('arcade-v1', JSON.stringify(g)); });
  await p.reload(); await p.waitForSelector('[data-act="deck"]');
  await p.locator('.iconbtn[data-act="binder"]').click();
  await expect(p.locator('[data-act="shelf"][data-id="bio"]')).toContainText('cards');
  await expect.poll(() => p.evaluate(() => !!Arcade.cardById('bio:aa1'))).toBe(true);   // cards.json loaded by the shelf
  await p.locator('[data-act="pack-open"]').click();
  await p.locator('[data-pk="tear"]').click();
  for (const i of [0, 1, 2]) await p.locator(`[data-pk="flip"][data-i="${i}"]`).click();
  await expect(p.locator('.pkcard').nth(0).locator('.cw.fin-ember')).toHaveCount(1);     // the Glycine card, with its new finish
  await expect(p.locator('.pkcard').nth(1)).toHaveAttribute('aria-label', 'Octopus, Uncommon icon');
  await p.waitForTimeout(900);
  expect(await layoutProblems(p)).toEqual([]);
  await p.screenshot({ path: path.join(OUT, 'bio-pack-390.png') });
  await p.locator('[data-pk="done"]').click();
  await p.locator('[data-act="shelf"][data-id="bio"]').click();
  await p.locator('.grid [data-act="open"][data-id="bio:aa1"]').click();
  await expect(p.locator('#modal-root .cw')).toHaveClass(/fin-ember/);                    // finishes are account-wide: any game's card
  await expect(p.locator('#modal-root [data-act="finish"][data-id="ember"]')).toHaveAttribute('aria-pressed', 'true');
  expect(dev.errors).toEqual([]);
});
