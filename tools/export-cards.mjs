// Export this game's card data as cards.json (design/binder-spec.md in Cell Arcade, "cards.json"), so the Binder shelf in
// every other arcade game can show Elemental's cards. Reads the card data section of index.html (no build step: the page
// stays the source of truth) and runs it in a sandbox.
//   node tools/export-cards.mjs          (writes cards.json)
//   node tools/export-cards.mjs --check  (exit 1 if cards.json is out of date; tests/specs/binder-elemental.spec.js checks too)
// Card ids stay unprefixed ('el1', legacyIds). n: the atomic number for elements, the position in its category for the
// rest. tag: the tile's bottom line (the atomic mass; "Mass no. 4" for an isotope, as Elemental's own tile shows it).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = ['id', 'cat', 'n', 'kind', 'name', 'family', 'pre', 'sym', 'post', 'ability', 'text', 's1l', 's1v', 's2l', 's2v', 's3l', 's3v', 'cfgl', 'config', 'tag'];
const START = '/* ---------- card data', END = '/* ---------- profile icons';

/** The page's data as {game, title, version, cats, themes, cards}. */
export function buildCards() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error('index.html: card data section markers not found');
  createRequire(import.meta.url)(path.join(ROOT, 'binder.js'));
  const ctx = vm.createContext({ Binder: globalThis.Binder, console });
  vm.runInContext(html.slice(a, b) + '\n;this.__out={GAME,CATS,THEMES,ALL};', ctx);
  const { GAME, CATS, THEMES, ALL } = ctx.__out;
  const g = globalThis.Binder.GAMES[GAME];
  const used = new Set(ALL.map(c => c.family));
  const themes = {}; Object.keys(THEMES).filter(k => used.has(k)).forEach(k => { themes[k] = THEMES[k]; });
  const card = c => Object.assign({}, c, {
    n: c.cat === 'el' ? c.zn : parseInt(String(c.id).slice(c.cat.length), 10),
    cfgl: c.cfgl || 'Electron configuration',
    tag: c.cat === 'iso' ? 'Mass no. ' + c.pre : c.mass
  });
  return { game: GAME, title: g.title, version: 1, cats: CATS, themes,
    cards: ALL.map(card).map(c => { const o = {}; FIELDS.forEach(k => { o[k] = c[k] == null ? '' : c[k]; }); return o; }) };
}
export const cardsText = () => JSON.stringify(buildCards(), null, 1) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(ROOT, 'cards.json'), next = cardsText(), cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (process.argv.includes('--check')) { if (cur !== next) { console.error('cards.json is out of date: run node tools/export-cards.mjs'); process.exit(1); } console.log('ok'); }
  else { fs.writeFileSync(file, next); console.log((cur === next ? 'unchanged: ' : 'wrote ') + 'cards.json (' + buildCards().cards.length + ' cards)'); }
}
