// Stand-ins for Cell Arcade (the biology sibling on the same Firebase project and the same Binder) in Elemental's tests:
// a few of its published cards (cards.json) and accounts made the way Cell Arcade makes them (binder.js, game 'bio').
import { createRequire } from 'node:module';

createRequire(import.meta.url)('../../binder.js');
export const B = globalThis.Binder;

// Four real cards from Cell Arcade's cards.json (an organelle, two amino acids, an organism).
export const BIO_CARDS = {
  game: 'bio', title: 'Cell Arcade', version: 1,
  cats: [['org', 'Cell Parts'], ['mol', 'Biomolecules'], ['aa', 'Amino Acids'], ['life', 'Tree of Life'], ['sys', 'Human Body'], ['eco', 'Ecology']],
  themes: {
    Bacteria: { dark: '#1f5f8b', mid: '#3a8fc9', light: '#9fd0f0', tint: '#e4f3fc' },
    Organelle: { dark: '#5b3a8c', mid: '#8e6bc4', light: '#c9b6ea', tint: '#f0eaf9' },
    Nonpolar: { dark: '#3f566e', mid: '#7f9bb8', light: '#c3d1e0', tint: '#e9eff5' },
    Polar: { dark: '#0b6283', mid: '#2aa6cf', light: '#9ad8ec', tint: '#e2f4fa' }
  },
  cards: [
    { id: 'bio:org1', cat: 'org', n: 1, kind: 'Cell Part', name: 'Nucleus', family: 'Organelle', pre: '', sym: 'Nu', post: '', ability: 'Command Center',
      text: "Holds the cell's DNA and directs which proteins get made. Wrapped in a double envelope with pores.",
      s1l: 'Found in', s1v: 'Both', s2l: 'Membrane', s2v: 'Double', s3l: 'Job', s3v: 'Control', cfgl: 'Structure', config: 'Envelope, pores, chromatin, nucleolus', tag: '~6 µm' },
    { id: 'bio:aa1', cat: 'aa', n: 1, kind: 'Amino Acid', name: 'Glycine', family: 'Nonpolar', pre: '', sym: 'Gly', post: 'G', ability: 'Tiny Hinge',
      text: 'Smallest of the 20: its side chain is a single hydrogen, so chains can bend sharply.',
      s1l: 'Polarity', s1v: 'Nonpolar', s2l: 'Charge', s2v: 'Neutral', s3l: 'Codons', s3v: '4', cfgl: 'Codons (mRNA)', config: 'GGU GGC GGA GGG', tag: 'Mass 75 Da' },
    { id: 'bio:aa12', cat: 'aa', n: 12, kind: 'Amino Acid', name: 'Cysteine', family: 'Polar', pre: '', sym: 'Cys', post: 'C', ability: 'Bridge Builder',
      text: 'Has a sulfur atom. Two of them link into disulfide bridges that lock proteins like keratin in shape.',
      s1l: 'Polarity', s1v: 'Polar', s2l: 'Charge', s2v: 'Neutral', s3l: 'Codons', s3v: '2', cfgl: 'Codons (mRNA)', config: 'UGU UGC', tag: 'Mass 121 Da' },
    { id: 'bio:life1', cat: 'life', n: 1, kind: 'Bacterium', name: 'E. coli', family: 'Bacteria', pre: '', sym: 'Ec', post: '', ability: 'Gut Resident',
      text: 'Rod-shaped bacterium in your intestines. Most strains are harmless and even make vitamin K.',
      s1l: 'Domain', s1v: 'Bacteria', s2l: 'Kingdom', s2v: 'Eubacteria', s3l: 'Cell type', s3v: 'Prokaryote', cfgl: 'Scientific name', config: 'Escherichia coli', tag: '~2 µm' }
  ]
};
/** Serve the stub as Cell Arcade's published cards.json (registered after the fixture's 404 for apulido305.github.io). */
export const serveBio = context => context.route(B.GAMES.bio.cardsUrl, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(BIO_CARDS) }));

/** A Binder instance on a scripted client (one game on one device), as cloud.js sets it up. */
export function binderFor(client) {
  const b = B.createBinder({ F: client.F, db: client.db });
  b.setUser({ uid: client.uid, nick: client.nick, cls: client.cls });
  return b;
}
/** An account made in Cell Arcade: the Binder scheme, a profile plus games/bio, and no /names claim (Cell Arcade makes none).
 *  Signed out afterwards; returns {client, uid}. */
export async function cellAccount(arena, cls, nick, pin = '1234', progress = {}, icon = 'bio:cell') {
  const c = arena.client('cell-' + nick);
  await c.A.setPersistence(c.auth, c.A.browserLocalPersistence);
  await c.A.createUserWithEmailAndPassword(c.auth, B.accountEmail(cls, nick), B.accountPass(pin, cls));
  c.cls = B.norm(cls); c.nick = B.norm(nick);
  await B.createBinder({ F: c.F, db: c.db }).createAccount(c.uid, { nick, cls }, 'bio', progress, icon);
  const uid = c.uid;
  await c.signOut();
  return { client: c, uid };
}
