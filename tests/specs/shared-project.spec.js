// Elemental on the shared Binder (binder.js; Cell Arcade's design/binder-spec.md). One Firebase project (elemental-arc),
// one account and one Binder for every arcade game:
// - accounts: Elemental's original accounts still sign in; accounts made in Cell Arcade sign in here; sign-up finds an
//   existing account instead of making a second one;
// - saving: games/chem plus the profile, the pre-Binder 'progress' map mirrored (never dropped), games/bio untouched;
// - cross-game: Cell Arcade icons and packs work here; VS arenas stay in their own game; cards.json; guest migration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { expectDenied } from '../helpers/arena.js';
import { openVs, hostArena, joinByCode, errorText } from '../helpers/vs.js';
import { B, binderFor, cellAccount } from '../helpers/cell.js';
import { cardsText, buildCards } from '../../tools/export-cards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** An Elemental account made before the Binder: legacy email scheme, one doc holding 'progress'. Signed out; returns uid. */
async function legacyAccount(arena, cls, nick, pin, progress, icon) {
  const c = arena.client('legacy-' + nick);
  const u = await c.legacySignUp(cls, nick, pin, progress, icon);
  await c.signOut();
  return { client: c, uid: u.uid };
}
/** Sign in through the account screen with the class code (no /names claim yet, so it is asked once). */
async function signInWithClass(dev, cls, nick, pin) {
  const p = dev.page;
  await p.click('[data-act="account"]');
  await p.fill('#f-nick', nick); await p.fill('#f-pin', pin);
  await p.click('#authform button[type="submit"]');
  await expect(p.locator('#authform')).toContainText(/add your class code/i);
  await p.fill('#f-cls', cls);
  await p.click('#authform button[type="submit"]');
  await expect(p.locator('[data-act="account"]')).toContainText(nick, { ignoreCase: true });
}
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
const S = (page, ...keys) => page.evaluate(ks => Object.fromEntries(ks.map(k => [k, JSON.parse(JSON.stringify(Arcade.S[k]))])), keys);

test.describe('accounts', () => {
  test('an account made the old way (legacy scheme, progress map) still signs in, nickname + PIN after the first time, and keeps its cards', async ({ arena }) => {
    const { uid } = await legacyAccount(arena, 'class1', 'ada', '4321', { owned: { el1: 4, el6: 2 }, xp: 250, unlocked: ['cat'], packLog: ['vs:ABCDEF'] }, 'cat');
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    await signInWithClass(dev, 'class1', 'ada', '4321');
    expect((await dev.currentUser()).uid).toBe(uid);                                      // the same account, not a new one
    expect(await S(p, 'owned', 'xp', 'icon', 'unlocked')).toEqual({ owned: { el1: 4, el6: 2 }, xp: 250, icon: 'cat', unlocked: ['cat'] });
    await expect.poll(() => arena.backend.adminGet('names/ada')).toMatchObject({ cls: 'class1', uid });   // the nickname is claimed now
    await p.evaluate(() => Cloud.signOut());
    await dev.signIn('ada', '4321');                                                      // nickname + PIN only from now on
    expect((await dev.currentUser()).uid).toBe(uid);
    expect(arena.backend.denials).toEqual([]);
    expect(dev.errors).toEqual([]);
  });

  test('an account made in Cell Arcade (Binder scheme) signs in here, with its XP and Cell Arcade icon', async ({ arena }) => {
    const { uid } = await cellAccount(arena, 'class2', 'bo', '1111', { owned: { 'bio:org1': 3 }, xp: 120, unlocked: ['bio:frog'] }, 'bio:frog');
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    await signInWithClass(dev, 'class2', 'bo', '1111');
    expect((await dev.currentUser()).uid).toBe(uid);
    expect(await S(p, 'xp', 'icon', 'owned')).toEqual({ xp: 120, icon: 'bio:frog', owned: {} });   // no Elemental cards yet
    await expect(p.locator('[data-act="icons"] .av')).toHaveAttribute('data-icon', 'bio:frog');
    await expect.poll(() => arena.backend.adminGet('names/bo')).toMatchObject({ cls: 'class2', uid });   // the rules accept the Binder scheme's claim
    expect(arena.backend.denials).toEqual([]);
    expect(dev.errors).toEqual([]);
  });

  test('sign-up with an existing legacy account and the same PIN signs in to it instead of making a second account', async ({ arena }) => {
    const { uid } = await legacyAccount(arena, 'class1', 'cy', '5555', { owned: { el3: 1 }, xp: 40 });
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    await p.click('[data-act="account"]');
    await expect(p.locator('[data-ui="every-game"]')).toContainText('One account works in every arcade game: Elemental Arcade and Cell Arcade.');
    await p.click('[data-act="authtab"][data-id="up"]');
    await p.fill('#f-cls', 'class1'); await p.fill('#f-nick', 'cy'); await p.fill('#f-pin', '5555');
    await p.click('#authform button[type="submit"]');
    await expect(p.locator('[data-act="account"]')).toContainText('cy');
    await expect(p.locator('#toast')).toContainText('You already have an account');
    expect((await dev.currentUser()).uid).toBe(uid);
    expect([...arena.backend.users.values()].filter(u => !u.anonymous)).toHaveLength(1);
    expect(await S(p, 'owned')).toEqual({ owned: { el3: 1 } });
    expect(dev.errors).toEqual([]);
  });

  test('a new account uses the shared Binder scheme and writes the profile, games/chem and the nickname claim', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE });
    await dev.goto('/');
    await dev.signUpViaUI('class1', 'dee', '2468');
    const u = await dev.currentUser();
    expect(u.email).toBe(B.accountEmail('class1', 'dee'));
    expect(arena.backend.adminGet('players/' + u.uid)).toMatchObject({ nick: 'dee', cls: 'class1', level: 1, icon: 'atom' });
    expect(arena.backend.adminGet('players/' + u.uid).progress).toBeUndefined();
    expect(arena.backend.adminGet(`players/${u.uid}/games/chem`)).toMatchObject({ owned: {}, rounds: 0 });
    expect(arena.backend.adminGet('names/dee')).toMatchObject({ cls: 'class1', uid: u.uid });
    // a claim for a nickname or class that is not the caller's own is refused, in either scheme
    const c = arena.client('mallory'); await c.signUp('class1', 'mallory');
    await expectDenied(c.F.setDoc(c.ref('names', 'zed'), { cls: 'class1', uid: c.uid }), 'auth email');
    await expectDenied(c.F.setDoc(c.ref('names', 'mallory'), { cls: 'class9', uid: c.uid }), 'auth email');
    expect(dev.errors).toEqual([]);
  });
});

test.describe('saving through the Binder', () => {
  test('after a round: cards in games/chem, XP and unlocks on the profile, the old progress map mirrored and kept; games/bio never changes', async ({ arena }) => {
    const { client, uid } = await legacyAccount(arena, 'class1', 'eve', '1234', { owned: { el1: 2 }, xp: 100, unlocked: ['cat'], packLog: ['vs:ABCDEF'] }, 'cat');
    // the same student played Cell Arcade too (its doc and a Cell Arcade unlock)
    await client.signIn('class1', 'eve').catch(() => {});                                 // Binder scheme: no such account
    await client.A.signInWithEmailAndPassword(client.auth, B.LEGACY_SCHEMES[0].email('class1', 'eve'), B.LEGACY_SCHEMES[0].pass('1234', 'class1'));
    const cell = binderFor(client); await cell.loadBinder(uid);
    cell.saveGame('bio', { owned: { 'bio:org1': 2 }, stars: { 'codon|aa': 1 }, rounds: 1, xp: 130, unlocked: ['cat', 'bio:frog'] }); await cell.flush();
    await client.signOut();
    const bioBefore = arena.backend.adminGet(`players/${uid}/games/bio`);
    expect(bioBefore.owned).toEqual({ 'bio:org1': 2 });

    const dev = await arena.device({ width: DESKTOP }), p = dev.page;
    await dev.goto('/');
    await signInWithClass(dev, 'class1', 'eve', '1234');
    expect(await S(p, 'xp', 'unlocked')).toEqual({ xp: 130, unlocked: ['cat', 'bio:frog'] });   // Cell Arcade's XP and unlock count here
    await soloRound(p);
    await p.evaluate(() => Binder.flush());
    await expect.poll(() => arena.backend.adminGet(`players/${uid}/games/chem`)?.rounds, { timeout: 8000 }).toBe(1);
    const chem = arena.backend.adminGet(`players/${uid}/games/chem`), prof = arena.backend.adminGet('players/' + uid);
    expect(chem.owned.el1).toBeGreaterThanOrEqual(2);                                     // the old cards came along
    expect(Object.keys(chem.owned).length).toBeGreaterThan(1);
    expect(prof.xp).toBeGreaterThan(130);
    expect(prof.level).toBe(B.levelOf(prof.xp));
    expect(prof.unlocked).toEqual(expect.arrayContaining(['cat', 'bio:frog']));
    expect(prof.icon).toBe('cat');
    // the pre-Binder map stays (old cached pages may still save into it), with the account half mirrored in
    expect(prof.progress.owned).toEqual({ el1: 2 });
    expect(prof.progress.xp).toBe(prof.xp);
    expect(prof.progress.unlocked).toEqual(expect.arrayContaining(['cat', 'bio:frog']));
    expect(arena.backend.adminGet(`players/${uid}/games/bio`)).toEqual(bioBefore);        // saving chem never touches bio
    expect(arena.backend.denials).toEqual([]);
    expect(dev.errors).toEqual([]);
  });

  test('a pre-Binder Elemental save landing in between (it rewrites the whole doc) loses nothing', async ({ arena }) => {
    const { client, uid } = await legacyAccount(arena, 'class1', 'fay', '1234', { owned: { el1: 1 }, xp: 10, unlocked: ['cat'] }, 'cat');
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    await signInWithClass(dev, 'class1', 'fay', '1234');
    await p.evaluate(() => { Arcade.S.unlocked.push('dog'); Arcade.S.xp += 50; Arcade.save(); });
    await p.evaluate(() => Binder.flush());
    await expect.poll(() => arena.backend.adminGet('players/' + uid).unlocked, { timeout: 8000 }).toContain('dog');
    // an old cached copy of Elemental saves: read, merge 'progress' (max / union), rewrite the WHOLE doc
    await client.A.signInWithEmailAndPassword(client.auth, B.LEGACY_SCHEMES[0].email('class1', 'fay'), B.LEGACY_SCHEMES[0].pass('1234', 'class1'));
    const ref = client.ref('players', uid), d = (await client.F.getDoc(ref)).data();
    await client.F.setDoc(ref, { progress: Object.assign({}, d.progress, { owned: { el1: 1, el2: 1 }, xp: d.progress.xp + 5 }), nick: d.nick, cls: d.cls, icon: 'atom', updated: client.F.serverTimestamp() });
    expect(arena.backend.adminGet('players/' + uid).unlocked).toBeUndefined();            // gone from the top level...
    await p.reload(); await dev.cloudReady();
    const s = await S(p, 'xp', 'unlocked', 'owned');
    expect(s.unlocked).toEqual(expect.arrayContaining(['cat', 'dog']));                  // ...but mirrored in progress, so nothing is lost
    expect(s.xp).toBe(65);
    expect(s.owned.el2).toBe(1);
    expect(arena.backend.denials).toEqual([]);
    expect(dev.errors).toEqual([]);
  });
});

test.describe('cross-game', () => {
  test('an icon unlocked in Cell Arcade shows in the picker and is never reset to atom (its art falls back to a monogram)', async ({ arena }) => {
    const { uid } = await cellAccount(arena, 'class1', 'gus', '1234', { owned: { 'bio:org1': 1 }, xp: 30, unlocked: ['bio:frog', 'bio:owl-gold'] }, 'bio:frog');
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    await signInWithClass(dev, 'class1', 'gus', '1234');
    await expect(p.locator('[data-act="icons"] .av')).toHaveAttribute('data-icon', 'bio:frog');
    await expect(p.locator('[data-act="icons"] .av')).toHaveClass(/mono/);               // the art is another site's; here it 404s
    await p.locator('[data-act="icons"]').click();
    const ids = await p.locator('[data-act="icon-pick"]').evaluateAll(els => els.map(e => e.dataset.id));
    expect(ids.slice(0, 16)).toEqual(['atom', 'bolt', 'beaker', 'crystal', 'flame', 'droplet', 'magnet', 'moon', 'star', 'comet', 'rocket', 'flask', 'crown', 'shield', 'spark', 'wave']);
    expect(ids.slice(16)).toEqual(['bio:frog', 'bio:owl-gold']);                         // other games' icons, then gold
    await expect(p.locator('[data-act="icon-pick"][data-id="bio:frog"]')).toHaveAttribute('aria-checked', 'true');
    await expect(p.locator('[data-act="icon-pick"][data-id="bio:owl-gold"]')).toHaveAttribute('aria-label', 'Gold Owl');
    await p.locator('[data-act="icon-cancel"]').click();
    await soloRound(p);
    await p.evaluate(() => Binder.flush());
    await expect.poll(() => arena.backend.adminGet(`players/${uid}/games/chem`)?.rounds, { timeout: 8000 }).toBe(1);
    expect(arena.backend.adminGet('players/' + uid).icon).toBe('bio:frog');               // not reset on save
    expect(await p.evaluate(() => Arcade.S.icon)).toBe('bio:frog');
    expect(arena.backend.denials).toEqual([]);
    expect(dev.errors).toEqual([]);
  });

  test('a pack earned in Cell Arcade (bio icons, a bio finish) opens here, even without its cards.json', async ({ arena }) => {
    const pack = { id: 'gold:bio:org1', at: Date.now(), reason: 'gold', cardId: 'bio:org1', cardName: 'Nucleus', game: 'bio', seed: 1, week: 1,
      slots: [{ kind: 'finish', card: 'bio:org1', finish: 'foil', name: 'Nucleus', src: 'finish' }, { kind: 'icon', icon: 'bio:frog', src: 'b0' }, { kind: 'gold', icon: 'bio:owl-gold', src: 'gold' }] };
    const { uid } = await cellAccount(arena, 'class1', 'hal', '1234', { owned: { 'bio:org1': 15 }, packs: [pack], packLog: ['gold:bio:org1'] });
    const dev = await arena.device({ width: PHONE, reducedMotion: true }), p = dev.page;
    await dev.goto('/');
    await signInWithClass(dev, 'class1', 'hal', '1234');
    await expect(p.locator('[data-ui="pack-badge"]')).toHaveText('1');
    await p.locator('.iconbtn[data-act="binder"]').click();
    await expect(p.locator('[data-act="pack-open"]')).toContainText('Earned: Nucleus reached Gold Legend');
    await p.locator('[data-act="pack-open"]').click();
    await p.locator('[data-pk="tear"]').click();
    await expect(p.locator('.pkcard.up')).toHaveCount(3);
    expect(await p.locator('.pkcard').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))).toEqual(['Foil finish for Nucleus', 'Frog, Common icon', 'Gold Owl, gold icon']);
    await expect(p.locator('.pkcard').first()).toContainText('Nucleus');
    await p.locator('[data-pk="done"]').click();
    expect(await S(p, 'unlocked', 'finishes', 'finishOn', 'packs')).toEqual({ unlocked: ['bio:frog', 'bio:owl-gold'], finishes: { 'bio:org1': ['foil'] }, finishOn: { 'bio:org1': 'foil' }, packs: [] });
    await p.evaluate(() => Binder.flush());
    await expect.poll(() => arena.backend.adminGet('players/' + uid).packLog, { timeout: 8000 }).toContain('open:gold:bio:org1');
    expect(arena.backend.adminGet('players/' + uid).packs).toEqual([]);
    expect(arena.backend.denials).toEqual([]);
    expect(dev.errors).toEqual([]);
  });

  test('packs earned here say which game rolled them and name the card', async ({ arena }) => {
    const dev = await arena.device({ firebase: 'blocked' }), p = dev.page;
    await dev.goto('/');
    const pk = await p.evaluate(() => { Arcade.S.owned.el1 = 3; Arcade.earnPack('gold', 'el1'); return Arcade.S.packs[0]; });
    expect(pk).toMatchObject({ game: 'chem', cardId: 'el1', cardName: 'Hydrogen' });
    const fin = await p.evaluate(() => Arcade.rollPack(7, 1, { icons: new Set(), fin: new Set(), cards: ['el1'] }).concat(Arcade.rollPack(8, 1, { icons: new Set(), fin: new Set(), cards: ['el1'] })).filter(x => x.kind === 'finish'));
    fin.forEach(x => expect(x.name).toBe('Hydrogen'));
    expect(await p.evaluate(() => [...new Set(Array.from({ length: 300 }, (_, i) => Arcade.rollPack(i, 1, { icons: new Set(), fin: new Set(), cards: ['el1'] })).flat().filter(x => x.icon).map(x => Binder.iconGame(x.icon)))])).toEqual(['chem']);   // rolls only Elemental's icons
  });
});

test.describe('VS Arena across games', () => {
  test('new matches carry game chem; the class lobby hides a Cell Arcade arena; its code is refused before anything is written', async ({ arena }) => {
    test.setTimeout(90000);
    const host = await arena.device({ width: DESKTOP }), kid = await arena.device({ width: PHONE }), g = await arena.device({ width: PHONE });
    for (const d of [host, kid, g]) await d.goto('/');
    await host.signUp('class1', 'hosty');
    const code = await hostArena(host);
    expect(arena.backend.adminGet('matches/' + code).game).toBe('chem');
    // a Cell Arcade arena in the same class
    const bioHost = arena.client('biohost'); await bioHost.signUp('class1', 'bioboss');
    const bioCode = await bioHost.createMatch({ game: 'bio', deck: 's20', room: 'function' });
    await kid.signUp('class1', 'kiddo');
    await openVs(kid);
    await expect(kid.page.locator(`[data-vs="lobby-join"][data-code="${code}"]`)).toBeVisible();
    await expect(kid.page.locator(`[data-vs="lobby-join"][data-code="${bioCode}"]`)).toHaveCount(0);
    // join by code: refused with the other game's name, and no seat written (signed in, then as a guest)
    const msg = 'That code is for an arena in Cell Arcade. Open Cell Arcade to join it.';
    await joinByCode(kid, bioCode, { open: false });
    await expect(errorText(kid)).toHaveText(msg);
    await joinByCode(g, bioCode);
    await expect(errorText(g)).toHaveText(msg);
    expect(await g.currentUser()).toBeNull();                                               // the guest sign-in was undone
    expect(arena.backend.adminList(`matches/${bioCode}/players`).map(d => d.id)).toEqual([bioHost.uid]);
    expect(arena.backend.adminGet('matches/' + bioCode).playerCount).toBe(1);
    expect(host.errors).toEqual([]); expect(kid.errors).toEqual([]); expect(g.errors).toEqual([]);
  });
});

test.describe('cards.json and guests', () => {
  test('cards.json matches the page: unprefixed ids, n = atomic number for elements, tag = mass', async ({ arena }) => {
    expect(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8'), 'run: node tools/export-cards.mjs').toBe(cardsText());
    const j = buildCards();
    expect(j).toMatchObject({ game: 'chem', title: 'Elemental Arcade', version: 1, cats: B.GAMES.chem.cats });
    const dev = await arena.device({ firebase: 'blocked' });
    await dev.goto('/');
    const page = await dev.page.evaluate(() => Arcade.ALL.map(c => ({ id: c.id, z: c.zn, mass: c.mass, name: c.name })));
    expect(j.cards.map(c => c.id)).toEqual(page.map(c => c.id));
    j.cards.forEach((c, i) => {
      expect(c.id).toMatch(/^(el|cat|an|poly|iso)\d+$/);
      expect(c.name).toBe(page[i].name);
      if (c.cat === 'el') { expect(c.n).toBe(page[i].z); expect(c.tag).toBe(page[i].mass); }
      else expect(c.n).toBe(+c.id.slice(c.cat.length));
      expect(c.cfgl).toBeTruthy();
      expect(j.themes[c.family], c.family).toBeTruthy();
    });
  });

  test('a pre-Binder guest save moves into the shared store (merged with Cell Arcade\'s guest data); sign-up brings this game\'s part', async ({ arena }) => {
    const dev = await arena.device({ width: PHONE }), p = dev.page;
    await dev.goto('/');
    await p.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('elemental-arcade-v1', JSON.stringify({ owned: { el1: 3 }, miss: { el2: 1 }, xp: 60, stars: { 'mixed|s20': 2 }, rounds: 2, best: 4, vs: { w: 0, l: 0, streak: 0, best: 0, played: 0 }, vsAt: 0,
        unlocked: ['cat'], packs: [], finishes: {}, finishOn: {}, packLog: ['vs:ZZZZZZ'], icon: 'cat', iconAt: 5, mute: true, deck: 'r4', room: 'symbol', qn: 15 }));
      localStorage.setItem('arcade-v1', JSON.stringify({ profile: { xp: 40, unlocked: ['bio:frog'], icon: 'bio:frog', iconAt: 3 }, games: { bio: { owned: { 'bio:org1': 2 } } } }));
    });
    await p.reload(); await dev.cloudReady();
    const st = await p.evaluate(() => ({ old: localStorage.getItem('elemental-arcade-v1'), all: Binder.guestAll(), prefs: JSON.parse(localStorage.getItem('arcade-v1-prefs:chem')), deck: Arcade.S.deck, qn: Arcade.S.qn }));
    expect(st.old).toBeNull();
    expect(st.all.games.chem).toMatchObject({ owned: { el1: 3 }, miss: { el2: 1 }, stars: { 'mixed|s20': 2 }, rounds: 2, best: 4 });
    expect(st.all.games.bio).toEqual({ owned: { 'bio:org1': 2 } });
    expect(st.all.profile).toMatchObject({ xp: 60, icon: 'cat', packLog: ['vs:ZZZZZZ'] });
    expect(st.all.profile.unlocked.sort()).toEqual(['bio:frog', 'cat']);
    expect(st.prefs).toEqual({ mute: true, deck: 'r4', room: 'symbol', qn: 15 });
    expect([st.deck, st.qn]).toEqual(['r4', 15]);
    // sign up: this game's cards plus the account half come along; Cell Arcade's guest cards stay on the device
    await dev.signUpViaUI('class1', 'ivy', '1234');
    const uid = (await dev.currentUser()).uid;
    expect(arena.backend.adminGet(`players/${uid}/games/chem`).owned).toEqual({ el1: 3 });
    expect(arena.backend.adminGet('players/' + uid)).toMatchObject({ xp: 60, icon: 'cat' });
    expect(arena.backend.adminGet('players/' + uid).unlocked.sort()).toEqual(['bio:frog', 'cat']);
    const left = await p.evaluate(() => Binder.guestAll());
    expect(left.games.chem).toBeUndefined();
    expect(left.games.bio).toEqual({ owned: { 'bio:org1': 2 } });
    expect(dev.errors).toEqual([]);
  });
});
