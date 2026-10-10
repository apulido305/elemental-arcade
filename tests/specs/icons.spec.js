// Profile icons: preset picker, persistence (guest: this browser only, in the shared Binder store; signed in: the
// profile doc), the copy on a match seat, and the fallback for unknown ids. Rules cases for icons live in rules.spec.js.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { openVs, hostArena, joinByCodeOk, seatKids } from '../helpers/vs.js';
import { layoutProblems } from '../helpers/layout.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'ux');
const KEY = 'elemental-arcade-v1';   // the pre-Binder guest save (migrated on load)
const PKEY = 'arcade-v1-prefs:chem';
const guestIcon = page => page.evaluate(() => Binder.guestAll().profile.icon);
const headerIcon = page => page.locator('[data-act="icons"] .av').getAttribute('data-icon');

async function pickIcon(page, id) {
  await page.locator('[data-act="icons"]').click();
  await expect(page.locator('[data-ui="picker"]')).toBeVisible();
  await page.locator(`[data-act="icon-pick"][data-id="${id}"]`).click();
  await page.locator('[data-act="icon-use"]').click();
  await expect(page.locator('[data-ui="picker"]')).toHaveCount(0);
}
async function soloRound(page) {
  await page.locator('[data-act="play"]').first().click();
  for (let i = 0; i < 12; i++) {
    if (await page.locator('[data-act="again"]').count()) break;
    const k = await page.evaluate(() => Arcade.V.qs[Arcade.V.qi].opts.findIndex(o => o.ok));
    await page.locator(`[data-act="answer"][data-i="${k}"]`).click();
    await page.locator('[data-act="next"]').click();
  }
  await expect(page.locator('[data-act="again"]')).toBeVisible();
}

for (const w of [PHONE, DESKTOP]) {
  test(`picker: 16 presets, ${w === PHONE ? 4 : 8} columns, gold ring, Use this only after a change, arrows move (${w})`, async ({ arena }) => {
    const dev = await arena.device({ width: w, fonts: true }), p = dev.page;
    await dev.goto('/');
    expect(await headerIcon(p)).toBe('atom');                                    // default until they pick
    await p.locator('[data-act="icons"]').click();
    const cells = p.locator('.icongrid [role="radio"]');
    await expect(cells).toHaveCount(16);
    await expect(p.locator('.icongrid')).toHaveAttribute('role', 'radiogroup');
    const ids = await cells.evaluateAll(els => els.map(e => e.dataset.id));
    expect(ids).toEqual(['atom', 'bolt', 'beaker', 'crystal', 'flame', 'droplet', 'magnet', 'moon', 'star', 'comet', 'rocket', 'flask', 'crown', 'shield', 'spark', 'wave']);
    const perRow = await cells.evaluateAll(els => els.filter(e => Math.abs(e.getBoundingClientRect().top - els[0].getBoundingClientRect().top) < 2).length);
    expect(perRow).toBe(w === PHONE ? 4 : 8);
    // every cell has a label under the icon and its accessible name
    await expect(p.locator('[data-act="icon-pick"][data-id="flask"]')).toHaveAttribute('aria-label', 'Flask');
    await expect(p.locator('[data-act="icon-pick"][data-id="flask"] small')).toHaveText('Flask');
    await expect(p.locator('[data-act="icon-pick"][data-id="atom"]')).toHaveAttribute('aria-checked', 'true');
    await expect(p.locator('[data-act="icon-use"]')).toBeDisabled();
    expect(await layoutProblems(p)).toEqual([]);
    await p.locator('[data-act="icon-pick"][data-id="flask"]').click();
    const sel = p.locator('[data-act="icon-pick"][data-id="flask"]');
    await expect(sel).toHaveAttribute('aria-checked', 'true');
    expect(await sel.evaluate(e => getComputedStyle(e).outlineColor)).toBe('rgb(243, 221, 122)');   // gold ring
    await expect(p.locator('[data-ui="pick-label"]')).toHaveText('Flask');
    await expect(p.locator('[data-act="icon-use"]')).toBeEnabled();
    // keyboard: arrows move the selection (and focus) through the group, wrapping at the ends
    await sel.focus(); await p.keyboard.press('ArrowRight');
    await expect(p.locator('[data-act="icon-pick"][data-id="crown"]')).toHaveAttribute('aria-checked', 'true');
    await expect(p.locator('[data-act="icon-pick"][data-id="crown"]')).toBeFocused();
    await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
    await expect(p.locator('[data-act="icon-pick"][data-id="rocket"]')).toHaveAttribute('aria-checked', 'true');
    await p.locator('[data-act="icon-pick"][data-id="flask"]').click();
    if (w === PHONE || w === DESKTOP) await p.screenshot({ path: path.join(OUT, `picker-${w}.png`), fullPage: true });
    // Cancel leaves the icon alone
    await p.locator('[data-act="icon-cancel"]').click();
    expect(await headerIcon(p)).toBe('atom');
    await pickIcon(p, 'flask');
    expect(await headerIcon(p)).toBe('flask');
    expect(dev.errors).toEqual([]);
  });
}

test('guest pick survives a reload from this browser and never touches /players', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE }), p = dev.page;
  await dev.goto('/');
  await pickIcon(p, 'magnet');
  expect(await guestIcon(p)).toBe('magnet');
  await p.reload(); await dev.cloudReady();
  expect(await headerIcon(p)).toBe('magnet');
  await expect(p.locator('[data-act="account"] .av')).toHaveAttribute('data-icon', 'magnet');
  // also shown on the sign-in screen, with Change icon
  await p.locator('[data-act="account"]').click();
  await expect(p.locator('[data-ui="account-icon"] .av')).toHaveAttribute('data-icon', 'magnet');
  await expect(p.locator('[data-ui="account-icon"] [data-act="icons"]')).toHaveText('Change icon');
  expect(await dev.currentUser()).toBeNull();
  expect(arena.backend.commits).toBe(0);
  expect(arena.backend.adminList('players')).toEqual([]);
  expect(dev.errors).toEqual([]);
});

test('unknown or hostile icon ids fall back to atom and are never rendered as markup', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE }), p = dev.page;
  await dev.goto('/');
  expect(await p.evaluate(() => [Arcade.iconOf('nope'), Arcade.iconOf(undefined), Arcade.iconOf(42), Arcade.iconOf('flask')])).toEqual(['atom', 'atom', 'atom', 'flask']);
  // in an old pre-Binder guest save (migrated on load), and in the shared store
  await p.evaluate(k => localStorage.setItem(k, JSON.stringify({ icon: '<img src=x onerror="window.__pwned=1">', owned: {} })), KEY);
  await p.reload(); await dev.cloudReady();
  expect(await headerIcon(p)).toBe('atom');
  expect(await p.locator('#app img').count()).toBe(0);
  await p.evaluate(() => localStorage.setItem('arcade-v1', JSON.stringify({ profile: { icon: '<img src=x onerror="window.__pwned=1">', iconAt: 9 }, games: {} })));
  await p.reload(); await dev.cloudReady();
  expect(await headerIcon(p)).toBe('atom');
  expect(await p.locator('#app img').count()).toBe(0);
  expect(await p.evaluate(() => window.__pwned)).toBeUndefined();
  // a seat without an icon (older client) draws atom in the lobby
  const host = await arena.device({ width: DESKTOP });
  await host.goto('/'); await host.signUp('class1', 'hosty');
  const code = await hostArena(host);
  const [kid] = await seatKids(arena, code, ['kid'], { icons: false });
  await expect(host.page.locator(`[data-vs="lobby-players"] li[data-uid="${kid.uid}"] .av`)).toHaveAttribute('data-icon', 'atom');
  expect(dev.errors).toEqual([]); expect(host.errors).toEqual([]);
});

test('signed-in pick is saved on the profile doc, survives later progress saves, and follows the student to another device', async ({ arena }) => {
  const dev = await arena.device({ width: DESKTOP }), p = dev.page;
  await dev.goto('/');
  await dev.signUpViaUI('class1', 'ada', '1234');
  const uid = (await dev.currentUser()).uid;
  expect(arena.backend.adminGet('players/' + uid).icon).toBe('atom');
  await pickIcon(p, 'comet');
  await expect.poll(() => arena.backend.adminGet('players/' + uid).icon, { timeout: 8000 }).toBe('comet');
  // a later progress save (solo round, games/chem) keeps the icon on the profile
  await soloRound(p);
  await expect.poll(() => arena.backend.adminGet(`players/${uid}/games/chem`)?.rounds, { timeout: 8000 }).toBe(1);
  const doc = arena.backend.adminGet('players/' + uid);
  expect(doc.icon).toBe('comet');
  expect(doc.progress).toBeUndefined();                                      // a Binder account never gets the pre-Binder map
  await p.locator('[data-act="account"]').click();
  await expect(p.locator('[data-ui="account-icon"] .av')).toHaveAttribute('data-icon', 'comet');
  // another device
  const dev2 = await arena.device({ width: PHONE });
  await dev2.goto('/');
  expect(await headerIcon(dev2.page)).toBe('atom');
  await dev2.signIn('ada', '1234');
  await expect.poll(() => headerIcon(dev2.page)).toBe('comet');
  // signing out brings back this browser's guest icon, not the account's
  await dev2.page.evaluate(() => Cloud.signOut());
  await expect.poll(() => headerIcon(dev2.page)).toBe('atom');
  expect(arena.backend.denials).toEqual([]);
  expect(dev.errors).toEqual([]); expect(dev2.errors).toEqual([]);
});

test('newer side wins: a pick on this device not yet saved beats the doc; an older one does not (merge, not max)', async ({ arena }) => {
  const dev = await arena.device({ width: PHONE }), p = dev.page;
  await dev.goto('/');
  // the merge function on its own (binder.js mergeIcon, which saveGame uses)
  const cases = await p.evaluate(() => {
    const m = (doc, local) => Binder.mergeIcon(doc, local, [], 'atom'), ts = ms => ({ toMillis: () => ms });
    return [
      m({ icon: 'flask', updated: ts(2000) }, { icon: 'moon', iconAt: 1000 }),   // doc newer
      m({ icon: 'flask', updated: ts(2000) }, { icon: 'moon', iconAt: 3000 }),   // device newer
      m(null, { icon: 'moon', iconAt: 0 }),                                      // no doc yet
      m({ icon: 'flask', updated: ts(5) }, null),                                // nothing picked here
      m({ updated: ts(5) }, { icon: 'evil', iconAt: 9 })                         // bad id never reaches the doc
    ];
  });
  expect(cases).toEqual(['flask', 'moon', 'moon', 'flask', 'atom']);
  await dev.signUp('class1', 'bea');
  const uid = (await dev.currentUser()).uid;
  await pickIcon(p, 'spark');
  await expect.poll(() => arena.backend.adminGet('players/' + uid).icon, { timeout: 8000 }).toBe('spark');
  // refresh right after a pick, before the debounced save could run: the device copy is newer, so it wins and is saved
  await p.evaluate(k => { localStorage.setItem(k, JSON.stringify({ mute: false, deck: 's20', room: 'mixed', icon: 'wave', iconAt: Date.now() + 60000, iconFor: 'class1_bea' })); }, PKEY);
  await p.reload(); await dev.cloudReady();
  await expect.poll(() => headerIcon(p)).toBe('wave');
  await expect.poll(() => arena.backend.adminGet('players/' + uid).icon, { timeout: 8000 }).toBe('wave');
  // an older device copy loses to the doc
  await p.evaluate(k => { localStorage.setItem(k, JSON.stringify({ mute: false, deck: 's20', room: 'mixed', icon: 'bolt', iconAt: 1000, iconFor: 'class1_bea' })); }, PKEY);
  await p.reload(); await dev.cloudReady();
  await expect.poll(() => headerIcon(p)).toBe('wave');
  // a device copy that belongs to someone else is ignored
  await p.evaluate(k => { localStorage.setItem(k, JSON.stringify({ icon: 'crown', iconAt: Date.now() + 60000, iconFor: 'class1_someoneelse' })); }, PKEY);
  await p.reload(); await dev.cloudReady();
  await expect.poll(() => headerIcon(p)).toBe('wave');
  expect(arena.backend.denials).toEqual([]);
  expect(dev.errors).toEqual([]);
});

test('guest changes the icon on the join screen before joining; the seat carries it and the host sees it with the Guest tag', async ({ arena }) => {
  const host = await arena.device({ width: DESKTOP, fonts: true }), g = await arena.device({ width: PHONE, fonts: true });
  await host.goto('/'); await g.goto('/');
  await host.signUp('period3', 'mrpulido');
  await host.page.evaluate(() => Arcade.setIcon('crown'));
  const code = await hostArena(host);
  const hostUid = (await host.currentUser()).uid;
  expect(arena.backend.adminGet(`matches/${code}/players/${hostUid}`).icon).toBe('crown');

  await openVs(g);
  await expect(g.page.locator('[data-vs="host-details"]')).not.toHaveAttribute('open', /.*/);     // host panel folded for guests
  await g.page.locator('[data-vs="guest-icon"]').click();
  await expect(g.page.locator('[data-vs="icon-picker"] [role="radio"]')).toHaveCount(16);
  await expect(g.page.locator('[data-vs="icon-use"]')).toBeDisabled();
  await g.page.locator('[data-vs="icon-pick"][data-id="rocket"]').click();
  await expect(g.page.locator('[data-vs="icon-pick"][data-id="rocket"]')).toHaveAttribute('aria-checked', 'true');
  expect(await layoutProblems(g.page)).toEqual([]);
  await g.page.screenshot({ path: path.join(OUT, 'vs-join-picker-390.png') });
  await g.page.locator('[data-vs="icon-use"]').click();
  await expect(g.page.locator('[data-vs="icon-picker"]')).toHaveCount(0);
  await expect(g.page.locator('.vs-gname .av')).toHaveAttribute('data-icon', 'rocket');
  expect(await g.currentUser()).toBeNull();                                      // picking signs nothing in
  await g.page.fill('[data-vs="join-code-input"]', code);
  await g.page.screenshot({ path: path.join(OUT, 'vs-join-390.png') });
  await joinByCodeOk(g, code);
  const gUid = (await g.currentUser()).uid;
  expect(arena.backend.adminGet(`matches/${code}/players/${gUid}`)).toMatchObject({ icon: 'rocket', guest: true });
  const row = host.page.locator(`[data-vs="lobby-players"] li[data-uid="${gUid}"]`);
  await expect(row.locator('.av')).toHaveAttribute('data-icon', 'rocket');
  await expect(row).toContainText('Guest');
  await expect(host.page.locator(`[data-vs="lobby-players"] li[data-uid="${hostUid}"] .av`)).toHaveAttribute('data-icon', 'crown');
  // only the host has a /players doc; the guest's icon lives in their browser and their seat
  expect(arena.backend.adminList('players').map(d => d.id)).toEqual([hostUid]);
  expect(await guestIcon(g.page)).toBe('rocket');
  expect(arena.backend.denials).toEqual([]);
  expect(host.errors).toEqual([]); expect(g.errors).toEqual([]);
});

// The profile doc needs the shared Binder rules (they accept icons), so only VS seats keep an old-rules fallback.
test('if the seat rules reject icon (old rules): hosting and guest joins still work, just without icons on the seats', async ({ arena }) => {
  test.setTimeout(90000);
  // Same process as the backend: add an "old rules" clause to the seat writes, and undo it afterwards.
  const { RULES } = await import('../fake/rules.js');
  const noIcon = ['old rules: no icon key', c => !c.inc || !('icon' in c.inc)];
  const saved = RULES.map(r => ({ ...r }));
  for (const r of RULES) {
    if (r.path !== 'matches/{code}/players/{pid}') continue;
    for (const op of ['create', 'update']) {
      const spec = r[op]; if (!spec) continue;
      r[op] = spec[0] && spec[0].clauses ? spec.map(a => ({ name: a.name, clauses: a.clauses.concat([noIcon]) })) : spec.concat([noIcon]);
    }
  }
  try {
    const host = await arena.device({ width: DESKTOP }), g = await arena.device({ width: PHONE });
    await host.goto('/'); await g.goto('/');
    await host.signUp('class1', 'oldrules');
    await pickIcon(host.page, 'bolt');
    expect(await headerIcon(host.page)).toBe('bolt');                               // still shown on this device
    const code = await hostArena(host);
    await openVs(g);
    await g.page.locator('[data-vs="guest-icon"]').click();
    await g.page.locator('[data-vs="icon-pick"][data-id="star"]').click();
    await g.page.locator('[data-vs="icon-use"]').click();
    await joinByCodeOk(g, code);
    const gUid = (await g.currentUser()).uid;
    expect(arena.backend.adminGet(`matches/${code}/players/${gUid}`).icon).toBeUndefined();
    await expect(host.page.locator(`[data-vs="lobby-players"] li[data-uid="${gUid}"] .av`)).toHaveAttribute('data-icon', 'atom');
    expect(arena.backend.denials.every(d => /old rules: no icon key/.test(d.reason))).toBe(true);   // the only denials are the icon ones
    expect(host.errors).toEqual([]); expect(g.errors).toEqual([]);
  } finally {
    RULES.forEach((r, i) => { for (const k of Object.keys(r)) delete r[k]; Object.assign(r, saved[i]); });
  }
});
