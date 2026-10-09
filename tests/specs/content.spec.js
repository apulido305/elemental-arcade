// Content checks: card data, question generators and tile/ability text, run inside the real index.html with Firebase blocked.
import { test, expect } from '../helpers/fixtures.js';

const seeds = n => Array.from({ length: n }, (_, i) => i + 1);

test('C1: ion neutron counts match mass minus atomic number', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(() => {
    const ions = ALL.filter(it => it.cat === 'cat' || it.cat === 'an');
    const bad = ions.filter(it => Number(it.s2v) !== Math.round(parseFloat(it.mass)) - Number(it.zn))
      .map(it => `${it.name}: s2v=${it.s2v} mass=${it.mass} zn=${it.zn}`);
    const want = { 'Silver Ion': 61, 'Copper(I) Ion': 35, 'Copper(II) Ion': 35, 'Zinc Ion': 35, 'Nickel(II) Ion': 31,
      'Barium Ion': 81, 'Lead(II) Ion': 125, 'Tin(II) Ion': 69, 'Bromide Ion': 45 };
    const named = Object.entries(want).map(([n, v]) => {
      const it = ALL.find(x => x.name === n);
      return { n, v, found: !!it, got: it ? Number(it.s2v) : null };
    });
    return { count: ions.length, bad, named };
  });
  expect(res.count, 'there are ion cards to check').toBeGreaterThan(0);
  expect(res.bad, 'every ion: neutrons = round(mass) - atomic number').toEqual([]);
  for (const r of res.named) {
    expect(r.found, `${r.n} is in the collection`).toBe(true);
    expect(r.got, `${r.n} neutrons`).toBe(r.v);
  }
});

test('C2: ability questions have 4 options whenever the pool allows', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(({ decks, seeds }) => {
    const room = roomOf('ability');
    let checked = 0;
    const bad = [];
    for (const d of decks) {
      if (roomPool(room, d).length < 4) continue;
      for (const s of seeds) {
        for (const q of buildRound(d, 'ability', s)) {
          checked++;
          if (q.options.length !== 4) bad.push(`${d}/${s}/${q.cardId}: ${q.options.length} options`);
        }
      }
    }
    return { checked, bad };
  }, { decks: ['cat', 'an', 'all'], seeds: seeds(20) });
  expect(res.checked, 'questions checked').toBeGreaterThan(50);
  expect(res.bad, 'ability questions with a wrong option count').toEqual([]);
});

test('C3: polyatomic shape questions have five distinct shape options with one correct', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(({ shapes, seeds }) => {
    const T = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };
    const badData = DATA.poly.map(x => x.config).filter(c => !shapes.includes(c));
    let checked = 0;
    const bad = [];
    for (const s of seeds) {
      for (const q of buildRound('an', 'config', s)) {
        if (!q.prompt.startsWith('What shape does')) continue;
        checked++;
        const tag = `seed ${s} ${q.cardId}`;
        const texts = q.options.map(T);
        const card = ALL.find(x => x.id === q.cardId);
        if (new Set(texts).size !== texts.length) bad.push(`${tag}: duplicate options ${JSON.stringify(texts)}`);
        if (!texts.every(t => shapes.includes(t))) bad.push(`${tag}: option outside the five shapes ${JSON.stringify(texts)}`);
        if (!(q.correct >= 0 && q.correct < texts.length)) { bad.push(`${tag}: correct index ${q.correct} out of range`); continue; }
        if (!card || texts[q.correct] !== String(card.config).trim()) bad.push(`${tag}: option[correct] ${texts[q.correct]} != ${card && card.config}`);
      }
    }
    return { badData, checked, bad };
  }, { shapes: ['Linear', 'Bent', 'Trigonal planar', 'Trigonal pyramidal', 'Tetrahedral'], seeds: seeds(50) });
  expect(res.badData, 'every DATA.poly config is a known shape').toEqual([]);
  expect(res.checked, 'shape questions checked').toBeGreaterThan(0);
  expect(res.bad, 'shape question problems').toEqual([]);
});

test('C4: element configuration options are all bracket notation or none are', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(({ decks, seeds }) => {
    const T = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };
    let checked = 0;
    const bad = [];
    for (const d of decks) for (const s of seeds) for (const q of buildRound(d, 'config', s)) {
      const card = ALL.find(x => x.id === q.cardId);
      if (!card || card.cat !== 'el') continue;
      checked++;
      const starts = q.options.map(h => T(h).startsWith('['));
      if (starts.some(Boolean) && !starts.every(Boolean)) bad.push(`${d}/${s}/${q.cardId}: ${JSON.stringify(q.options.map(T))}`);
    }
    return { checked, bad };
  }, { decks: ['all', 'e118', 'cat', 'an', 'iso'], seeds: seeds(40) });
  expect(res.checked, 'element configuration questions checked').toBeGreaterThan(0);
  expect(res.bad, 'mixed bracket / plain configuration options').toEqual([]);
});

test('C5: f-block group questions never offer group 3 as a decoy', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(({ seeds }) => {
    const T = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };
    let n = 0;
    const bad = [];
    for (const d of ['e118', 'all']) for (const s of seeds) for (const q of buildRound(d, 'table', s)) {
      if (!q.prompt.startsWith('Which group is')) continue;
      const card = ALL.find(x => x.id === q.cardId);
      if (!card || card.s1v !== 'f-block') continue;
      n++;
      const texts = q.options.map(T);
      if (texts.includes('3')) bad.push(`${d}/${s}/${q.cardId}: ${JSON.stringify(texts)}`);
    }
    return { n, bad };
  }, { seeds: seeds(300) });
  expect(res.n, 'f-block group questions found').toBeGreaterThanOrEqual(5);
  expect(res.bad, 'f-block questions offering 3').toEqual([]);
});

test('C6: state questions have one correct state and state-matched decoys', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(({ seeds }) => {
    const T = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };
    const STATES = ['Solid', 'Liquid', 'Gas'];
    const re = /^Which of these is a (gas|liquid|solid) at room temperature\?$/;
    const out = { s20: { n: 0, bad: [] }, e118: { n: 0, bad: [] } };
    const stateQs = [];
    for (const d of ['s20', 'e118']) for (const s of seeds) for (const q of buildRound(d, 'table', s)) {
      if (q.prompt.startsWith('What state is')) stateQs.push(`${d}/${s}/${q.cardId}`);
      const m = q.prompt.match(re);
      if (!m) continue;
      const word = m[1];
      const r = out[d];
      const tag = `${d}/${s}/${q.cardId}`;
      r.n++;
      const texts = q.options.map(T);
      if (q.options.length !== 4) r.bad.push(`${tag}: ${q.options.length} options`);
      if (!(q.correct >= 0 && q.correct < texts.length)) { r.bad.push(`${tag}: correct index out of range`); continue; }
      if (new Set(texts).size !== texts.length) r.bad.push(`${tag}: duplicate options`);
      const ans = texts[q.correct];
      const ansCard = ALL.find(x => x.name === ans);
      if (!ansCard || String(ansCard.s3v).toLowerCase() !== word) r.bad.push(`${tag}: answer "${ans}" is not a ${word}`);
      texts.filter((_, i) => i !== q.correct).forEach(o => {
        const c = ALL.find(x => x.name === o);
        if (!c || !STATES.includes(c.s3v) || String(c.s3v).toLowerCase() === word) r.bad.push(`${tag}: decoy "${o}" is not a different state card`);
      });
    }
    return { out, stateQs };
  }, { seeds: seeds(60) });
  for (const d of ['s20', 'e118']) {
    expect(res.out[d].n, `${d} state questions found`).toBeGreaterThanOrEqual(10);
    expect(res.out[d].bad, `${d} state question problems`).toEqual([]);
  }
  expect(res.stateQs, 'no "What state is" prompt in Table Map').toEqual([]);
});

test('C7: ability text never gives away the card name, stem or charge', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  // Same logic as tests/specs/_scan.spec.js.
  const leaks = await dev.page.evaluate(() => {
    const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '−': '⁻', '-': '⁻' };
    const out = [];
    for (const it of ALL) {
      const d = document.createElement('div'); d.innerHTML = abox(it); const t = d.textContent.toLowerCase();
      const b = it.name.replace(/ Ion$/, '').replace(/-\d+$/, '');
      const stem = (b.match(/[A-Za-z]+/) || [b])[0].slice(0, 5).toLowerCase();
      const sc = it.post ? it.sym + String(it.post).replace(/[0-9+−-]/g, c => SUP[c]) : null;
      const bad = [];
      if (t.includes(it.name.toLowerCase())) bad.push('name');
      if (t.includes(stem)) bad.push('stem:' + stem);
      if (sc && (d.textContent.includes(sc) || d.textContent.includes(it.sym + it.post))) bad.push('symcharge:' + sc);
      if (bad.length) out.push(it.id + ' ' + it.name + ' | ' + bad.join(',') + ' | ' + d.textContent);
    }
    return out;
  });
  expect(leaks, 'ability boxes leaking the answer').toEqual([]);
});

test('C8: ability names are unique, Phosphide text is clean, no "1 proton/neutron/electron/atom" prompts', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(({ seeds }) => {
    const T = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };
    const byAb = {};
    for (const it of ALL) { if (!it.ability) continue; (byAb[it.ability] ||= new Set()).add(it.id); }
    const dupAb = Object.entries(byAb).filter(([, s]) => s.size > 1).map(([a, s]) => `${a}: ${[...s].join(',')}`);
    const ph = ALL.find(x => x.name === 'Phosphide Ion');
    const pat = /\b1 (protons|neutrons|electrons|atoms)\b/;
    const bad = [];
    let checked = 0;
    const scan = (d, room, s) => {
      for (const q of buildRound(d, room, s)) {
        checked++;
        const e = T(q.exp);
        if (pat.test(e)) bad.push(`${d}/${room}/${s}/${q.cardId}: ${e}`);
      }
    };
    for (const d of ['cat', 'an', 'iso']) for (const s of seeds) scan(d, 'lab', s);
    for (const s of seeds) scan('s20', 'number', s);
    return {
      dupAb,
      phFound: !!ph,
      phHasPoison: !!ph && String(ph.text).toLowerCase().includes('used to poison rodents'),
      phHasOnce: !!ph && String(ph.text).toLowerCase().includes('once'),
      checked, bad
    };
  }, { seeds: seeds(60) });
  expect(res.dupAb, 'ability names shared by two cards').toEqual([]);
  expect(res.phFound, 'Phosphide Ion exists').toBe(true);
  expect(res.phHasPoison, 'Phosphide Ion text mentions rodent poison').toBe(true);
  expect(res.phHasOnce, 'Phosphide Ion text must not contain "once"').toBe(false);
  expect(res.checked, 'lab / number questions checked').toBeGreaterThan(0);
  expect(res.bad, 'questions asking about 1 proton/neutron/electron/atom').toEqual([]);
});

test('C9: isotope tiles show the mass number, not the average atomic mass', async ({ arena }) => {
  const dev = await arena.device({ firebase: 'blocked' });
  await dev.goto('/');
  const res = await dev.page.evaluate(() => {
    const T = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); };
    const isos = ALL.filter(it => it.cat === 'iso');
    const bad = [];
    for (const it of isos) {
      const text = T(tileCore(it));
      if (!text.includes('Mass no. ' + it.pre)) bad.push(`${it.name}: missing "Mass no. ${it.pre}" in "${text}"`);
      if (it.mass && text.includes(String(it.mass))) bad.push(`${it.name}: contains average mass ${it.mass}`);
    }
    const h2 = ALL.find(x => x.name === 'Hydrogen-2');
    const am = ALL.find(x => x.name === 'Americium-241');
    return {
      count: isos.length, bad,
      h2: h2 ? T(tileCore(h2)) : null, am: am ? T(tileCore(am)) : null
    };
  });
  expect(res.count, 'isotope cards found').toBeGreaterThan(0);
  expect(res.bad, 'isotope tile problems').toEqual([]);
  expect(res.h2, 'Hydrogen-2 exists').not.toBeNull();
  expect(res.h2, 'Hydrogen-2 tile').not.toContain('1.008');
  expect(res.am, 'Americium-241 exists').not.toBeNull();
  expect(res.am, 'Americium-241 tile').not.toContain('[243]');
});
