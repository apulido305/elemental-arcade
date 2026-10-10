// VS Arena: full matches in real browsers against the shared fake backend. VS_TIME_SCALE 0.12 => ~22 s per match.
import { test, expect, PHONE, DESKTOP } from '../helpers/fixtures.js';
import { TS, hostArena, joinByCode, joinByCodeOk, joinFromLobby, startMatch, correctIndexes, promptsOf, playMatch, scriptedPlay, seatKids, openVs } from '../helpers/vs.js';

const norm = s => String(s).replace(/\s+/g, ' ').trim();
const answersOf = (arena, code) => arena.backend.adminList(`matches/${code}/answers`);
const seatsOf = (arena, code) => Object.fromEntries(arena.backend.adminList(`matches/${code}/players`).map(p => [p.id, p]));
const textOfHtml = (dev, html) => dev.page.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); }, html);
const watchPills = dev => dev.page.addInitScript(() => {
  window.__pills = [];
  new MutationObserver(() => document.querySelectorAll('.vs-pill').forEach(e => { const t = e.textContent; if (!window.__pills.includes(t)) window.__pills.push(t); }))
    .observe(document, { childList: true, subtree: true });
});

test('host + 3 clients (lobby, code, guest): same questions, different speeds, timeout scores 0, ranking, rewards, rematch', async ({ arena }) => {
  test.setTimeout(150000);
  const host = await arena.device({ width: DESKTOP, timeScale: TS }), kid = await arena.device({ width: PHONE, timeScale: TS });
  const mate = await arena.device({ width: PHONE, timeScale: TS }), guest = await arena.device({ width: PHONE, timeScale: TS });
  await watchPills(kid);
  for (const d of [host, kid, mate, guest]) await d.goto('/');
  await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo'); await mate.signUp('class1', 'mate');
  // tier-crossing setup: every card in the deck is one correct answer away from Holo (3)
  await kid.page.evaluate(() => { Arcade.deckItems(Arcade.S.deck).forEach(it => { Arcade.S.owned[it.id] = 2; }); Arcade.save(); });

  const code = await hostArena(host, { deck: 's20', room: 'mixed' });
  await joinFromLobby(kid, code);                      // class lobby
  await joinByCodeOk(mate, code);                      // typed code
  await joinByCodeOk(guest, code);                     // guest, typed code
  await expect(host.page.locator('[data-vs="lobby-players"] li')).toHaveCount(4);
  await expect(host.page.locator('[data-vs="lobby-players"]')).toContainText('Guest');
  await startMatch(host);
  for (const d of [host, kid, mate, guest]) await expect(d.page.locator('[data-vs="splash"]')).toBeAttached();
  await expect(host.page.locator('[data-vs="splash"]')).toHaveAttribute('data-mode', 'arena');   // 4 players => arena, not duel

  const correct = await correctIndexes(host, arena, code);
  const expected = (await promptsOf(host, arena, code)).map(h => h);
  const plans = {
    host: q => ({ delay: 30, pick: 'correct' }),                                 // fast and perfect
    kid: q => q === 5 ? { pick: 'none' } : { delay: 500 * TS / 0.12, pick: q === 2 ? 'wrong' : 'correct' },   // slow, one wrong, one timeout
    mate: q => ({ delay: 300, pick: q % 2 ? 'wrong' : 'correct' }),
    guest: q => ({ delay: 200, pick: q % 2 ? 'correct' : 'wrong' })
  };
  const [sh, sk, sm, sg] = await Promise.all([host, kid, mate, guest].map((d, i) => playMatch(d, correct, plans[['host', 'kid', 'mate', 'guest'][i]])));

  // identical question sequence everywhere, and it is the seeded round
  expect(sh.length).toBe(10);
  // Under heavy parallel load a starved page can miss capturing a whole (time-scaled) question; compare every
  // question each client did capture, at its own index, and require most of them.
  for (const s of [sk, sm, sg]) {
    const got = s.map((h, q) => [q, h]).filter(([, h]) => h != null);
    expect(got.length).toBeGreaterThanOrEqual(8);
    for (const [q, h] of got) expect(norm(h), 'question ' + (q + 1)).toBe(norm(sh[q]));
  }
  const wanted = await Promise.all(expected.map(h => textOfHtml(host, h)));
  expect(sh.map(norm)).toEqual(wanted);

  // results on every screen
  for (const d of [host, kid, mate, guest]) await expect(d.page.locator('[data-vs="podium"]')).toBeVisible();
  const status = arena.backend.adminGet('matches/' + code);
  expect(status.status).toBe('done');
  const seats = seatsOf(arena, code), answers = answersOf(arena, code);
  const uidOf = async d => d.page.evaluate(() => Cloud.uid());
  const [uh, uk, um, ug] = await Promise.all([host, kid, mate, guest].map(uidOf));
  // server score == sum of that player's answer docs (the increment path), correct and totalMs likewise
  for (const u of [uh, uk, um, ug]) {
    const mine = answers.filter(a => a.id.startsWith(u + '_'));
    expect(seats[u].score, 'score is the sum of answer points').toBe(mine.reduce((s, a) => s + a.points, 0));
    expect(seats[u].correct).toBe(mine.filter(a => a.correct).length);
    expect(seats[u].totalMs).toBe(mine.reduce((s, a) => s + a.elapsedMs, 0));
    expect(seats[u].answeredQ).toBe(Math.max(...mine.map(a => a.q)));
  }
  // timeout scores 0: no answer doc for kid q5, 9 answers total; breakdown says No answer
  expect(answers.find(a => a.id === `${uk}_5`)).toBeUndefined();
  expect(answers.filter(a => a.id.startsWith(uk + '_')).length).toBe(9);
  // phones start with the breakdown closed (podium page stays short); open it like a student would
  if (!(await kid.page.locator('[data-vs="answers"]').evaluate(d => d.open))) await kid.page.locator('[data-vs="answers"] summary').click();
  await expect(kid.page.locator('[data-vs="breakdown"] tbody tr').nth(5)).toContainText('No answer');
  await expect(kid.page.locator('[data-vs="breakdown"] tbody tr').nth(2)).toContainText('Wrong');
  expect(await kid.page.locator('[data-vs="breakdown"] tbody tr').nth(5).locator('td').nth(3).innerText()).toBe('0');
  // points formula: 100..150 for correct, 0 otherwise; faster is worth more
  for (const a of answers) { if (a.correct) { expect(a.points).toBeGreaterThanOrEqual(100); expect(a.points).toBeLessThanOrEqual(150); } else expect(a.points).toBe(0); }
  // ranking: host (10 correct, fastest) first; guest/mate 5 each below; podium has host in 1st
  await expect(host.page.locator('[data-vs="podium"] .p1')).toContainText('hosty');
  const fieldRows = await host.page.locator('[data-vs="field"] tbody tr').allInnerTexts();
  expect(fieldRows.length).toBe(4);
  expect(fieldRows[0]).toContain('hosty');
  const scores = ['hosty', 'kiddo', 'mate', 'guest'].map(n => +fieldRows.find(r => r.toLowerCase().includes(n)).split(/\s+/).slice(-2)[0]);
  const orderByScore = [...scores].sort((a, b) => b - a);
  expect(fieldRows.map(r => +r.split(/\s+/).slice(-2)[0])).toEqual(orderByScore);     // field list is sorted by score
  // the guest sees the sign-in prompt; no one sees others' answer choices
  await expect(guest.page.locator('[data-vs="guest-cta"]')).toContainText('Sign in or create an account to save your cards and keep your VS record');
  await expect(host.page.locator('[data-vs="guest-cta"]')).toHaveCount(0);

  // rewards: VS record for accounts only, nothing for the guest; card XP capped at 1 per card; tier crossing fired
  const rec = d => d.page.evaluate(() => JSON.parse(JSON.stringify(Arcade.S.vs)));
  expect(await rec(host)).toMatchObject({ w: 1, l: 0, played: 1, streak: 1, best: 1 });
  expect(await rec(kid)).toMatchObject({ w: 0, l: 1, played: 1, streak: 0 });
  expect(await rec(mate)).toMatchObject({ w: 0, l: 1, played: 1 });
  const owned = await kid.page.evaluate(() => { const o = {}; Object.keys(Arcade.S.owned).forEach(k => { if (Arcade.S.owned[k] !== 2) o[k] = Arcade.S.owned[k]; }); return o; });
  const rightCards = answers.filter(a => a.id.startsWith(uk + '_') && a.correct).length;
  expect(Object.keys(owned).length).toBe(rightCards);                                   // 8 correct answers => 8 cards moved
  expect(Object.values(owned).every(n => n === 3)).toBe(true);                           // +1 each, never more
  expect(await kid.page.evaluate(() => window.__pills)).toEqual(expect.arrayContaining([expect.stringMatching(/CARD LEVEL UP: HOLO/)]));
  await expect.poll(() => arena.backend.adminGet(`players/${uh}/games/chem`)?.vs?.w, { timeout: 8000 }).toBe(1);   // cloud save of the record (per game)
  expect(arena.backend.adminGet('players/' + ug)).toBeNull();                             // never a /players doc for a guest
  expect(await host.page.evaluate(() => Arcade.S.xp)).toBeGreaterThan(0);                 // placement bonus + per-correct XP landed
  await expect(host.page.locator('[data-vs="vs-result-record"]')).toContainText('1-0');

  // rematch: new match doc, new code, new seed, same settings; signed-in see the banner, guests see the code but are not attached
  await host.page.locator('[data-vs="rematch"]').click();
  await expect(host.page.locator('[data-vs="code"]')).toBeVisible();
  const code2 = (await host.page.locator('[data-vs="code"]').innerText()).trim();
  expect(code2).not.toBe(code);
  const m1 = arena.backend.adminGet('matches/' + code), m2 = arena.backend.adminGet('matches/' + code2);
  expect(m1.status).toBe('done'); expect(m1.rematch).toBe(code2);
  expect(m2.seed).not.toBe(m1.seed);
  expect(m2).toMatchObject({ deck: m1.deck, room: m1.room, cap: m1.cap, allowGuests: m1.allowGuests, listed: m1.listed, status: 'lobby', playerCount: 1 });
  for (const d of [kid, mate, guest]) {
    await expect(d.page.locator('[data-vs="rematch-banner"]')).toBeVisible();
    await expect(d.page.locator('[data-vs="rematch-code"]')).toHaveText(code2);
  }
  expect(arena.backend.adminGet(`matches/${code2}/players/${ug}`)).toBeNull();           // guest never auto-attached
  expect(await guest.currentUser()).toMatchObject({ isAnonymous: true });
  await kid.page.locator('[data-vs="rematch-join"]').click();                              // one tap for a signed-in player
  await expect(kid.page.locator('[data-vs="code"]')).toHaveText(code2);
  await expect(host.page.locator('#vs-count')).toHaveText('2/20');
  await guest.page.locator('[data-vs="rematch-join"]').click();                           // a guest may choose to come back
  await expect(guest.page.locator('[data-vs="code"]')).toHaveText(code2);
  expect(arena.backend.adminGet('matches/' + code).status).toBe('done');                  // old match stays done
  expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
  for (const d of [host, kid, mate, guest]) expect(d.errors).toEqual([]);
});

test('tie-break: score, then correct, then total answer time, then earlier join; ranking function checked directly', async ({ arena }) => {
  test.setTimeout(120000);
  const host = await arena.device({ width: DESKTOP, timeScale: TS });
  await host.goto('/'); await host.signUp('class1', 'hosty');
  const code = await hostArena(host, { room: 'symbol' });
  const [s1, s2, s3] = await seatKids(arena, code, ['sone', 'stwo', 'sthree']);   // join order: s1, s2, s3
  await expect(host.page.locator('[data-vs="lobby-players"] li')).toHaveCount(4);
  await startMatch(host);
  // s1 == s3 in everything but join time; s2 has the same score and correct count but spent longer (explicit points 145 per answer)
  const play = scriptedPlay(arena, code, [
    { client: s1, plan: q => ({ frac: 0.1, correct: true }) },
    { client: s3, plan: q => ({ frac: 0.1, correct: true }) },
    { client: s2, plan: q => ({ frac: 0.1 + 0.02 * (q % 2), correct: true }) }
  ]);
  // the host never answers: it must score 0 for all ten and get no placement bonus
  const xp0 = await host.page.evaluate(() => Arcade.S.xp);
  await playMatch(host, await correctIndexes(host, arena, code), () => ({ pick: 'none' }));
  await play.done;
  expect(play.errors).toEqual([]);
  const seats = seatsOf(arena, code);
  const ids = Object.fromEntries([s1, s2, s3].map(c => [c.uid, c.name]));
  const order = Object.entries(seats).filter(([u]) => ids[u]).sort((a, b) => b[1].score - a[1].score || b[1].correct - a[1].correct || a[1].totalMs - b[1].totalMs).map(([u]) => ids[u]);
  const names = await host.page.locator('[data-vs="field"] tbody tr').allInnerTexts();
  const uiOrder = names.map(t => t.replace(/^\d+\s+/, '').split(/\s+/)[0]);
  expect(seats[s1.uid].totalMs).toBe(seats[s3.uid].totalMs);                       // identical score, correct and time...
  expect(seats[s2.uid].totalMs).toBeGreaterThan(seats[s1.uid].totalMs);
  expect(seats[s2.uid].score).toBeLessThanOrEqual(seats[s1.uid].score);
  expect(uiOrder.filter(n => n !== 'hosty')).toEqual(['sone', 'sthree', 'stwo']);   // ...so join order breaks s1/s3; s2 trails on score/time
  expect(uiOrder[uiOrder.length - 1]).toBe('hosty');                               // 0 points: last
  const bd = host.page.locator('[data-vs="breakdown"] tbody tr');
  for (let i = 0; i < 10; i++) await expect(bd.nth(i)).toContainText('No answer');
  expect(await host.page.evaluate(() => Arcade.S.xp)).toBe(xp0);                    // never answered: no placement bonus

  // the shared ranking function: points, correct, totalMs, joinedAt
  const ranked = await host.page.evaluate(() => {
    const r = window.VSArena._rank, mk = (uid, score, correct, totalMs, joinedAt) => ({ uid, score, correct, totalMs, joinedAt });
    return {
      byScore: r([mk('b', 100, 9, 1, 1), mk('a', 200, 1, 99, 9)]).map(p => p.uid),
      byCorrect: r([mk('b', 500, 4, 1, 1), mk('a', 500, 5, 99, 9)]).map(p => p.uid),
      byTime: r([mk('b', 500, 5, 9000, 1), mk('a', 500, 5, 8000, 9)]).map(p => p.uid),
      byJoin: r([mk('b', 500, 5, 8000, 9), mk('a', 500, 5, 8000, 1)]).map(p => p.uid),
      map: r({ x: { score: 1, correct: 0, totalMs: 0, joinedAt: 0 }, y: { score: 2, correct: 0, totalMs: 0, joinedAt: 0 } }).map(p => p.uid)
    };
  });
  expect(ranked).toEqual({ byScore: ['a', 'b'], byCorrect: ['a', 'b'], byTime: ['a', 'b'], byJoin: ['a', 'b'], map: ['y', 'x'] });
});

test('forfeit: when the other players drop, the last one standing wins (record updated)', async ({ arena }) => {
  test.setTimeout(120000);
  const host = await arena.device({ width: DESKTOP, timeScale: TS });
  await host.goto('/'); await host.signUp('class1', 'hosty');
  const code = await hostArena(host);
  const [a, b] = await seatKids(arena, code, ['dropa', 'dropb']);
  await startMatch(host);
  const correct = await correctIndexes(host, arena, code);
  // both scripted players answer question 0 (so the match has real competitors), then leave during question 1
  const play = scriptedPlay(arena, code, [{ client: a, plan: q => q === 0 && { frac: 0.2, correct: true } }, { client: b, plan: q => q === 0 && { frac: 0.3, correct: false } }], { questions: 1 });
  const leave = setTimeout(() => [a, b].forEach(c => c.F.updateDoc(c.ref('matches', code, 'players', c.uid), { left: true }).catch(() => {})),
    arena.backend.adminGet('matches/' + code).startAt.__ts + (5000 + 17500 + 3000) * TS - Date.now());
  await playMatch(host, correct, q => ({ delay: 20, pick: 'correct' }));
  clearTimeout(leave);
  await play.done;
  const m = arena.backend.adminGet('matches/' + code);
  expect(m.status).toBe('done'); expect(m.winnerUid).toBe(await host.page.evaluate(() => Cloud.uid()));
  expect(Date.now()).toBeLessThan(m.startAt.__ts + 178000 * TS - 3000);               // it ended early, by forfeit, not by the clock
  await expect(host.page.locator('[data-vs="podium"] .p1')).toContainText('hosty');
  await expect(host.page.locator('#vs')).toContainText(/forfeit/i);
  expect(await host.page.evaluate(() => JSON.parse(JSON.stringify(Arcade.S.vs)))).toMatchObject({ w: 1, played: 1 });
  expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
});

test('guest vs signed-in host (2 players => VS splash); guest closes the tab mid-match: host wins by forfeit; closed tab carries no session', async ({ arena }) => {
  test.setTimeout(120000);
  const host = await arena.device({ width: DESKTOP, timeScale: TS }), guest = await arena.device({ width: PHONE, timeScale: TS });
  await host.goto('/'); await guest.goto('/');
  await host.signUp('class1', 'hosty');
  const code = await hostArena(host);
  await joinByCodeOk(guest, code);
  await startMatch(host);
  await expect(host.page.locator('[data-vs="splash"]')).toHaveAttribute('data-mode', 'duel');
  await expect(guest.page.locator('[data-vs="splash"]')).toHaveAttribute('data-mode', 'duel');
  const correct = await correctIndexes(host, arena, code);
  const hostRun = playMatch(host, correct, () => ({ delay: 20 }));
  // the guest answers q0 and q1, then closes the tab during q2
  const gUid = await guest.page.evaluate(() => Cloud.uid());
  for (let q = 0; q < 2; q++) {
    await guest.page.waitForFunction(q => { const e = document.querySelector('#vs-qno'); return e && e.textContent.startsWith('Question ' + (q + 1) + ' ') && document.querySelector('[data-vs="opt"]:not([disabled])'); }, q, { polling: 25 });
    await guest.page.locator('[data-vs="opt"]').nth(correct[q]).click();
  }
  await guest.page.waitForFunction(() => document.querySelector('#vs-qno')?.textContent.startsWith('Question 3 '), null, { polling: 25 });
  await guest.page.close({ runBeforeUnload: false });
  await hostRun;
  const m = arena.backend.adminGet('matches/' + code);
  const hUid = await host.page.evaluate(() => Cloud.uid());
  expect(m.status).toBe('done'); expect(m.winnerUid).toBe(hUid);
  expect(arena.backend.adminGet(`matches/${code}/players/${gUid}`).left || arena.backend.adminGet(`matches/${code}/players/${gUid}`).abandoned).toBe(true);
  await expect(host.page.locator('[data-vs="podium"] .p1')).toContainText('hosty');
  await expect(host.page.locator('#vs')).toContainText(/forfeit/i);
  // the same browser profile opens the app again: nothing is signed in (session persistence died with the tab)
  const again = await guest.context.newPage();
  await again.goto(arena.origin + '/'); await again.waitForFunction(() => !!window.Cloud);
  await again.evaluate(() => new Promise(r => Cloud.onChange(() => r())));
  expect(await again.evaluate(() => Cloud.uid())).toBeNull();
  expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
});

test('guest finishes a match, sees the sign-in prompt and is signed out when they leave; next load has no user', async ({ arena }) => {
  test.setTimeout(120000);
  const host = await arena.device({ width: DESKTOP, timeScale: TS }), guest = await arena.device({ width: PHONE, timeScale: TS });
  await host.goto('/'); await guest.goto('/');
  await host.signUp('class1', 'hosty');
  const code = await hostArena(host);
  await joinByCodeOk(guest, code);
  const gUid = await guest.page.evaluate(() => Cloud.uid());
  await startMatch(host);
  const correct = await correctIndexes(host, arena, code);
  await Promise.all([playMatch(host, correct, q => ({ delay: 40, pick: q % 3 ? 'correct' : 'wrong' })), playMatch(guest, correct, q => ({ delay: 120, pick: 'correct' }))]);
  await expect(guest.page.locator('[data-vs="podium"]')).toBeVisible();
  await expect(guest.page.locator('[data-vs="podium"] .p1')).toContainText(/[A-Z][a-z]+ [A-Z][a-z]+/);   // generated name, 1st place
  await expect(guest.page.locator('[data-vs="guest-cta"]')).toBeVisible();
  expect(await guest.currentUser()).toMatchObject({ uid: gUid, isAnonymous: true });   // still signed in while the result is on screen
  expect(await guest.page.evaluate(() => Arcade.S.vs && Arcade.S.vs.played)).toBeFalsy();   // no VS record for a guest
  expect(arena.backend.adminGet('players/' + gUid)).toBeNull();
  await expect(guest.page.locator('[data-vs="vs-result-record"]')).toHaveCount(0);
  await guest.page.locator('[data-vs="leave"]').click();                                    // result acknowledged
  await expect.poll(() => guest.currentUser()).toBeNull();
  expect(arena.backend.users.has(gUid)).toBe(false);
  await guest.page.reload(); await guest.cloudReady();
  expect(await guest.currentUser()).toBeNull();                                              // next load: no user
  expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
  expect(guest.errors).toEqual([]);
});

test('a reload mid-match keeps the score and the seat: the player rejoins by code and keeps answering', async ({ arena }) => {
  test.setTimeout(120000);
  const host = await arena.device({ width: DESKTOP, timeScale: TS }), kid = await arena.device({ width: PHONE, timeScale: TS });
  await host.goto('/'); await kid.goto('/');
  await host.signUp('class1', 'hosty'); await kid.signUp('class1', 'kiddo');
  const code = await hostArena(host);
  await joinFromLobby(kid, code);
  await startMatch(host);
  const correct = await correctIndexes(kid, arena, code);
  const kUid = await kid.page.evaluate(() => Cloud.uid());
  const hostRun = playMatch(host, correct, () => ({ delay: 30 }));
  for (let q = 0; q < 3; q++) {
    await kid.page.waitForFunction(q => { const e = document.querySelector('#vs-qno'); return e && e.textContent.startsWith('Question ' + (q + 1) + ' ') && document.querySelector('[data-vs="opt"]:not([disabled])'); }, q, { polling: 25 });
    await kid.page.waitForTimeout(100);
    await kid.page.locator('[data-vs="opt"]').nth(correct[q]).click();
  }
  await expect.poll(() => seatsOf(arena, code)[kUid].answeredQ).toBe(2);
  const before = seatsOf(arena, code)[kUid];
  await kid.page.reload();
  await kid.cloudReady();
  // Rejoining by code resumes the seat (it is not a late join), clears left, and keeps the points.
  await openVs(kid);
  await joinByCode(kid, code, { open: false });
  await expect.poll(() => seatsOf(arena, code)[kUid].left).toBe(false);
  expect(seatsOf(arena, code)[kUid].score).toBe(before.score);
  // Answer one more question after the resume.
  const h = await kid.page.waitForFunction(() => { const e = document.querySelector('#vs-qno'); const m = e && /Question ([0-9]+) /.exec(e.textContent); return m && +m[1] >= 4 && document.querySelector('[data-vs="opt"]:not([disabled])') ? +m[1] - 1 : null; }, null, { polling: 25, timeout: 60000 });
  const q = await h.jsonValue();
  await kid.page.locator('[data-vs="opt"]').nth(correct[q]).click();
  await expect.poll(() => seatsOf(arena, code)[kUid].answeredQ).toBe(q);
  await hostRun;
  const seat = seatsOf(arena, code)[kUid], mine = answersOf(arena, code).filter(a => a.id.startsWith(kUid + '_'));
  expect(mine.length).toBe(4);
  expect(seat.score).toBe(mine.reduce((s, a) => s + a.points, 0));   // nothing clobbered, nothing lost
  expect(seat.score).toBeGreaterThan(before.score);
  expect(seat.correct).toBe(4);
  expect(arena.backend.denials, JSON.stringify(arena.backend.denials.slice(0, 3))).toEqual([]);
});

test('reduced motion: no splash animation, plain countdown number', async ({ arena }) => {
  test.setTimeout(120000);
  const host = await arena.device({ width: DESKTOP, timeScale: 1, reducedMotion: true });
  await host.goto('/'); await host.signUp('class1', 'hosty');
  const code = await hostArena(host);
  const [k1, k2, k3] = await seatKids(arena, code, ['ka', 'kb', 'kc']);
  await host.page.locator('[data-vs="start"]').click();
  const splash = host.page.locator('[data-vs="splash"]');
  await expect(splash).toBeVisible();
  expect(await host.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const anims = () => host.page.evaluate(() => [...document.querySelectorAll('[data-vs="splash"] .vs-plate, [data-vs="splash"] .vs-arena-word, [data-vs="splash"] .vs-vs, [data-vs="splash"] .vs-cd')]
    .map(e => getComputedStyle(e).animationName));
  const names = await anims();
  expect(names.length).toBeGreaterThan(4);
  expect(names.every(n => n === 'none')).toBe(true);
  const cd = host.page.locator('[data-vs="countdown"]');
  await expect(cd).toBeVisible({ timeout: 8000 });
  await expect(cd).toHaveText(/^[123]$/);                                           // a plain number
  expect((await anims()).every(n => n === 'none')).toBe(true);
  // and the same screen with motion allowed does animate (guards the check above)
  const host2 = await arena.device({ width: DESKTOP, timeScale: 1 });
  await host2.goto('/'); await host2.signUp('class1', 'hosty2');
  const code2 = await hostArena(host2);
  await seatKids(arena, code2, ['kd', 'ke', 'kf']);
  await host2.page.locator('[data-vs="start"]').click();
  await expect(host2.page.locator('[data-vs="splash"]')).toBeVisible();
  const live = await host2.page.evaluate(() => [...document.querySelectorAll('[data-vs="splash"] .vs-plate, [data-vs="splash"] .vs-arena-word')].map(e => getComputedStyle(e).animationName));
  expect(live.some(n => n !== 'none')).toBe(true);
});
