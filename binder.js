/* The Binder: one student account whose card collection holds a deck from every arcade game.
   SHARED FILE. Every game (Elemental Arcade, Cell Arcade, and later ones) ships this exact file. Do not edit it in one
   repo only: change it, bump BINDER_VERSION, and copy it to every game. design/binder-spec.md is the contract.

   A classic script (not a module) so a game's inline script can read it synchronously. It sets window.Binder in a
   browser and globalThis.Binder in Node (the tests load it the same way).

   What it owns:
   - The game registry (GAMES) and icon sets (ICON_SETS): ids, labels, bands, where each game's art lives.
   - The shared account scheme: {cls}_{nick}@players.arcade.example, password {pin}-{cls}-arcade. No game name.
   - The Firestore layout: /players/{uid} (profile, account-wide) and /players/{uid}/games/{gameId} (one game's progress).
   - Merging (max for counts, union for unlocks and packLog, newer side wins for the VS streak and the icon).
   - Debounced saving (1.2 s) of the current game's progress, split between the profile and the game doc.
   - Guest storage in localStorage under 'arcade-v1', keyed by game (all games on one origin share it).
   It does not import Firebase: cloud.js loads the SDK and hands it over with Binder.init({F, db}). */
(function (root) {
  'use strict';
  const BINDER_VERSION = 4;

  // ---------- registry ----------
  // id: short game id, also the card-id prefix ('bio:org3') and the icon-id prefix ('bio:frog').
  // Elemental ('chem') predates the Binder: its card ids ('el1') and icon ids ('cat') carry no prefix, and keep none
  // (legacyIds). Its accounts and saves live in the same Firebase project (elemental-arc is the hub), see LEGACY below.
  const GAMES = {
    chem: { id: 'chem', title: 'Elemental Arcade', short: 'Elemental', subject: 'Chemistry', color: '#f3dd7a',
      url: 'https://apulido305.github.io/elemental-arcade/', legacyIds: true,
      cats: [['el', 'Elements'], ['cat', 'Cations'], ['an', 'Anions'], ['poly', 'Polyatomic'], ['iso', 'Isotopes']] },
    bio: { id: 'bio', title: 'Cell Arcade', short: 'Cell', subject: 'Biology', color: '#5fd38a',
      url: 'https://apulido305.github.io/cell-arcade/',
      cats: [['org', 'Cell Parts'], ['mol', 'Biomolecules'], ['aa', 'Amino Acids'], ['life', 'Tree of Life'], ['sys', 'Human Body'], ['eco', 'Ecology']] }
  };
  Object.keys(GAMES).forEach(k => { GAMES[k].cardsUrl = GAMES[k].url + 'cards.json'; });
  let CURRENT = null;
  // A game calls this once at startup with its own entry. cardsUrl/url may be relative for the current game.
  function registerGame(g) {
    if (!g || !g.id) throw new Error('registerGame needs an id');
    GAMES[g.id] = Object.assign({}, GAMES[g.id] || {}, g);
    if (!GAMES[g.id].cardsUrl) GAMES[g.id].cardsUrl = 'cards.json';
    CURRENT = g.id;
    return GAMES[g.id];
  }
  const current = () => CURRENT;

  // ---------- profile icons (account-wide) ----------
  // free: always available in every game. pack: [id, label, band 0..3] (Common, Uncommon, Rare, Epic), only from packs.
  // Every free and pack icon also has a gold version '{id}-gold' (packs only). Art: {game url}img/icons/{name}.webp and
  // img/icons/gold/{name}.webp, where name is the id without its game prefix. Elemental's free icons are inline SVGs in
  // its own page (see spec, "Migration"), so other games show them from img/icons/{name}.webp once Elemental adds those.
  const BANDS = ['Common', 'Uncommon', 'Rare', 'Epic'];
  const ICON_SETS = {
    chem: {
      free: [['atom', 'Atom'], ['bolt', 'Bolt'], ['beaker', 'Beaker'], ['crystal', 'Crystal'], ['flame', 'Flame'], ['droplet', 'Droplet'], ['magnet', 'Magnet'], ['moon', 'Moon'],
        ['star', 'Star'], ['comet', 'Comet'], ['rocket', 'Rocket'], ['flask', 'Flask'], ['crown', 'Crown'], ['shield', 'Shield'], ['spark', 'Spark'], ['wave', 'Wave']],
      pack: [['boba', 'Boba', 0], ['camera', 'Camera', 0], ['cat', 'Cat', 0], ['dice', 'Dice', 0], ['dog', 'Dog', 0], ['donut', 'Donut', 0], ['pizza', 'Pizza', 0], ['note', 'Music Note', 0],
        ['sneaker', 'Sneaker', 0], ['headphones', 'Headphones', 0], ['soccer', 'Soccer Ball', 0], ['hoop', 'Hoop', 0], ['cactus', 'Cactus', 0], ['shades', 'Shades', 0], ['bulb', 'Light Bulb', 0], ['skateboard', 'Skateboard', 0],
        ['boombox', 'Boombox', 1], ['controller', 'Controller', 1], ['vinyl', 'Vinyl', 1], ['guitar', 'Guitar', 1], ['fox', 'Fox', 1], ['panda', 'Panda', 1], ['plane', 'Plane', 1], ['rainbow', 'Rainbow', 1], ['joystick', 'Joystick', 1], ['trophy', 'Trophy', 1],
        ['robot', 'Robot', 2], ['planet', 'Planet', 2], ['axolotl', 'Axolotl', 2], ['ufo', 'UFO', 2], ['volcano', 'Volcano', 2], ['chest', 'Treasure Chest', 2],
        ['dragon', 'Dragon', 3], ['dino', 'Dino', 3]]
    },
    bio: {
      free: [['bio:cell', 'Cell'], ['bio:dna', 'DNA'], ['bio:leaf', 'Leaf'], ['bio:microscope', 'Microscope'], ['bio:mito', 'Mitochondrion'], ['bio:petri', 'Petri Dish'], ['bio:heart', 'Heart'], ['bio:neuron', 'Neuron'],
        ['bio:sprout', 'Sprout'], ['bio:mushroom', 'Mushroom'], ['bio:paw', 'Paw Print'], ['bio:feather', 'Feather'], ['bio:seashell', 'Seashell'], ['bio:bee', 'Bee'], ['bio:eye', 'Eye'], ['bio:bone', 'Bone']],
      pack: [['bio:ladybug', 'Ladybug', 0], ['bio:frog', 'Frog', 0], ['bio:turtle', 'Turtle', 0], ['bio:snail', 'Snail', 0], ['bio:butterfly', 'Butterfly', 0], ['bio:succulent', 'Succulent', 0], ['bio:acorn', 'Acorn', 0], ['bio:sunflower', 'Sunflower', 0],
        ['bio:penguin', 'Penguin', 0], ['bio:owl', 'Owl', 0], ['bio:starfish', 'Starfish', 0], ['bio:bunny', 'Bunny', 0], ['bio:hedgehog', 'Hedgehog', 0], ['bio:ant', 'Ant', 0], ['bio:clover', 'Clover', 0], ['bio:crab', 'Crab', 0],
        ['bio:jellyfish', 'Jellyfish', 1], ['bio:octopus', 'Octopus', 1], ['bio:chameleon', 'Chameleon', 1], ['bio:koala', 'Koala', 1], ['bio:sloth', 'Sloth', 1], ['bio:hummingbird', 'Hummingbird', 1], ['bio:seahorse', 'Seahorse', 1], ['bio:mantis', 'Mantis', 1], ['bio:flytrap', 'Flytrap', 1], ['bio:coral', 'Coral', 1],
        ['bio:tardigrade', 'Tardigrade', 2], ['bio:narwhal', 'Narwhal', 2], ['bio:whale', 'Whale', 2], ['bio:peacock', 'Peacock', 2], ['bio:firefly', 'Firefly', 2], ['bio:anglerfish', 'Anglerfish', 2],
        ['bio:mammoth', 'Mammoth', 3], ['bio:megalodon', 'Megalodon', 3]]
    }
  };
  const FREE_ICONS = [], PACK_ICONS = [], ICON_META = {};
  Object.keys(ICON_SETS).forEach(g => {
    ICON_SETS[g].free.forEach(([id, label]) => { FREE_ICONS.push(id); ICON_META[id] = { id, label, game: g, free: true, band: -1 }; });
    ICON_SETS[g].pack.forEach(([id, label, band]) => { PACK_ICONS.push(id); ICON_META[id] = { id, label, game: g, free: false, band }; });
  });
  const GOLD_ICONS = FREE_ICONS.concat(PACK_ICONS).map(id => id + '-gold');
  const UNLOCKABLE = PACK_ICONS.concat(GOLD_ICONS);          // what progress 'unlocked' may hold
  const isGold = id => typeof id === 'string' && id.slice(-5) === '-gold' && !!ICON_META[id.slice(0, -5)];
  const baseOf = id => (isGold(id) ? id.slice(0, -5) : id);
  const iconKnown = id => !!ICON_META[baseOf(id)] && (isGold(id) || typeof id === 'string');
  const iconGame = id => (iconKnown(id) ? ICON_META[baseOf(id)].game : null);
  const iconName = id => baseOf(id).replace(/^[a-z]+:/, '');
  const iconLabel = id => (iconKnown(id) ? (isGold(id) ? 'Gold ' : '') + ICON_META[baseOf(id)].label : '');
  const iconBand = id => (iconKnown(id) ? ICON_META[baseOf(id)].band : -1);
  // Image path for any game's icon. The current game's icons are relative; another game's come from its site.
  function iconSrc(id) {
    if (!iconKnown(id)) return '';
    const g = iconGame(id), base = g === CURRENT ? '' : ((GAMES[g] && GAMES[g].url) || '');
    return base + 'img/icons/' + (isGold(id) ? 'gold/' : '') + iconName(id) + '.webp';
  }
  const iconOwned = (id, unlocked) => FREE_ICONS.includes(id) || (Array.isArray(unlocked) && unlocked.includes(id));

  // ---------- account scheme ----------
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const EMAIL_DOMAIN = 'players.arcade.example';
  const accountEmail = (cls, nick) => norm(cls) + '_' + norm(nick) + '@' + EMAIL_DOMAIN;
  const accountPass = (pin, cls) => String(pin) + '-' + norm(cls) + '-arcade';
  const whoFromEmail = email => { const [cls, nick] = String(email || '').split('@')[0].split('_'); return { cls, nick }; };
  // LEGACY: Elemental's original scheme. Students who made an account in Elemental before the Binder keep it: sign-in
  // tries the Binder scheme first, then this one, so the same class code, nickname and PIN work in every game.
  const LEGACY_SCHEMES = [{ game: 'chem', email: (cls, nick) => norm(cls) + '_' + norm(nick) + '@players.elemental-arcade.example', pass: (pin, cls) => String(pin) + '-' + norm(cls) + '-elemental' }];
  // [{email, pass, legacy}] in the order to try: the Binder scheme, then each legacy scheme.
  const accountCandidates = (cls, nick, pin) => [{ email: accountEmail(cls, nick), pass: accountPass(pin, cls), legacy: null }]
    .concat(LEGACY_SCHEMES.map(l => ({ email: l.email(cls, nick), pass: l.pass(pin, cls), legacy: l.game })));

  // ---------- data shapes ----------
  // Account-wide (profile doc, guest 'profile'): XP and level, the icon, and everything packs touch.
  const ACCOUNT_KEYS = ['xp', 'unlocked', 'finishes', 'finishOn', 'packs', 'packLog'];
  // Per game (games/{gameId} doc, guest 'games'[gameId]): what this game's binder, rooms and VS record need.
  const GAME_KEYS = ['owned', 'miss', 'stars', 'rounds', 'best', 'vs', 'vsAt'];
  // The rules also accept these legacy keys in a game doc (Elemental's PROG shape), so a migration can copy a whole
  // Elemental save in. loadBinder folds them into the profile; saveGame never writes them to a game doc.
  const GAME_LEGACY_KEYS = ['packs', 'finishes', 'finishOn', 'unlocked', 'packLog'];
  const PROFILE_KEYS = ['nick', 'cls', 'icon', 'xp', 'level', 'updated'].concat(ACCOUNT_KEYS.filter(k => k !== 'xp'));
  const VS0 = () => ({ w: 0, l: 0, streak: 0, best: 0, played: 0 });
  const emptyGame = () => ({ owned: {}, miss: {}, stars: {}, rounds: 0, best: 0, vs: VS0(), vsAt: 0 });
  const emptyAccount = () => ({ xp: 0, unlocked: [], finishes: {}, finishOn: {}, packs: [], packLog: [] });
  // Level from XP: level L needs 100*L XP to clear. Same curve in every game, so the level is account-wide too.
  function levelOf(xp) { let L = 1, x = +xp || 0; while (x >= 100 * L) { x -= 100 * L; L++; } return L; }
  const pick = (o, ks) => { const r = {}; ks.forEach(k => { if (o && o[k] !== undefined) r[k] = o[k]; }); return r; };
  // A game's whole in-memory progress (Elemental's S) split into the two halves the Binder stores.
  const splitProgress = p => ({ game: Object.assign(emptyGame(), pick(p, GAME_KEYS)), account: Object.assign(emptyAccount(), pick(p, ACCOUNT_KEYS)) });
  const joinProgress = (game, account) => Object.assign(emptyGame(), pick(game, GAME_KEYS), emptyAccount(), pick(account, ACCOUNT_KEYS));

  // ---------- merging (pure) ----------
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const maxObj = (a, b) => { const o = Object.assign({}, isObj(a) ? a : {}); if (isObj(b)) for (const k in b) o[k] = Math.max(o[k] || 0, b[k] || 0); return o; };
  const uni = (a, b) => Array.from(new Set([].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [])));
  // VS record: counts take the larger side; the streak is not a count, so it comes from the side that finished a VS
  // match most recently (larger vsAt). Never summed.
  function mergeVs(a, b) {
    a = a || {}; b = b || {};
    const mx = k => Math.max((a.vs && a.vs[k]) || 0, (b.vs && b.vs[k]) || 0);
    const newer = (b.vsAt || 0) > (a.vsAt || 0) ? b : a;
    return { w: mx('w'), l: mx('l'), streak: (newer.vs && newer.vs.streak) || 0, best: mx('best'), played: mx('played') };
  }
  function mergeGame(a, b) {
    a = a || {}; b = b || {};
    return { owned: maxObj(a.owned, b.owned), miss: maxObj(a.miss, b.miss), stars: maxObj(a.stars, b.stars),
      rounds: Math.max(a.rounds || 0, b.rounds || 0), best: Math.max(a.best || 0, b.best || 0),
      vs: mergeVs(a, b), vsAt: Math.max(a.vsAt || 0, b.vsAt || 0) };
  }
  const mergeFin = (a, b) => { const o = {}; [a, b].forEach(m => { if (isObj(m)) for (const k in m) o[k] = uni(o[k], m[k]); }); return o; };
  // Unopened packs: the union by id, minus any pack either side opened ('open:' + id in packLog).
  function mergePacks(a, b, log) {
    const out = [], seen = new Set();
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(p => {
      if (p && p.id && !seen.has(p.id) && !log.includes('open:' + p.id)) { seen.add(p.id); out.push(p); }
    });
    return out;
  }
  // Account half. b is this device: its shown finish wins per card.
  function mergeAccount(a, b) {
    a = a || {}; b = b || {};
    const packLog = uni(a.packLog, b.packLog);
    return { xp: Math.max(a.xp || 0, b.xp || 0), unlocked: uni(a.unlocked, b.unlocked).filter(id => UNLOCKABLE.includes(id)),
      finishes: mergeFin(a.finishes, b.finishes), finishOn: Object.assign({}, isObj(a.finishOn) ? a.finishOn : {}, isObj(b.finishOn) ? b.finishOn : {}),
      packs: mergePacks(a.packs, b.packs, packLog), packLog };
  }
  const toMs = v => (v == null ? 0 : typeof v === 'number' ? v : typeof v.toMillis === 'function' ? v.toMillis() : (v.seconds != null ? v.seconds * 1000 : 0));
  // Icon: an id, never markup. A pick made on this device after the doc was last written (local.iconAt > doc.updated)
  // wins; otherwise the doc keeps its icon. The result must be free or unlocked, else fallback.
  function mergeIcon(doc, local, unlocked, fallback) {
    doc = doc || {}; local = local || {};
    const ok = id => (iconKnown(id) && iconOwned(id, unlocked) ? id : null);
    const docIcon = ok(doc.icon), localIcon = ok(local.icon);
    if (localIcon && (!docIcon || (local.iconAt || 0) > toMs(doc.updated))) return localIcon;
    return docIcon || localIcon || fallback || null;
  }
  // Account-wide data can also sit in two legacy places: pack keys in a game doc (a migrated Elemental save, or the copy
  // of unopened packs kept there during the transition), and the 'progress' map of a pre-Binder Elemental player doc.
  // All of it folds into the account half.
  function foldLegacy(profile, games) {
    let acc = pick(profile, ACCOUNT_KEYS);
    if (isObj(profile && profile.progress)) acc = mergeAccount(acc, pick(profile.progress, ACCOUNT_KEYS));
    Object.keys(games || {}).forEach(g => { const leg = pick(games[g], GAME_LEGACY_KEYS); if (Object.keys(leg).length) acc = mergeAccount(acc, leg); });
    return acc;
  }
  // A pre-Binder Elemental player doc keeps Elemental's progress in 'progress': that is Elemental's game doc.
  function legacyGames(profile, games) {
    const out = Object.assign({}, games || {});
    if (isObj(profile && profile.progress)) out.chem = mergeGame(pick(out.chem || {}, GAME_KEYS), pick(profile.progress, GAME_KEYS));
    return out;
  }
  /* TRANSITION (until every game saves through the Binder): pre-Binder Elemental writes its whole player doc as
     {progress, nick, cls, icon, updated}, which erases the profile's top-level keys. So while a doc has 'progress':
     - the account half is mirrored into progress (xp, unlocked, finishes, finishOn, packLog), which Elemental merges
       and keeps (max for xp, unions for the rest), so Elemental also sees XP and the daily-pack claim;
     - unopened packs are copied into the saving game's own doc (Elemental never touches it), because Elemental's pack
       screen cannot open another game's packs;
     - the 'progress' map itself is never dropped.
     loadBinder folds all of it back together. design/binder-spec.md, "Sharing elemental-arc". */
  function mirrorLegacy(progress, acc) {
    return Object.assign({}, progress, {
      xp: Math.max(+progress.xp || 0, acc.xp || 0), unlocked: uni(progress.unlocked, acc.unlocked).filter(id => UNLOCKABLE.includes(id)),
      finishes: mergeFin(progress.finishes, acc.finishes), finishOn: Object.assign({}, isObj(progress.finishOn) ? progress.finishOn : {}, acc.finishOn || {}),
      packLog: uni(progress.packLog, acc.packLog)
    });
  }

  // ---------- guests (localStorage, no account) ----------
  const GUEST_KEY = 'arcade-v1';
  let STORE = null;
  const store = () => { if (STORE) return STORE; try { return root.localStorage || null; } catch (e) { return null; } };
  function guestAll() {
    try { const s = store(); const raw = s && s.getItem(GUEST_KEY); if (raw) { const g = JSON.parse(raw); if (isObj(g)) return { profile: isObj(g.profile) ? g.profile : {}, games: isObj(g.games) ? g.games : {} }; } } catch (e) { /* blocked or corrupt */ }
    return { profile: {}, games: {} };
  }
  // This game's progress joined with the account half, plus the guest's icon.
  function guestLoad(gameId) {
    const all = guestAll(), p = all.profile;
    return Object.assign(joinProgress(all.games[gameId] || {}, p), { icon: p.icon || null, iconAt: +p.iconAt || 0 });
  }
  // The account half is shared by every game on this origin, and two games can be open in two tabs at once, so it is
  // merged with what is stored (as the cloud does), never overwritten. This game's own blob is written as is (only this
  // game writes it, and Review Room clears must be able to lower a miss count). The icon: the later pick wins.
  function guestSave(gameId, progress, meta) {
    const all = guestAll(), sp = splitProgress(progress || {}), was = all.profile;
    all.games[gameId] = sp.game;
    const icon = meta && meta.icon && (+meta.iconAt || 0) >= (+was.iconAt || 0) ? { icon: meta.icon, iconAt: +meta.iconAt || 0 } : pick(was, ['icon', 'iconAt']);
    const acc = mergeAccount(pick(was, ACCOUNT_KEYS), sp.account);
    // finishOn: this game may turn its own cards' finish off (drop the key); other games' entries are kept.
    const mine = k => (GAMES[gameId] && GAMES[gameId].legacyIds) ? k.indexOf(':') < 0 : k.indexOf(gameId + ':') === 0;
    acc.finishOn = Object.assign({}, ...Object.keys(acc.finishOn).filter(k => !mine(k) || k in sp.account.finishOn).map(k => ({ [k]: acc.finishOn[k] })));
    all.profile = Object.assign({}, was, acc, icon);
    try { const s = store(); if (s) s.setItem(GUEST_KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked */ }
  }
  function guestClear(gameId) {
    const all = guestAll(); delete all.games[gameId];
    // the account half moves with the game that signed up (it is account-wide); other games keep their cards
    all.profile = pick(all.profile, ['icon', 'iconAt']);
    try { const s = store(); if (s) s.setItem(GUEST_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }
  const guestCount = gameId => { const g = guestAll().games[gameId]; return g && isObj(g.owned) ? Object.keys(g.owned).filter(k => g.owned[k] > 0).length : 0; };

  // ---------- cloud (an instance per Firebase connection; tests make several) ----------
  function createBinder(env) {
    const { F, db } = env;
    const statusCbs = [];
    const setStatus = s => statusCbs.forEach(cb => { try { cb(s); } catch (e) { /* ignore */ } });
    const CACHE_MS = 120000;
    let cache = null;                       // {uid, at, profile, games: {id: data}}
    const pending = {};                     // gameId -> {progress, meta}
    let timer = null, uidNow = null, who = null;
    const pref = uid => F.doc(db, 'players', uid), gref = (uid, g) => F.doc(db, 'players', uid, 'games', g);

    async function loadBinder(uid) {
      const [ps, gs] = await Promise.all([F.getDoc(pref(uid)), F.getDocs(F.collection(db, 'players', uid, 'games'))]);
      const profile = ps.exists() ? ps.data() : null, games = {};
      gs.forEach(d => { games[d.id] = d.data(); });
      cache = { uid, at: Date.now(), profile, games };
      const acc = foldLegacy(profile || {}, games), all = legacyGames(profile, games);
      const out = { profile: profile ? Object.assign({}, profile, acc, { level: levelOf(acc.xp) }) : null, games: {} };
      if (out.profile) delete out.profile.progress;
      Object.keys(all).forEach(g => { out.games[g] = Object.assign(emptyGame(), pick(all[g], GAME_KEYS)); });
      return out;
    }
    // Who is saving: set by cloud.js after sign-in ({uid, nick, cls}); null after sign-out.
    function setUser(u) { if (!u || u.uid !== uidNow) cache = null; uidNow = u ? u.uid : null; who = u ? { nick: u.nick, cls: u.cls } : null; }

    async function flush() {
      const ids = Object.keys(pending);
      if (!ids.length || !uidNow) return;
      const uid = uidNow, jobs = ids.map(g => [g, pending[g]]);
      ids.forEach(g => delete pending[g]);
      setStatus('saving');
      try {
        if (!cache || cache.uid !== uid || Date.now() - cache.at > CACHE_MS) await loadBinder(uid);
        // The profile is shared by every game, and another game (or device) may have written it since the cache was
        // filled, so it is re-read inside a transaction on every save. A game doc is written only by its own game, so
        // the cached copy is good enough there (as in Elemental: max/union merges make a stale copy harmless).
        const wrote = {};
        let out;
        await F.runTransaction(db, async tx => {
          const ps = await tx.get(pref(uid));
          const prof = ps.exists() ? ps.data() : {};
          let acc = foldLegacy(prof, cache.games), icon = prof.icon || null;
          const legacy = isObj(prof.progress);
          const sps = jobs.map(([g, job]) => [g, job, splitProgress(job.progress)]);
          sps.forEach(([g, job, sp]) => { acc = mergeAccount(acc, sp.account); icon = mergeIcon(prof, job.meta, acc.unlocked, icon); });
          for (const [g, , sp] of sps) {
            const game = mergeGame(pick(cache.games[g] || {}, GAME_KEYS), sp.game);
            if (legacy) game.packs = acc.packs;   // transition: unopened packs also live where pre-Binder Elemental cannot erase them
            tx.set(gref(uid, g), Object.assign({}, game, { updated: F.serverTimestamp() }));
            wrote[g] = game;
          }
          out = Object.assign({ nick: prof.nick || (who && who.nick), cls: prof.cls || (who && who.cls) }, acc, { level: levelOf(acc.xp), updated: F.serverTimestamp() });
          if (icon) out.icon = icon;
          if (legacy) out.progress = mirrorLegacy(prof.progress, acc);
          tx.set(pref(uid), out);
        });
        cache.profile = Object.assign({}, out, { updated: Date.now() });
        Object.keys(wrote).forEach(g => { cache.games[g] = wrote[g]; });
        cache.at = Date.now();
        setStatus('saved');
      } catch (e) {
        cache = null;
        jobs.forEach(([g, job]) => { if (!pending[g]) pending[g] = job; });
        setStatus('offline');
      }
    }
    // progress: the game's whole in-memory progress (game keys plus xp, unlocked, finishes, finishOn, packs, packLog).
    // meta: {icon, iconAt} (iconAt = when the icon was picked on this device, 0 if not picked here).
    function saveGame(gameId, progress, meta) {
      pending[gameId] = { progress: JSON.parse(JSON.stringify(progress || {})), meta: meta || null };
      clearTimeout(timer); timer = setTimeout(flush, 1200);
    }
    // Account creation: profile plus this game's doc in one batch (guest progress brought in, if any).
    async function createAccount(uid, ident, gameId, progress, icon) {
      const sp = splitProgress(progress || {});
      const b = F.writeBatch(db);
      const profile = Object.assign({ nick: norm(ident.nick), cls: norm(ident.cls) }, sp.account, { level: levelOf(sp.account.xp), updated: F.serverTimestamp() });
      const ic = mergeIcon(null, { icon, iconAt: 1 }, sp.account.unlocked, null);
      if (ic) profile.icon = ic;
      b.set(pref(uid), profile);
      b.set(gref(uid, gameId), Object.assign({}, sp.game, { updated: F.serverTimestamp() }));
      await b.commit();
      cache = { uid, at: Date.now(), profile: Object.assign({}, profile, { updated: Date.now() }), games: { [gameId]: sp.game } };
      return { profile: cache.profile, game: sp.game };
    }
    // Nickname -> class code (/names/{nick}), so a game can sign in with nickname + PIN only. A missing name (an account
    // made before the lookup) means the student types the class code once; signing in then claims it. Never throws.
    const nameRef = n => F.doc(db, 'names', norm(n));
    async function lookupCls(nick) { try { const s = await F.getDoc(nameRef(nick)); return s.exists() ? s.data().cls : null; } catch (e) { return null; } }
    const claimed = new Set();
    async function claimName(user) {
      if (!user || user.isAnonymous || !user.email || claimed.has(user.uid)) return;
      claimed.add(user.uid);
      const { cls, nick } = whoFromEmail(user.email);
      try { if (!(await F.getDoc(nameRef(nick))).exists()) await F.setDoc(nameRef(nick), { cls, uid: user.uid }); } catch (e) { /* taken, or offline */ }
    }
    return { loadBinder, saveGame, flush, setUser, createAccount, lookupCls, claimName, onStatus: cb => statusCbs.push(cb), _cache: () => cache };
  }

  /* Sign-up guard against duplicate accounts. A pre-Binder account (legacy scheme) has no /names claim and a different
     email from the Binder scheme, so neither the name lookup nor Firebase would stop a second account with the same
     class code and nickname. Firebase will not say whether an email exists (email enumeration protection), so this
     tries to CREATE the legacy email with a random password: 'email-already-in-use' means taken; success means free,
     and that throwaway user is deleted at once. A: the firebase-auth module (needs createUserWithEmailAndPassword and
     deleteUser). Leaves no one signed in. Throws on network errors, like the sign-up it guards. */
  async function legacyTaken(A, auth, cls, nick) {
    for (const l of LEGACY_SCHEMES) {
      const pass = 'probe-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      let cred;
      try { cred = await A.createUserWithEmailAndPassword(auth, l.email(cls, nick), pass); }
      catch (e) { if (/email-already-in-use/.test(String(e && e.code))) return true; throw e; }
      for (let t = 0; t < 3; t++) { try { await A.deleteUser(cred.user); break; } catch (e) { /* retry */ } }
    }
    return false;
  }

  // Card data of any game (its published cards.json), cached per page. Resolves null when unreachable.
  const CARDS = {};
  function loadCards(gameId) {
    const g = GAMES[gameId]; if (!g) return Promise.resolve(null);
    if (!CARDS[gameId]) CARDS[gameId] = (typeof fetch === 'function' ? fetch(g.cardsUrl, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)) : Promise.resolve(null)).catch(() => null)
      .then(j => { if (!j) delete CARDS[gameId]; return j; });
    return CARDS[gameId];
  }

  // Default instance: cloud.js calls Binder.init({F, db}) once the SDK is loaded.
  let DEF = null;
  const need = () => { if (!DEF) throw new Error('Binder.init({F, db}) has not run'); return DEF; };
  const api = {
    BINDER_VERSION, GAMES, registerGame, current,
    ICON_SETS, BANDS, FREE_ICONS, PACK_ICONS, GOLD_ICONS, UNLOCKABLE, ICON_META, isGold, baseOf, iconKnown, iconGame, iconName, iconLabel, iconBand, iconSrc, iconOwned,
    norm, EMAIL_DOMAIN, accountEmail, accountPass, whoFromEmail, LEGACY_SCHEMES, accountCandidates, legacyGames, mirrorLegacy,
    ACCOUNT_KEYS, GAME_KEYS, GAME_LEGACY_KEYS, PROFILE_KEYS, VS0, emptyGame, emptyAccount, levelOf, splitProgress, joinProgress,
    mergeGame, mergeAccount, mergeVs, mergeIcon, foldLegacy, toMs,
    GUEST_KEY, guestAll, guestLoad, guestSave, guestClear, guestCount, _setStorage: s => { STORE = s; },
    loadCards,
    legacyTaken,
    createBinder,
    init(env) { DEF = createBinder(env); return DEF; },
    loadBinder: uid => need().loadBinder(uid),
    saveGame: (g, p, m) => need().saveGame(g, p, m),
    flush: () => (DEF ? DEF.flush() : Promise.resolve()),
    setUser: u => need().setUser(u),
    createAccount: (...a) => need().createAccount(...a),
    lookupCls: n => (DEF ? DEF.lookupCls(n) : Promise.resolve(null)),
    claimName: u => (DEF ? DEF.claimName(u) : Promise.resolve()),
    onStatus: cb => need().onStatus(cb)
  };
  root.Binder = api;
})(typeof window !== 'undefined' ? window : globalThis);
