// VS Arena for Elemental Arcade: a live 2 to 20 player match.
// Loaded as an ES module after cloud.js. Everything VS lives here and renders into its own overlay (#vs),
// so solo play in index.html is untouched. If Cloud / Cloud.fb is missing this file does nothing and throws nothing.
//
// Clock: the host writes serverTimestamp() to matches/{code}.startAt. Every client derives the same schedule
// from it (LEAD_MS lead-in, then qn x [15 s question + 2.5 s reveal], qn = 10, 15 or 20). No server advances anything. Device clocks
// are assumed to be NTP-synced within a second or two (school devices normally are); that is the only trust.
// Each client scores its own answer from the moment the question appeared on its own screen.
//
// window.VS_TIME_SCALE (TEST ONLY, default 1) multiplies every VS duration so automated tests can run fast.

const Q_BASE = 15000, REVEAL_BASE = 2500, LEAD_BASE = 5000, SPLASH_BASE = 2000;
// QN_OK: round lengths a host can pick (stored as matches/{code}.qn; a match without qn is 10 questions).
// LATE_BASE: how long after a question closes its answer may still reach the server (slow phones). firestore.rules
// accepts an answer until qOpensAt + 15 s + this; keep the two in step.
// STALE_BASE: silence before the aggregator may mark a player abandoned. Generous on purpose: a slow phone's
// heartbeats arrive late, and abandoned is permanent (every later answer is refused).
const QN_DEF = 10, QN_OK = [10, 15, 20], LATE_BASE = 8000;
const BEAT_BASE = 15000, STALE_BASE = 45000, AGG_BASE = 30000, LOBBY_BASE = 5 * 60 * 1000;
const REACT_GAP_BASE = 3000, REACT_SHOW_BASE = 4000;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REACTIONS = ['nice', 'hmm', 'fire', 'gg', 'oops'];
const cap1 = r => r === 'gg' ? 'GG' : r.charAt(0).toUpperCase() + r.slice(1);
const ADJ = ['Bold', 'Swift', 'Calm', 'Bright', 'Brave', 'Clever', 'Keen', 'Lively', 'Witty', 'Steady', 'Sharp', 'Nimble', 'Sunny', 'Quick', 'Cosmic', 'Jolly'];
const ELS = ['Boron', 'Neon', 'Cobalt', 'Argon', 'Helium', 'Carbon', 'Xenon', 'Copper', 'Zinc', 'Radon', 'Nickel', 'Silicon', 'Lithium', 'Iron', 'Sodium', 'Krypton'];

const TS = () => { const v = Number(window.VS_TIME_SCALE); return v > 0 ? v : 1; };
const Q_MS = () => Q_BASE * TS(), REVEAL_MS = () => REVEAL_BASE * TS(), SLOT = () => Q_MS() + REVEAL_MS();
const LEAD_MS = () => LEAD_BASE * TS(), SPLASH_MS = () => SPLASH_BASE * TS(), LATE_MS = () => LATE_BASE * TS();
const qnOk = n => QN_OK.includes(n) ? n : QN_DEF;

/* ---------- pure helpers (exported for tests) ---------- */
const toMs = v => v == null ? 0 : typeof v === 'number' ? v : typeof v.toMillis === 'function' ? v.toMillis() : (v.seconds != null ? v.seconds * 1000 : 0);

// phaseAt(now, start, n): start is the moment question 0 appears (startAt + LEAD_MS); n questions (default 10).
function phaseAt(nowMs, startMs, n = QN_DEF) {
  const slot = SLOT(), q = Q_MS();
  const elapsed = Math.max(0, nowMs - startMs);
  const index = Math.min(n - 1, Math.floor(elapsed / slot));
  const into = elapsed - index * slot;
  if (elapsed >= n * slot) return { name: 'done', index: n - 1 };
  if (into < q) return { name: 'question', index, left: q - into };
  return { name: 'reveal', index, left: slot - into };
}
function scoreAnswer(correct, elapsedMs) {
  const q = Q_MS(), t = Math.min(q, Math.max(0, elapsedMs));
  return correct ? 100 + Math.round(50 * (1 - t / q)) : 0;
}
// points desc, correct desc, total answer time asc, earlier joinedAt. Accepts an array or a {uid: data} map.
function rankPlayers(players) {
  const list = Array.isArray(players) ? players.slice() : Object.keys(players || {}).map(k => Object.assign({ uid: k }, players[k]));
  return list.sort((a, b) =>
    (b.score || 0) - (a.score || 0) || (b.correct || 0) - (a.correct || 0) ||
    (a.totalMs || 0) - (b.totalMs || 0) || toMs(a.joinedAt) - toMs(b.joinedAt));
}
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const randName = () => ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + ELS[Math.floor(Math.random() * ELS.length)];
const genCode = () => { let c = ''; for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; };
const codeOk = c => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(c);
const vsErr = (code, msg) => { const e = new Error(msg || code); e.vs = code; return e; };

const MSG = {
  badformat: 'That code is not the right length. Arena codes have 6 letters and numbers.',
  missing: 'No arena has that code. Check it and try again.',
  expired: 'That arena expired because it never started. Ask the host to make a new one.',
  full: 'That arena is full.',
  started: 'This arena already started. Wait for the next one.',
  over: 'That arena is already over.',
  noguests: 'This arena is not open to guests. Sign in to join.',
  guestauth: 'Guest play is not set up yet. Ask your teacher, or sign in.',
  net: 'Could not reach the server. Check your connection and try again.',
  host: 'Only signed-in students can host an arena.'
};

/* ---------- module state ---------- */
let ui = { open: false, err: '', form: { code: '', deck: null, room: 'mixed', qn: QN_DEF, cap: 20, allowGuests: true, listed: true }, guestName: randName(), busy: false, joining: false, lobby: [], ladderOpen: false, copied: false, iconOpen: false, iconSel: null };
let R = null;                 // the room we are attached to, or null
let root = null, unsubLobby = null, wired = false, savedInert = false;
let C = null, fb = null, Arc = null;

const getEnv = () => {
  C = window.Cloud || null; Arc = window.Arcade || null;
  fb = C && C.fb && C.fb.db && C.fb.F && C.fb.A ? C.fb : null;
  return !!(fb && Arc);
};
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const narrow = () => !!(window.matchMedia && matchMedia('(max-width: 700px)').matches);
const tone = k => { try { Arc && Arc.tone(k); } catch (e) { /* sound is optional */ } };
const q$ = sel => root && root.querySelector(sel);
// Profile icons come from index.html (preset ids only). An older cached index.html without them shows no icon.
const av = (id, size, o) => (Arc && Arc.iconSVG ? Arc.iconSVG(id, size, o) : '');
const myIcon = () => (Arc && Arc.iconOf && Arc.getIcon ? Arc.iconOf(Arc.getIcon()) : null);
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const codeHTML = c => esc(String(c).slice(0, 3)) + '<span class="g2">' + esc(String(c).slice(3)) + '</span>';   // "VQ8 FJU", read aloud in two halves

/* ---------- styles ---------- */
const CSS = `
#vs{position:fixed;inset:0;z-index:40;overflow-y:auto;overflow-x:hidden;background:radial-gradient(120% 520px at 50% 0,#26358f,rgba(11,16,48,0) 75%),var(--bg0);color:var(--text);-webkit-overflow-scrolling:touch}
#vs[hidden]{display:none}
#vs .vs-wrap{max-width:1040px;margin:0 auto;padding:14px 16px 56px}
#vs .vs-top{display:flex;align-items:center;gap:12px;justify-content:space-between;margin-bottom:14px}
#vs .vs-title{font:400 30px/1 var(--display);letter-spacing:2px;color:var(--gold)}
#vs .vs-panel{background:var(--panel);border:2px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 6px 0 var(--shadow);margin-bottom:16px;min-width:0}
#vs .vs-panel h2{font:400 22px/1.1 var(--display);color:#fff;letter-spacing:.4px;margin:0 0 10px}
#vs .vs-sub{color:var(--mute);margin:4px 0 0;font-size:15px}
#vs .vs-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
#vs .vs-row2{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
#vs .vs-f{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 150px}
#vs .vs-f>label,#vs .vs-lab{font:700 12px/1 var(--body);letter-spacing:.8px;text-transform:uppercase;color:var(--gold)}
#vs input[type=text],#vs input[type=number],#vs select{width:100%;min-height:48px;padding:8px 12px;border-radius:12px;border:2px solid var(--line);background:var(--bg0);color:var(--text);font:400 18px/1.2 var(--body)}
#vs input.vs-codein{font:500 28px/1.2 var(--mono);letter-spacing:6px;text-transform:uppercase;text-align:center}
#vs input:focus,#vs select:focus{border-color:var(--gold);outline:none;box-shadow:0 0 0 3px rgba(243,221,122,.3)}
#vs .vs-chk{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;font-size:16px}
#vs .vs-chk input{width:22px;height:22px;accent-color:#f3dd7a;flex:none}
#vs .btn{min-height:48px}
#vs .btn[disabled]{opacity:.55;cursor:default}
#vs .vs-err{margin:0 0 14px;padding:10px 14px;border-radius:12px;background:rgba(217,83,79,.16);border:2px solid var(--bad);color:#fff}
#vs .vs-err[hidden]{display:none}
#vs .vs-gname b{font:400 24px/1.1 var(--display);color:var(--cream);letter-spacing:.5px}
#vs .vs-tag{display:inline-block;font:700 10px/1 var(--body);letter-spacing:.8px;text-transform:uppercase;padding:3px 6px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);color:var(--mute);margin-left:6px;vertical-align:middle}
#vs .vs-lobbylist{list-style:none;margin:0;padding:0;display:grid;gap:10px}
#vs .vs-lobbyrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;background:var(--panel2);border:2px solid var(--line);border-radius:14px;padding:10px 14px}
#vs .vs-lobbyrow b{font:400 19px/1.1 var(--display);color:var(--cream)}
#vs .vs-lobbyrow small{display:block;color:var(--mute);font-size:13px}
#vs .vs-bigcode{font:500 clamp(44px,13vw,84px)/1 var(--mono);letter-spacing:.12em;color:var(--gold);text-align:center;margin:6px 0;user-select:all;text-shadow:0 0 22px rgba(243,221,122,.3)}
#vs .vs-center{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center}
#vs .vs-plist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;list-style:none;margin:10px 0 0;padding:0}
#vs .vs-plist li{display:flex;align-items:center;gap:8px;min-width:0;min-height:44px;padding:6px 10px;border-radius:12px;background:var(--panel2);border:2px solid var(--line);font:400 18px/1.1 var(--display);animation:fadeIn .12s backwards}
#vs .vs-plist li.host{border-color:var(--gold)}
#vs .vs-plist .who{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px}
#vs .vs-plist .nm{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#vs .vs-plist .tags{display:flex;gap:4px}
#vs .vs-plist .vs-tag{margin-left:0;font-size:9px;padding:2px 5px}
@media (min-width:900px){#vs .vs-plist{grid-template-columns:repeat(4,minmax(0,1fr))}}
#vs .vs-gname{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:44px}
#vs .vs-gname .nmw{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 180px}
#vs .vs-picker{margin-top:12px;padding:12px;border-radius:14px;background:var(--bg0);border:2px solid var(--line)}
#vs .vs-picker .icell{background:var(--panel)}
#vs .vs-picker .vs-center{margin-top:12px;justify-content:flex-end}
#vs details>summary{display:flex;align-items:center;min-height:44px;cursor:pointer;list-style:none;font:400 22px/1.1 var(--display);color:#fff}
#vs details>summary::-webkit-details-marker{display:none}
#vs details>summary::after{content:'+';margin-left:auto;font:700 22px/1 var(--body);color:var(--gold)}
#vs details[open]>summary::after{content:'−'}
#vs details[open]>summary{margin-bottom:10px}
#vs .vs-bigcode{font-variant-ligatures:none;white-space:nowrap}
#vs .vs-bigcode .g2{margin-left:.3em}
#vs .vs-plate .av{display:flex;margin:0 auto 6px}
#vs .vs-plates .vs-plate{display:inline-flex;align-items:center;gap:8px}
#vs .vs-plates .vs-plate .av{margin:0}
#vs .vs-pod .av{display:flex;margin:6px auto 2px}
#vs .vs-tbl .pl{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#vs .vs-lrow .st .dot,#vs .vs-lrow .st .ck{display:none}
#vs .vs-lrow .st .dot{width:8px;height:8px;border-radius:50%;background:var(--mute)}
#vs .vs-lrow .st .ck svg{width:16px;height:16px;display:block}
@media (max-width:520px){
  #vs .vs-lrow .st .w{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  #vs .vs-lrow .st .dot,#vs .vs-lrow .st .ck{display:inline-block}
  #vs .btn.small{min-height:44px}
}
#vs .vs-hud{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
#vs .vs-rankchip{min-width:64px;text-align:center;padding:8px 14px;border-radius:999px;background:var(--gold);color:#241c00;font:400 22px/1 var(--display)}
#vs .vs-timer{position:relative;width:64px;height:64px;flex:none}
#vs .vs-timer svg{width:64px;height:64px;transform:rotate(-90deg)}
#vs .vs-timer circle{fill:none;stroke-width:6}
#vs .vs-timer .bg{stroke:var(--line)}
#vs .vs-timer .fg{stroke:var(--gold);stroke-linecap:round;stroke-dasharray:138.2;transition:stroke-dashoffset .12s linear,stroke .2s}
#vs .vs-timer.low .fg{stroke:var(--bad)}
#vs .vs-timer.rev .fg{stroke:var(--sky)}
#vs .vs-timer b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:400 22px/1 var(--display);color:#fff}
#vs .vs-score{text-align:right}
#vs .vs-score small{display:block;font:700 11px/1 var(--body);letter-spacing:1px;text-transform:uppercase;color:var(--mute)}
#vs .vs-score b{font:400 30px/1.1 var(--display);color:var(--gold)}
#vs .vs-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font:700 13px/1.2 var(--body);letter-spacing:.8px;text-transform:uppercase;color:var(--mute);margin-bottom:10px}
#vs .vs-play{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
#vs .vs-stage{min-width:0}
#vs .vs-stage .opt{width:100%;min-height:64px}
#vs .vs-stage .opt.sel{outline:4px solid var(--sky);outline-offset:-2px}
#vs .vs-stage .opts.locked .opt{cursor:default}
#vs .vs-lock{margin-top:14px;color:var(--sky);font:700 15px/1.3 var(--body)}
#vs .vs-reveal{margin-top:16px;border-radius:16px;padding:14px;border:2px solid var(--line);display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;animation:rise .3s backwards}
#vs .vs-reveal.ok{background:rgba(76,175,98,.14);border-color:var(--good)}
#vs .vs-reveal.no{background:rgba(217,83,79,.14);border-color:var(--bad)}
#vs .vs-reveal h3{font:400 26px/1.1 var(--display);color:#fff;margin:0 0 6px}
#vs .vs-reveal .t{flex:1 1 240px;min-width:0}
#vs .vs-reveal p{margin:6px 0}
#vs .vs-pill{display:inline-block;background:var(--gold);color:#241c00;border-radius:8px;padding:5px 10px;font:700 13px/1 var(--body);letter-spacing:.6px;margin:4px 6px 0 0}
#vs .vs-ladder{list-style:none;margin:0;padding:0;display:grid;gap:6px;position:relative}
#vs .vs-lrow{display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 10px;border-radius:12px;background:var(--panel2);border:2px solid var(--line);min-width:0}
#vs .vs-lrow.me{border-color:var(--gold);background:#26358f}
#vs .vs-lrow.away{opacity:.55}
#vs .vs-lrow .rk{flex:none;width:30px;font:400 18px/1 var(--display);color:var(--gold);text-align:center}
#vs .vs-lrow .nm{flex:1 1 auto;min-width:0;font:700 16px/1.1 var(--body);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#vs .vs-lrow .st{flex:none;font:700 12px/1 var(--body);color:var(--mute)}
#vs .vs-lrow .st.done{color:var(--good)}
#vs .vs-lrow .sc{flex:none;min-width:48px;text-align:right;font:400 20px/1 var(--display);color:#fff}
#vs .vs-lrow .dl{flex:none;font:700 12px/1 var(--body);padding:3px 6px;border-radius:6px}
#vs .vs-lrow .dl.up{background:var(--good);color:#fff}
#vs .vs-lrow .dl.dn{background:var(--bad);color:#fff}
#vs .vs-react{flex:none;font:700 12px/1 var(--body);padding:4px 8px;border-radius:999px;background:var(--cream);color:#14194a;animation:vsPop .3s backwards}
#vs .vs-flame{flex:none;width:16px;height:20px;fill:#ff8a24;filter:drop-shadow(0 0 4px rgba(255,138,36,.7))}
#vs .vs-more{width:100%;margin-top:8px}
#vs .vs-reacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
#vs .vs-reacts button{min-height:44px;min-width:56px;padding:6px 12px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);cursor:pointer;font:700 15px/1 var(--body)}
#vs .vs-reacts button.cool{opacity:.5}
#vs .vs-splash{position:relative;min-height:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;overflow:hidden;border-radius:20px;background:linear-gradient(180deg,#1d2870,#0b1030);border:2px solid var(--line);padding:18px}
#vs .vs-duel{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;width:100%}
#vs .vs-plate{padding:16px 10px;border-radius:14px;background:var(--panel2);border:3px solid var(--sky);font:400 clamp(20px,6vw,38px)/1.1 var(--display);color:#fff;overflow-wrap:anywhere}
#vs .vs-plate.r{border-color:var(--rose);animation:vsFromR .5s cubic-bezier(.2,.9,.3,1) backwards}
#vs .vs-plate.l{animation:vsFromL .5s cubic-bezier(.2,.9,.3,1) backwards}
#vs .vs-plate small{display:block;font:700 12px/1.2 var(--body);letter-spacing:1px;color:var(--mute);margin-top:4px}
#vs .vs-vs{font:400 clamp(54px,16vw,120px)/1 var(--display);color:var(--gold);text-shadow:0 4px 0 var(--goldd),0 0 30px rgba(243,221,122,.6);animation:vsSlam .5s .5s cubic-bezier(.2,.9,.3,1.2) backwards}
#vs .vs-arena-word{font:400 clamp(48px,14vw,104px)/1 var(--display);color:var(--gold);letter-spacing:6px;text-shadow:0 4px 0 var(--goldd),0 0 30px rgba(243,221,122,.6);animation:vsSlam .5s .6s cubic-bezier(.2,.9,.3,1.2) backwards}
#vs .vs-plates{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
#vs .vs-plates .vs-plate{font-size:18px;padding:8px 12px;animation:vsDeal .4s backwards;border-color:var(--sky)}
#vs .vs-cd{font:400 clamp(80px,26vw,160px)/1 var(--display);color:#fff;text-shadow:0 0 30px rgba(127,209,240,.7);animation:vsPop .4s}
#vs .vs-cd[hidden]{display:none}
#vs .vs-codeline{font:500 20px/1 var(--mono);color:var(--mute);letter-spacing:4px}
#vs .vs-podium{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin:12px 0 4px}
#vs .vs-pod{flex:1 1 0;max-width:200px;min-width:0;text-align:center;border-radius:14px 14px 0 0;padding:10px 6px;background:var(--panel2);border:2px solid var(--line);border-bottom:0;animation:rise .5s backwards}
#vs .vs-pod.p1{background:linear-gradient(180deg,#fff3b0,#e0b81a);color:#241c00;min-height:150px;border-color:var(--gold)}
#vs .vs-pod.p2{min-height:116px}
#vs .vs-pod.p3{min-height:92px}
#vs .vs-pod .n{font:400 26px/1 var(--display)}
#vs .vs-pod .nm{font:700 16px/1.15 var(--body);overflow-wrap:anywhere;margin:4px 0}
#vs .vs-pod .sc{font:400 22px/1 var(--display)}
#vs .vs-pod.me{outline:3px solid var(--sky)}
#vs table.vs-tbl{width:100%;border-collapse:collapse;font-size:15px}
#vs .vs-tbl th{font:700 11px/1 var(--body);letter-spacing:.8px;text-transform:uppercase;color:var(--gold);text-align:left;padding:6px 6px}
#vs .vs-tbl td{padding:8px 6px;border-top:1px solid var(--line)}
#vs .vs-tbl tr.me td{background:rgba(243,221,122,.12);font-weight:700}
#vs .vs-tbl .r{text-align:right}
#vs .vs-ok{color:var(--good);font-weight:700}
#vs .vs-no{color:var(--rose);font-weight:700}
#vs .vs-banner{background:linear-gradient(90deg,#26358f,#1d2870);border:3px solid var(--gold);border-radius:16px;padding:14px;margin-bottom:16px;text-align:center;animation:rise .35s backwards}
#vs .vs-banner .vs-bigcode{font-size:clamp(36px,10vw,64px)}
@keyframes vsFromL{from{transform:translateX(-140%);opacity:0}to{transform:none;opacity:1}}
@keyframes vsFromR{from{transform:translateX(140%);opacity:0}to{transform:none;opacity:1}}
@keyframes vsSlam{0%{transform:scale(3.2);opacity:0}60%{transform:scale(.88);opacity:1}100%{transform:scale(1)}}
@keyframes vsDeal{from{transform:translateY(-40px) rotate(-8deg);opacity:0}to{transform:none;opacity:1}}
@keyframes vsPop{0%{transform:scale(.7);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
@media (min-width:900px){#vs .vs-play{grid-template-columns:minmax(0,1fr) 340px;align-items:start}}
@media (max-width:700px){#vs .vs-grid{grid-template-columns:1fr}#vs .vs-stage .opts{grid-template-columns:1fr}#vs .vs-title{font-size:24px}}
@media (prefers-reduced-motion:reduce){#vs .vs-timer .fg{transition:none}#vs .vs-plate,#vs .vs-vs,#vs .vs-arena-word,#vs .vs-cd,#vs .vs-pod,#vs .vs-reveal,#vs .vs-banner,#vs .vs-react,#vs .vs-plist li,#vs .vs-plates .vs-plate{animation:none}}
@media (max-width:420px){#vs .vs-plist{gap:6px}#vs .vs-plist li{padding:6px 8px;gap:6px;font-size:16px}}
`;
function injectCss() {
  if (document.getElementById('vs-css')) return;
  const st = document.createElement('style'); st.id = 'vs-css'; st.textContent = CSS; document.head.appendChild(st);
}

/* ---------- opening, closing, wiring ---------- */
function ensureRoot() {
  root = document.getElementById('vs');
  if (!root) { root = document.createElement('div'); root.id = 'vs'; root.hidden = true; document.body.appendChild(root); }
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'VS Arena');
}
function wire() {
  if (wired) return; wired = true;
  injectCss(); ensureRoot();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('submit', e => { e.preventDefault(); });
  document.addEventListener('keydown', onKey);
  addEventListener('pagehide', onPageHide);
  addEventListener('pageshow', e => { if (e.persisted) onPageShow(); });
  // Guests are signed out only when they leave / forfeit / acknowledge the result, never from here.
  try { C.onChange(() => { if (ui.open && !R) renderMenuSoft(); }); } catch (e) { /* ignore */ }
}
function open() {
  if (!getEnv()) return;
  wire();
  ui.open = true; ui.err = ''; ui.iconOpen = false;
  if (!ui.form.deck) ui.form.deck = Arc.S.deck || 's20';
  setAppInert(true);
  if (!R) { ui.guestName = randName(); watchLobby(); }
  render();
}
function close() {
  if (R) { leaveRoom().then(closeOverlay); return; }
  closeOverlay();
}
function closeOverlay() { stopLobby(); ui.open = false; setAppInert(false); render(); }
function setAppInert(on) {
  const app = document.getElementById('app'); if (!app) return;
  try { app.inert = on; if (on) app.setAttribute('aria-hidden', 'true'); else app.removeAttribute('aria-hidden'); } catch (e) { /* ignore */ }
  document.documentElement.style.overflow = on ? 'hidden' : '';
}

/* ---------- rendering dispatcher ---------- */
function render() {
  if (!root) return;
  if (!ui.open) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  let body;
  if (!R) body = menuHTML();
  else if (R.view === 'lobby') body = lobbyHTML();
  else if (R.view === 'play') body = playHTML();
  else if (R.view === 'result') body = resultHTML();
  else body = goneHTML();
  root.innerHTML = '<div class="vs-wrap">' + body + '</div>';
  if (ui.err) setErr(ui.err);
  if (R && R.view === 'play') { if (R.phaseKey) renderStage(); updateHud(); renderLadder(); tickNow(); }
  if (R && R.view === 'lobby') updateLobby();
  if (R && R.view === 'result') updateRematch();
  if (!R) renderLobbyList();
}
function renderMenuSoft() { if (ui.open && !R && root) { const ae = document.activeElement; const typing = ae && root.contains(ae) && /INPUT|SELECT/.test(ae.tagName); if (!typing) render(); } }
function setErr(msg) {
  ui.err = msg || '';
  if (!root) return;
  root.querySelectorAll('[data-vs="error"]').forEach(el => { el.textContent = ui.err; el.hidden = !ui.err; });
}
const errBox = () => '<div class="vs-err" data-vs="error" role="alert" hidden></div>';
const topBar = (right) => '<div class="vs-top"><h1 class="vs-title">VS ARENA</h1>' + (right || '') + '</div>';

/* ---------- menu (host / join / class lobby) ---------- */
function menuHTML() {
  const acct = C.account();
  const f = ui.form;
  const decks = Arc.DECKS.map(d => '<option value="' + d.id + '"' + (d.id === f.deck ? ' selected' : '') + '>' + esc(d.name) + ' (' + esc(d.sub) + ')</option>').join('');
  const rooms = Arc.ROOMS.filter(r => !r.solo).map(r => '<option value="' + r.id + '"' + (r.id === f.room ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');
  const host = acct
    ? '<div class="vs-panel"><h2>Host an arena</h2><p class="vs-sub">Pick the deck, room and round length. Everyone gets the same questions.</p>' +
      '<div class="vs-row2" style="margin-top:12px"><div class="vs-f"><label for="vs-deck">Deck</label><select id="vs-deck" data-vs="deck">' + decks + '</select></div>' +
      '<div class="vs-f"><label for="vs-room">Room</label><select id="vs-room" data-vs="room">' + rooms + '</select></div>' +
      qnField('vs-qn', f.qn) +
      '<div class="vs-f" style="flex:0 1 110px"><label for="vs-cap">Players (2-20)</label><input id="vs-cap" type="number" min="2" max="20" inputmode="numeric" data-vs="cap" value="' + f.cap + '"></div></div>' +
      '<label class="vs-chk"><input type="checkbox" data-vs="listed"' + (f.listed ? ' checked' : '') + '> List in class lobby</label>' +
      '<label class="vs-chk"><input type="checkbox" data-vs="allow-guests"' + (f.allowGuests ? ' checked' : '') + '> Allow guests</label>' +
      '<div style="margin-top:12px"><button class="btn" data-vs="host"' + (ui.busy ? ' disabled' : '') + '>Host arena</button></div></div>'
    : '<details class="vs-panel" data-vs="host-details"><summary>Host an arena (needs sign-in)</summary><p class="vs-sub">Hosting needs an account. Sign in from the arcade to host or to see your class lobby.</p>' +
      '<div style="margin-top:12px"><button class="btn" data-vs="host" disabled>Sign in to host</button></div></details>';
  // Guest identity: icon + generated name. The icon is picked here, before Join, and kept on this device only.
  const picker = Arc.iconGridHTML && ui.iconOpen
    ? '<div class="vs-picker" data-vs="icon-picker">' + Arc.iconGridHTML(ui.iconSel, 'data-vs="icon-pick"') +
      '<div class="vs-center"><button class="btn ghost small" type="button" data-vs="icon-cancel">Cancel</button><button class="btn small" type="button" data-vs="icon-use"' + (ui.iconSel === myIcon() ? ' disabled' : '') + '>Use this</button></div></div>'
    : '';
  const guest = acct ? '' :
    '<div class="vs-f" style="margin-top:14px"><span class="vs-lab">You will appear as</span><div class="vs-gname"><span class="nmw">' + av(myIcon(), 44) + '<b data-vs="guest-name">' + esc(ui.guestName) + '</b></span>' +
    '<button class="btn ghost small" type="button" data-vs="guest-shuffle">Shuffle name</button>' +
    (Arc.iconGridHTML ? '<button class="btn ghost small" type="button" data-vs="guest-icon" aria-expanded="' + !!ui.iconOpen + '">Change icon</button>' : '') + '</div>' + picker +
    '<span class="vs-sub">Guests play with a made-up name. Nothing is saved to an account.</span></div>';
  const join = '<div class="vs-panel"><h2>Join with a code</h2><p class="vs-sub">The host shows a 6-character code on the board. A code works for any class; the class lobby below only lists arenas from your own class.</p>' +
    '<form data-vs-form="join" style="margin-top:12px"><div class="vs-f"><label for="vs-code">Arena code</label>' +
    '<input id="vs-code" class="vs-codein" type="text" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" data-vs="join-code-input" value="' + esc(f.code) + '"></div>' +
    guest + '<div style="margin-top:12px"><button class="btn" type="submit" data-vs="join-submit"' + (ui.busy ? ' disabled' : '') + '>Join arena</button></div></form></div>';
  const lobby = acct
    ? '<div class="vs-panel"><h2>Class lobby</h2><p class="vs-sub">Open arenas in class <b style="color:var(--gold)">' + esc(String(acct.cls).toUpperCase()) + '</b>. Tap one to join.</p>' +
      '<ul class="vs-lobbylist" data-vs="lobby-list" style="margin-top:12px"></ul></div>'
    : '';
  return topBar('<button class="btn ghost small" data-vs="close">Back to arcade</button>') + errBox() +
    '<div class="vs-grid"><div>' + join + lobby + '</div><div>' + host + '</div></div>';
}
// Round length select, used in the host menu and (host only) in the lobby.
const qnField = (id, val) => '<div class="vs-f" style="flex:0 1 110px"><label for="' + id + '">Questions</label><select id="' + id + '" data-vs="qn">' +
  QN_OK.map(n => '<option value="' + n + '"' + (n === qnOk(+val) ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>';
function renderLobbyList() {
  const ul = q$('[data-vs="lobby-list"]'); if (!ul) return;
  const now = Date.now();
  const rows = ui.lobby.filter(d => d.status === 'lobby' && toMs(d.expireAt) > now);
  if (!rows.length) { ul.innerHTML = '<li class="vs-sub" data-vs="lobby-empty">No open arenas right now. Ask your teacher to host one, or host your own.</li>'; return; }
  ul.innerHTML = rows.map(d => {
    const deck = Arc.DECKS.find(x => x.id === d.deck), room = Arc.ROOMS.find(x => x.id === d.room);
    return '<li class="vs-lobbyrow"><div><b>' + esc(d.hostNick) + '\'s arena</b><small>' + esc(room ? room.name : d.room) + ' &middot; ' + esc(deck ? deck.name : d.deck) + ' &middot; ' + qnOk(d.qn) + ' questions &middot; ' + (d.playerCount || 0) + '/' + (d.cap || 20) + ' players</small></div>' +
      '<button class="btn small" data-vs="lobby-join" data-code="' + esc(d.code) + '">Join</button></li>';
  }).join('');
}
function watchLobby() {
  stopLobby();
  const acct = C.account(); if (!acct) return;
  const F = fb.F, db = fb.db;
  try {
    const q = F.query(F.collection(db, 'matches'), F.where('listed', '==', true), F.where('status', '==', 'lobby'), F.where('cls', '==', acct.cls), F.limit(20));
    const apply = snap => {
      const out = []; snap.forEach(d => out.push(Object.assign({ code: d.id }, d.data())));
      out.forEach(d => { if (d.status === 'lobby' && toMs(d.expireAt) && toMs(d.expireAt) < Date.now()) F.updateDoc(F.doc(db, 'matches', d.code), { status: 'expired' }).catch(() => {}); });
      ui.lobby = out; renderLobbyList();
    };
    unsubLobby = F.onSnapshot(q, apply, () => { ui.lobby = []; renderLobbyList(); });
  } catch (e) { ui.lobby = []; }
}
function stopLobby() { if (unsubLobby) { try { unsubLobby(); } catch (e) { /* ignore */ } unsubLobby = null; } }

/* ---------- events ---------- */
function onInput(e) {
  const t = e.target, k = t.dataset && t.dataset.vs;
  if (!k) return;
  if (k === 'join-code-input') { ui.form.code = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (t.value !== ui.form.code) t.value = ui.form.code; }
  else if (k === 'deck') ui.form.deck = t.value;
  else if (k === 'room') ui.form.room = t.value;
  else if (k === 'qn') { if (!R) ui.form.qn = qnOk(+t.value); else if (e.type === 'change') hostSetting('qn', qnOk(+t.value)); }
  else if (k === 'cap') { if (!R) ui.form.cap = t.value; else if (e.type === 'change') hostSetting('cap', clampCap(t.value)); }
  else if (k === 'listed') { if (!R) ui.form.listed = t.checked; else hostSetting('listed', t.checked); }
  else if (k === 'allow-guests') { if (!R) ui.form.allowGuests = t.checked; else hostSetting('allowGuests', t.checked); }
}
const clampCap = v => Math.max(2, Math.min(20, parseInt(v, 10) || 20));
function onClick(e) {
  const t = e.target.closest('[data-vs]'); if (!t || t.disabled) {
    return;
  }
  const k = t.dataset.vs;
  if (k === 'close') close();
  else if (k === 'guest-shuffle') { ui.guestName = randName(); const el = q$('[data-vs="guest-name"]'); if (el) el.textContent = ui.guestName; }
  else if (k === 'guest-icon') { ui.iconOpen = !ui.iconOpen; ui.iconSel = myIcon(); render(); const f = q$(ui.iconOpen ? '[data-vs="icon-pick"][aria-checked="true"]' : '[data-vs="guest-icon"]'); if (f) f.focus({ preventScroll: true }); }
  else if (k === 'icon-pick') { ui.iconSel = Arc.iconOf(t.dataset.id); render(); const f = q$('[data-vs="icon-pick"][data-id="' + ui.iconSel + '"]'); if (f) f.focus({ preventScroll: true }); }
  else if (k === 'icon-use' || k === 'icon-cancel') {
    if (k === 'icon-use' && Arc.setIcon) Arc.setIcon(ui.iconSel);   // a guest's icon stays in this browser (never /players)
    ui.iconOpen = false; render(); const f = q$('[data-vs="guest-icon"]'); if (f) f.focus({ preventScroll: true });
  }
  else if (k === 'join-submit') { e.preventDefault(); joinFlow(ui.form.code); }
  else if (k === 'lobby-join') joinFlow(t.dataset.code);
  else if (k === 'host') hostFlow();
  else if (k === 'copy') copyCode();
  else if (k === 'start') startMatch();
  else if (k === 'leave') leaveClick(t);
  else if (k === 'opt') answer(+t.dataset.i);
  else if (k === 'react') react(t.dataset.r);
  else if (k === 'ladder-toggle') { ui.ladderOpen = !ui.ladderOpen; renderLadder(); }
  else if (k === 'rematch') rematch();
  else if (k === 'rematch-join') joinRematch(t.dataset.code);
  else if (k === 'guest-signin') { leaveRoom().then(() => { closeOverlay(); Arc.goto('account'); }); }
}
function onKey(e) {
  if (!ui.open || !R || R.view !== 'play') return;
  if (/^[1-4]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) answer(+e.key - 1);
}

/* ---------- joining and hosting ---------- */
// The seat carries a copy of the icon so other players can draw it without reading anyone's /players doc.
// seatIcons turns off for the session if the live rules predate icons (not republished yet), so joining still works.
let seatIcons = true;
const deniedErr = e => /permission-denied/.test(String(e && e.code));
const seat = (nick, guest) => {
  const s = {
    nick, guest, joinedAt: fb.F.serverTimestamp(), lastSeen: fb.F.serverTimestamp(), score: 0, correct: 0, totalMs: 0,
    answeredQ: -1, reaction: null, reactionAt: null, abandoned: false, left: false, streak: 0
  };
  const ic = myIcon(); if (ic && seatIcons) s.icon = ic;
  return s;
};
function normCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

async function joinFlow(raw, opts) {
  if (ui.busy) return;
  const code = normCode(raw);
  setErr('');
  if (!codeOk(code)) { setErr(code.length === 6 ? MSG.missing : MSG.badformat); return; }
  ui.busy = true; ui.joining = true; softBusy();
  const acct = C.account();
  let guest = false;
  try {
    if (!acct) {
      guest = true;
      try { await C.signInGuest(); } catch (e) { throw vsErr('guestauth'); }
    }
    const nick = acct ? acct.nick : ui.guestName;
    await joinTx(code, nick, guest);
    ui.busy = false;
    attach(code, guest);
    ui.joining = false;
  } catch (e) {
    ui.busy = false; ui.joining = false;
    if (guest && !(opts && opts.keepGuest)) { try { await C.signOutGuest(); } catch (x) { /* ignore */ } }
    setErr(MSG[e && e.vs] || MSG.net); softBusy();
  }
}
function softBusy() {
  if (!root) return;
  const j = q$('[data-vs="join-submit"]'); if (j) j.disabled = ui.busy;
  const h = q$('[data-vs="host"]'); if (h && C.account()) h.disabled = ui.busy;
}
async function joinTx(code, nick, guest) {
  const F = fb.F, db = fb.db, uid = C.uid();
  if (!uid) throw vsErr('net');
  const mref = F.doc(db, 'matches', code), pref = F.doc(db, 'matches', code, 'players', uid);
  let expireAfter = false;
  for (let attempt = 0; ; attempt++) try {
    await F.runTransaction(db, async tx => {
      const ms = await tx.get(mref);
      if (!ms.exists()) throw vsErr('missing');
      const m = ms.data();
      const mine = await tx.get(pref);
      if (mine.exists()) {
        if (m.status === 'lobby') return;
        // Already seated (a reload or a dropped connection): resume, unless marked abandoned. Not a late join.
        if (m.status === 'playing' && !mine.data().abandoned) { tx.update(pref, { left: false, lastSeen: F.serverTimestamp() }); return; }
        throw vsErr('started');
      }
      if (m.status === 'expired') throw vsErr('expired');
      if (m.status === 'lobby' && toMs(m.expireAt) && Date.now() > toMs(m.expireAt)) { expireAfter = true; throw vsErr('expired'); }
      if (m.status === 'playing') throw vsErr('started');
      if (m.status !== 'lobby') throw vsErr('over');
      if ((m.playerCount || 0) >= (m.cap || 20)) throw vsErr('full');
      if (guest && !m.allowGuests) throw vsErr('noguests');
      tx.set(pref, seat(nick, guest));
      tx.update(mref, { playerCount: (m.playerCount || 0) + 1 });
    });
    return;
  } catch (e) {
    // Many simultaneous joiners can exhaust the SDK's transaction attempts: retry with jitter.
    if (deniedErr(e) && seatIcons && myIcon()) { seatIcons = false; continue; }   // old rules: retry the join without the icon
    if (!(e && e.vs) && attempt < 8 && !deniedErr(e)) {
      await new Promise(r => setTimeout(r, (100 + Math.random() * 300) * TS()));
      continue;
    }
    if (expireAfter) fb.F.updateDoc(mref, { status: 'expired' }).catch(() => {});
    if (e && e.vs) throw e;
    throw vsErr('net');
  }
}
async function hostFlow() {
  if (ui.busy) return;
  const acct = C.account();
  if (!acct) { setErr(MSG.host); return; }
  ui.busy = true; setErr(''); softBusy();
  try {
    const code = await createMatch({ deck: ui.form.deck || 's20', room: ui.form.room || 'mixed', qn: qnOk(+ui.form.qn), cap: clampCap(ui.form.cap), allowGuests: !!ui.form.allowGuests, listed: !!ui.form.listed });
    ui.busy = false;
    attach(code, false);
  } catch (e) { ui.busy = false; setErr(MSG[e && e.vs] || MSG.net); softBusy(); }
}
async function createMatch(o) {
  const F = fb.F, db = fb.db, acct = C.account(), uid = C.uid();
  if (!acct || !uid) throw vsErr('host');
  for (let i = 0; i < 6; i++) {
    const code = genCode(), mref = F.doc(db, 'matches', code);
    let taken = false;
    try { taken = (await F.getDoc(mref)).exists(); } catch (e) { taken = false; }
    if (taken) continue;
    const now = Date.now(), b = F.writeBatch(db);
    b.set(mref, Object.assign({
      hostUid: uid, hostNick: acct.nick, cls: acct.cls, deck: o.deck, room: o.room, seed: (Math.random() * 0x100000000) >>> 0,
      cap: o.cap, allowGuests: o.allowGuests, listed: o.listed, status: 'lobby', createdAt: F.serverTimestamp(),
      expireAt: F.Timestamp.fromMillis(now + LOBBY_BASE * TS()), playerCount: 1, startAt: null, alive: 1, aggUid: uid,
      aggUntil: F.Timestamp.fromMillis(now + AGG_BASE * TS()), winnerUid: null, endedAt: null, rematch: null
    }, o.qn && o.qn !== QN_DEF ? { qn: o.qn } : {}));   // qn only when not the default, so 10-question hosting works on rules that predate it
    b.set(F.doc(db, 'matches', code, 'players', uid), seat(acct.nick, false));
    try { await b.commit(); }
    catch (e) {
      if (!(deniedErr(e) && seatIcons && myIcon())) throw e;
      seatIcons = false; i--; continue;                  // old rules: same attempt again without the icon
    }
    return code;
  }
  throw vsErr('net');
}

/* ---------- attaching to a room ---------- */
function attach(code, guest) {
  stopLobby();
  const F = fb.F, db = fb.db, uid = C.uid();
  R = {
    code, uid, guest: !!guest, view: 'lobby', match: null, matchLoaded: false, players: {}, frozen: {}, round: null, roundKey: '',
    answers: {}, pending: [], checking: false, my: { score: 0, correct: 0, totalMs: 0, streak: 0 }, granted: {}, cardsGiven: {}, rewards: null, rewarded: false,
    phase: null, phaseKey: null, shownAt: 0, startMs: 0, unsubs: [], unsubPlayers: null, unsubPresence: null, timers: [],
    rankBefore: {}, lastReact: 0, leaveArmed: 0, ladderTops: null, lastCount: -1, aggBusy: false, ending: false,
    mref: F.doc(db, 'matches', code), pref: F.doc(db, 'matches', code, 'players', uid), seenRematch: null, kicked: false, left: false
  };
  ui.err = ''; ui.ladderOpen = false;
  R.unsubs.push(F.onSnapshot(R.mref, onMatch, () => { if (R && R.view !== 'result') { R.view = 'gone'; R.goneMsg = MSG.net; render(); } }));
  R.unsubPlayers = F.onSnapshot(F.collection(db, 'matches', code, 'players'), onPlayers, () => {});
  R.timers.push(setInterval(tick, Math.max(30, Math.round(100 * TS()))));
  render();
}
function detachPlayers() {
  if (!R) return;
  if (R.unsubPlayers) { try { R.unsubPlayers(); } catch (e) { /* ignore */ } R.unsubPlayers = null; }
  if (R.unsubPresence) { try { R.unsubPresence(); } catch (e) { /* ignore */ } R.unsubPresence = null; }
}
function stopTimers() { if (R) { R.timers.forEach(clearInterval); R.timers = []; } }
function teardown() {
  if (!R) return;
  stopTimers(); detachPlayers();
  R.unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } });
  R = null;
}
async function guestAck() { try { await C.signOutGuest(); } catch (e) { /* ignore */ } }

function onMatch(snap) {
  if (!R) return;
  R.matchLoaded = true;
  if (!snap.exists()) { R.match = null; R.view = 'gone'; R.goneMsg = MSG.missing; render(); return; }
  R.match = snap.data();
  const st = R.match.startAt; if (st) R.startMs = toMs(st);
  const first = !R.hadMatch; R.hadMatch = true;
  route();
  if (first && R.view === 'lobby') render();
}
function onPlayers(snap) {
  if (!R) return;
  const map = {}; snap.forEach(d => { map[d.id] = d.data(); });
  R.players = map;
  if (R.phase && R.phase.name === 'question') { /* scores stay frozen until the reveal */ }
  else R.frozen = freeze(map);
  if (map[R.uid]) {
    const me = map[R.uid];
    if (me.abandoned && !R.kicked && R.view === 'play') { R.kicked = true; setNotice('You were marked as disconnected, so you are out of this arena. You can keep watching.'); }
  }
  if (R.match && R.match.status === 'playing') aggCheck();
  if (R.view === 'lobby') updateLobby();
  else if (R.view === 'play') { updateHud(); renderLadder(); }
}
const freeze = map => { const o = {}; Object.keys(map).forEach(k => { const p = map[k]; o[k] = { score: p.score || 0, correct: p.correct || 0, totalMs: p.totalMs || 0, streak: p.streak || 0 }; }); return o; };

function route() {
  if (!R) return;
  const m = R.match; let view;
  if (m.status === 'lobby') view = 'lobby';
  else if (m.status === 'playing') view = 'play';
  else if (m.status === 'done' || m.status === 'abandoned') view = 'result';
  else view = 'gone';
  if (view !== R.view) {
    R.view = view;
    if (view === 'play') enterPlay();
    else if (view === 'result') enterResult();
    else if (view === 'gone') { R.goneMsg = m.status === 'expired' ? MSG.expired : MSG.over; stopTimers(); detachPlayers(); }
    render();
  } else if (view === 'result') updateRematch();
  else if (view === 'lobby') updateLobby();
  else if (view === 'play') { updateHud(); renderLadder(); }
}

/* ---------- lobby ---------- */
const isHost = () => R && R.match && R.match.hostUid === R.uid;
const nQ = () => qnOk(R && R.match && R.match.qn);   // this match's round length
const seated = () => Object.keys(R.players).map(k => Object.assign({ uid: k }, R.players[k])).filter(p => !p.left);
function lobbyHTML() {
  const host = isHost(), m = R.match || {};
  const ctl = host
    ? '<div class="vs-row2" style="margin-top:14px">' + qnField('vs-qn2', m.qn) + '<div class="vs-f" style="flex:0 1 120px"><label for="vs-cap2">Players (2-20)</label><input id="vs-cap2" type="number" min="2" max="20" inputmode="numeric" data-vs="cap" value="' + (m.cap || 20) + '"></div></div>' +
      '<label class="vs-chk"><input type="checkbox" data-vs="listed"' + (m.listed ? ' checked' : '') + '> List in class lobby</label>' +
      '<label class="vs-chk"><input type="checkbox" data-vs="allow-guests"' + (m.allowGuests ? ' checked' : '') + '> Allow guests</label>' +
      '<div class="vs-center" style="margin-top:14px"><button class="btn" data-vs="start" disabled>Start arena</button></div>'
    : '<p class="vs-sub" style="text-align:center;margin-top:12px" id="vs-wait">Waiting for the host to start...</p>';
  return topBar('') + errBox() +
    '<div class="vs-panel"><h2 style="text-align:center">Arena code</h2><div class="vs-bigcode" data-vs="code" aria-label="Arena code">' + codeHTML(R.code) + '</div>' +
    '<div class="vs-center"><button class="btn ghost small" data-vs="copy">' + (ui.copied ? 'Copied' : 'Copy code') + '</button></div>' +
    '<p class="vs-sub" style="text-align:center;margin-top:10px">Players: open VS Arena and type the code, or join from the class lobby.</p>' +
    '<p class="vs-sub" style="text-align:center;margin-top:4px" id="vs-qlen">' + qnOk(m.qn) + ' questions</p></div>' +
    '<div class="vs-panel"><h2>In the arena <span id="vs-count" class="vs-sub"></span></h2><ul class="vs-plist" data-vs="lobby-players"></ul>' + ctl +
    '<p class="vs-sub" id="vs-expiry" style="margin-top:12px"></p>' +
    '<div class="vs-center" style="margin-top:12px"><button class="btn ghost small" data-vs="leave">Leave arena</button></div></div>';
}
function updateLobby() {
  if (!R || R.view !== 'lobby') return;
  const m = R.match; if (!m) return;
  const list = rankJoin(seated());
  const ul = q$('[data-vs="lobby-players"]');
  if (ul) {
    const sig = list.map(p => p.uid).join(',');
    if (ul.dataset.sig !== sig) {
      ul.dataset.sig = sig;
      ul.innerHTML = list.map(p => '<li class="' + (p.uid === m.hostUid ? 'host' : '') + '" data-uid="' + esc(p.uid) + '">' + av(p.icon, 28) + '<span class="who"><span class="nm">' + esc(p.nick) + '</span>' + (p.guest || p.uid === m.hostUid ? '<span class="tags">' + (p.guest ? '<span class="vs-tag">Guest</span>' : '') + (p.uid === m.hostUid ? '<span class="vs-tag">Host</span>' : '') + '</span>' : '') + '</span></li>').join('');
    }
  }
  const cnt = q$('#vs-count'); if (cnt) cnt.textContent = list.length + '/' + (m.cap || 20);
  const ql = q$('#vs-qlen'); if (ql) setTxt(ql, qnOk(m.qn) + ' questions');
  const qs = q$('[data-vs="qn"]'); if (qs && document.activeElement !== qs) qs.value = String(qnOk(m.qn));
  const hostGone = R.players[m.hostUid] && R.players[m.hostUid].left;
  const st = q$('[data-vs="start"]'); if (st) st.disabled = list.length < 2 || !!hostGone;
  const w = q$('#vs-wait'); if (w && hostGone) w.textContent = 'The host left, so this arena will not start. You can leave.';
  const cap = q$('[data-vs="cap"]'); if (cap && document.activeElement !== cap) cap.value = m.cap || 20;
  const li = q$('[data-vs="listed"]'); if (li && document.activeElement !== li) li.checked = !!m.listed;
  const ag = q$('[data-vs="allow-guests"]'); if (ag && document.activeElement !== ag) ag.checked = !!m.allowGuests;
}
const rankJoin = list => list.sort((a, b) => toMs(a.joinedAt) - toMs(b.joinedAt));
function lobbyTick() {
  const m = R.match; if (!m) return;
  const left = toMs(m.expireAt) - Date.now();
  const el = q$('#vs-expiry');
  if (el && toMs(m.expireAt)) { const s = Math.max(0, Math.ceil(left / 1000 / TS())); const t = 'This lobby closes in ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' if it does not start.'; if (el.textContent !== t) el.textContent = t; }
  if (toMs(m.expireAt) && left < 0) {
    fb.F.updateDoc(R.mref, { status: 'expired' }).catch(() => {});
    R.view = 'gone'; R.goneMsg = MSG.expired; stopTimers(); detachPlayers(); render();
  }
}
async function hostSetting(key, val) {
  if (!R || !isHost() || R.view !== 'lobby') return;
  const patch = {}; patch[key] = val;
  if (key === 'cap') { val = Math.max(val, R.match.playerCount || 2); patch.cap = val; const el = q$('[data-vs="cap"]'); if (el) el.value = val; }
  try { await fb.F.updateDoc(R.mref, patch); } catch (e) { setErr('Could not change that setting.'); }
}
function copyCode() {
  const code = R.code;
  const done = () => { ui.copied = true; const b = q$('[data-vs="copy"]'); if (b) b.textContent = 'Copied'; setTimeout(() => { ui.copied = false; const c = q$('[data-vs="copy"]'); if (c) c.textContent = 'Copy code'; }, 1600); };
  try { navigator.clipboard.writeText(code).then(done, () => { fallbackCopy(code); done(); }); } catch (e) { fallbackCopy(code); done(); }
}
function fallbackCopy(text) {
  try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } catch (e) { /* ignore */ }
}
async function startMatch() {
  if (!R || !isHost() || R.view !== 'lobby') return;
  const F = fb.F;
  const b = q$('[data-vs="start"]'); if (b) b.disabled = true;
  try {
    await F.updateDoc(R.mref, { status: 'playing', startAt: F.serverTimestamp(), aggUid: R.uid, aggUntil: F.Timestamp.fromMillis(Date.now() + AGG_BASE * TS()) });
  } catch (e) { setErr('Could not start the arena. Try again.'); updateLobby(); }
}

/* ---------- leaving ---------- */
function leaveClick(btn) {
  if (!R) return;
  if (R.view === 'play') {
    const now = Date.now();
    if (now - R.leaveArmed > 3500) { R.leaveArmed = now; btn.textContent = 'Tap again to forfeit'; return; }
  }
  leaveRoom(false);
}
async function leaveRoom() {
  if (!R) { close(); return; }
  const r = R, F = fb.F, view = r.view, guest = r.guest;
  try {
    if (view === 'lobby') {
      if (r.match && r.match.hostUid === r.uid) { await F.updateDoc(r.mref, { listed: false }).catch(() => {}); await F.updateDoc(r.pref, { left: true }).catch(() => {}); }
      else {
        await F.runTransaction(fb.db, async tx => {
          const ms = await tx.get(r.mref); if (!ms.exists()) return;
          const m = ms.data(); const mine = await tx.get(r.pref);
          if (m.status !== 'lobby' || !mine.exists()) return;
          tx.delete(r.pref); tx.update(r.mref, { playerCount: Math.max(0, (m.playerCount || 1) - 1) });
        }).catch(() => F.updateDoc(r.pref, { left: true }).catch(() => {}));
      }
    } else if (view === 'play') {
      r.left = true; await F.updateDoc(r.pref, { left: true }).catch(() => {});
    }
  } catch (e) { /* best effort */ }
  teardown();
  if (guest) await guestAck();
  ui.err = ''; ui.guestName = randName();
  if (ui.open) watchLobby();
  render();
}

/* ---------- page lifecycle ---------- */
function onPageHide() {
  if (!R || !R.match || (R.view !== 'lobby' && R.view !== 'play')) return;
  R.left = true;
  try { fb.F.updateDoc(R.pref, { left: true }).catch(() => {}); } catch (e) { /* best effort */ }
}
function onPageShow() {
  if (!R || !R.left || (R.view !== 'lobby' && R.view !== 'play') || (R.players[R.uid] && R.players[R.uid].abandoned)) return;
  R.left = false; try { fb.F.updateDoc(R.pref, { left: false }).catch(() => {}); } catch (e) { /* ignore */ }
}

/* ---------- play: clock ---------- */
function enterPlay() {
  const F = fb.F, m = R.match;
  const key = m.deck + '|' + m.room + '|' + m.seed + '|' + nQ();
  if (R.roundKey !== key) { try { R.round = Arc.buildRound(m.deck, m.room, m.seed, nQ()); } catch (e) { R.round = []; } R.roundKey = key; }
  R.frozen = freeze(R.players); R.phase = null; R.phaseKey = null;
  heartbeat();
  R.timers.push(setInterval(() => { heartbeat(); aggTick(); }, Math.max(40, Math.round(BEAT_BASE * TS()))));
  tone('flip');
}
function heartbeat() {
  if (!R || R.view !== 'play') return;
  fb.F.setDoc(fb.F.doc(fb.db, 'matches', R.code, 'presence', R.uid), { at: fb.F.serverTimestamp() }).catch(() => {});
}
function currentPhase() {
  if (!R.startMs) return { name: 'wait' };
  const now = Date.now(), base = R.startMs + LEAD_MS();
  if (now < base) return { name: 'lead', left: base - now, into: now - R.startMs };
  return phaseAt(now, base, nQ());
}
function tick() {
  if (!R) return;
  if (R.view === 'lobby') { lobbyTick(); return; }
  if (R.view !== 'play') return;
  tickNow();
}
function tickNow() {
  if (!R || R.view !== 'play') return;
  const ph = currentPhase();
  const key = ph.name === 'wait' ? 'wait' : ph.name === 'lead' ? 'lead' : ph.name + ph.index;
  if (key !== R.phaseKey) {
    const prev = R.phase;
    R.phase = ph; R.phaseKey = key;
    onPhase(ph, prev);
  } else R.phase = ph;
  updateTimer(ph);
  if (ph.name === 'done') endByClock();
  const nw = Date.now();
  if (lastReactSig || nw - R.lastReact < REACT_GAP_BASE * TS() || Object.values(R.players).some(p => p.reaction && p.reactionAt && nw - p.reactionAt < REACT_SHOW_BASE * TS())) expireReactions();
}
function onPhase(ph, prev) {
  // Settle every reveal up to now (idempotent), so a throttled tab still collects its card XP.
  const upto = ph.name === 'reveal' || ph.name === 'done' ? ph.index : (ph.index != null ? ph.index - 1 : -1);
  if (ph.name === 'reveal' || ph.name === 'done') R.frozen = freeze(R.players);
  for (let i = 0; i <= upto; i++) settle(i);
  if (ph.name === 'reveal') { /* ladder re-sorts below */ }
  else if (ph.name === 'question') {
    R.shownAt = Date.now();
    R.rankBefore = rankMap(frozenRows());
    if (prev && prev.name !== 'question') tone('ok');
  } else if (ph.name === 'lead') { R.frozen = freeze(R.players); R.splashTone = 0; }
  renderStage();
  updateHud(); renderLadder();
}

/* ---------- play: answering ---------- */
function answer(i) {
  if (!R || R.view !== 'play' || !R.phase || R.phase.name !== 'question') return;
  const idx = R.phase.index;
  if (R.answers[idx] || R.kicked || (R.players[R.uid] && (R.players[R.uid].abandoned || R.players[R.uid].answeredQ >= idx))) return;
  const q = R.round && R.round[idx]; if (!q || !(i >= 0 && i < q.options.length)) return;
  const elapsed = Math.min(Q_MS(), Math.max(0, Date.now() - R.shownAt));
  const correct = i === q.correct, pts = scoreAnswer(correct, elapsed);
  R.answers[idx] = { choice: i, correct, points: pts, elapsedMs: Math.round(elapsed) };
  const my = R.my; my.score += pts; if (correct) my.correct++; my.totalMs += Math.round(elapsed); my.streak = correct ? my.streak + 1 : 0;
  tone('flip');
  renderStage();
  const F = fb.F, db = fb.db, b = F.writeBatch(db);
  b.set(F.doc(db, 'matches', R.code, 'answers', R.uid + '_' + idx), { q: idx, choice: i, elapsedMs: Math.round(elapsed), correct, points: pts, at: F.serverTimestamp() });
  // Increments, not totals: the rules check each one against this answer doc, and a reloaded tab can't clobber the score.
  b.update(R.pref, { score: F.increment(pts), correct: F.increment(correct ? 1 : 0), totalMs: F.increment(Math.round(elapsed)), answeredQ: idx, lastSeen: F.serverTimestamp(), streak: my.streak });
  const r = R;
  r.pending.push(b.commit().then(() => true, () => { if (R === r) setErr('Your answer may not have reached the server. Check your connection.'); return false; }));
}
// Called when a question's reveal begins: card XP, feedback, timeout streak reset.
function settle(idx) {
  if (R.granted[idx]) return; R.granted[idx] = true;
  const q = R.round && R.round[idx]; const a = R.answers[idx];
  const info = { up: -1, isNew: false, id: q && q.cardId };
  if (a && a.correct && q) {
    if (!R.cardsGiven[q.cardId]) {
      R.cardsGiven[q.cardId] = true;
      const S = Arc.S, before = S.owned[q.cardId] || 0;
      S.owned[q.cardId] = before + 1;
      const t0 = Arc.tierOf(before), t1 = Arc.tierOf(before + 1);
      info.up = (t0 >= 0 && t1 > t0) ? t1 : -1; info.isNew = !before;
      try { Arc.save(); } catch (e) { /* ignore */ }
    }
    tone(info.up >= 0 ? 'level' : 'ok');
  } else {
    if (q && a && !a.correct) { const S = Arc.S; S.miss[q.cardId] = (S.miss[q.cardId] || 0) + 1; }
    tone('no');
    if (!a && R.my.streak > 0) { R.my.streak = 0; fb.F.updateDoc(R.pref, { streak: 0, lastSeen: fb.F.serverTimestamp() }).catch(() => {}); }
  }
  R.reveals = R.reveals || {}; R.reveals[idx] = info;
}

/* ---------- play: views ---------- */
function playHTML() {
  return topBar('<button class="btn ghost small" data-vs="leave">Leave</button>') + errBox() +
    '<div class="vs-hud" id="vs-hud"><span class="vs-rankchip" data-vs="rank-chip">-</span>' +
    '<div class="vs-timer" data-vs="timer"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="22"/><circle class="fg" cx="32" cy="32" r="22"/></svg><b>-</b></div>' +
    '<div class="vs-score"><small>Score</small><b data-vs="my-score">0</b></div></div>' +
    '<div class="vs-meta"><span id="vs-qno"></span><span><span data-vs="answered-count"></span> answered</span></div>' +
    '<div class="vs-play"><div><div class="vs-stage" id="vs-stage"></div><div id="vs-notice" class="vs-lock" role="status"></div>' +
    '<div class="vs-reacts" id="vs-reacts">' + REACTIONS.map(r => '<button data-vs="react" data-r="' + r + '">' + cap1(r) + '</button>').join('') + '</div></div>' +
    '<div><div class="vs-panel" style="padding:12px"><h2 style="font-size:18px">Ladder</h2><ul class="vs-ladder" data-vs="ladder" id="vs-ladder"></ul><div id="vs-ladder-more"></div></div></div></div>';
}
function setNotice(t) { const n = q$('#vs-notice'); if (n) n.textContent = t || ''; }
function liveRows() { return Object.keys(R.players).map(k => Object.assign({ uid: k }, R.players[k])); }
const hidden = p => p.left && (p.answeredQ == null || p.answeredQ < 0);
function frozenRows() {
  const rows = liveRows().filter(p => !hidden(p)).map(p => Object.assign({}, p, R.frozen[p.uid] || { score: 0, correct: 0, totalMs: 0, streak: 0 }));
  return rankPlayers(rows);
}
const rankMap = rows => { const o = {}; rows.forEach((p, i) => { o[p.uid] = i + 1; }); return o; };
const gone = p => !!(p.abandoned || p.left);

function renderStage() {
  const el = q$('#vs-stage'); if (!el || !R) return;
  const ph = R.phase || currentPhase();
  if (!R.phase) R.phase = ph;
  if (ph.name === 'wait') { el.innerHTML = '<div class="vs-splash"><div class="vs-arena-word" style="font-size:40px">Starting...</div></div>'; return; }
  if (ph.name === 'lead') { el.innerHTML = splashHTML(); splashTones(); return; }
  const idx = ph.index, q = R.round && R.round[idx];
  const qno = q$('#vs-qno'); if (qno) qno.textContent = 'Question ' + (idx + 1) + ' of ' + nQ();
  if (!q) { el.innerHTML = '<div class="vs-panel"><p class="vs-sub">This question could not be loaded. Hang tight.</p></div>'; return; }
  const a = R.answers[idx];
  if (ph.name === 'done') { el.innerHTML = '<div class="vs-panel"><h2>Totaling the scores...</h2></div>'; return; }
  if (ph.name === 'question') {
    const done = !!a;
    const opts = q.options.map((o, i) => '<button class="opt' + (q.mono ? ' mono' : '') + (done && a.choice === i ? ' sel' : '') + '" data-vs="opt" data-i="' + i + '"' + (done ? ' disabled' : '') + '><span class="key">' + (i + 1) + '</span><span class="ot">' + o + '</span></button>').join('');
    el.innerHTML = '<div class="vs-panel"><div class="qmeta">' + esc(roomName()) + '</div><h2 class="prompt" data-vs="question" style="font:400 clamp(22px,4vw,32px)/1.12 var(--display)">' + q.prompt + '</h2><div class="clue">' + q.clue + '</div>' +
      '<div class="opts' + (done ? ' locked' : '') + '">' + opts + '</div>' + (done ? '<div class="vs-lock">Locked in. Waiting for the reveal...</div>' : '') + '</div>';
  } else {
    const info = (R.reveals && R.reveals[idx]) || {};
    const ok = !!(a && a.correct);
    const opts = q.options.map((o, i) => '<div class="opt' + (q.mono ? ' mono' : '') + (i === q.correct ? ' right' : a && a.choice === i ? ' wrong' : ' dim') + '" data-vs="reveal-opt"><span class="key">' + (i + 1) + '</span><span class="ot">' + o + '</span></div>').join('');
    const item = Arc.BY[q.cardId];
    const head = ok ? 'Correct! +' + a.points + ' pts' : a ? 'Not quite' : 'Time is up';
    const pills = (info.isNew ? '<span class="vs-pill">NEW CARD: ' + esc(item && item.name) + '</span>' : '') + (info.up >= 0 ? '<span class="vs-pill">CARD LEVEL UP: ' + esc(Arc.TIERS[info.up].n.toUpperCase()) + '</span>' : '');
    el.innerHTML = '<div class="vs-panel"><div class="qmeta">' + esc(roomName()) + '</div><h2 class="prompt" style="font:400 clamp(22px,4vw,32px)/1.12 var(--display)">' + q.prompt + '</h2><div class="opts">' + opts + '</div>' +
      '<div class="vs-reveal ' + (ok ? 'ok' : 'no') + '" data-vs="reveal" role="status"><div class="t"><h3>' + head + '</h3>' + pills + '<p>' + q.exp + '</p></div>' +
      (item ? '<div>' + Arc.cardHTML(item, .5, Arc.tierShown(item.id), false) + '</div>' : '') + '</div></div>';
    if (info.up >= 0 && !reduced()) { const r = el.getBoundingClientRect(); try { Arc.burst(r.left + r.width / 2, r.top + 120, 40, 220); } catch (e) { /* ignore */ } }
  }
}
const roomName = () => { const r = Arc.ROOMS.find(x => x.id === R.match.room), d = Arc.DECKS.find(x => x.id === R.match.deck); return (r ? r.name : '') + ' · ' + (d ? d.name : ''); };

function splashHTML() {
  const list = rankJoin(seated().filter(p => !hidden(p)));
  const mode = list.length === 2 ? 'duel' : 'arena';
  const nameOf = p => esc(p.nick) + (p.guest ? '<span class="vs-tag">Guest</span>' : '');
  let body;
  if (mode === 'duel') {
    body = '<div class="vs-duel"><div class="vs-plate l">' + av(list[0].icon, 48) + nameOf(list[0]) + '</div><div class="vs-vs">VS</div><div class="vs-plate r">' + av(list[1].icon, 48) + nameOf(list[1]) + '</div></div>';
  } else {
    const shown = list.slice(0, 8), more = list.length - shown.length;
    body = '<div class="vs-plates">' + shown.map((p, i) => '<div class="vs-plate" style="animation-delay:' + (i * 0.12 * TS()).toFixed(3) + 's">' + av(p.icon, 28) + '<span>' + nameOf(p) + '</span></div>').join('') +
      (more > 0 ? '<div class="vs-plate" style="animation-delay:' + (shown.length * 0.12 * TS()).toFixed(3) + 's">+ ' + more + ' more</div>' : '') + '</div>' +
      '<div class="vs-arena-word">ARENA</div><div class="vs-codeline">Code ' + esc(R.code) + '</div>';
  }
  return '<div class="vs-splash" data-vs="splash" data-mode="' + mode + '">' + body + '<div class="vs-cd" data-vs="countdown" hidden></div></div>';
}
function splashTones() {
  if (reduced()) { /* sound still plays; motion is off via CSS */ }
  setTimeout(() => { if (R && R.phase && R.phase.name === 'lead') tone('win'); }, 500 * TS());
}

function updateTimer(ph) {
  const t = q$('[data-vs="timer"]');
  if (ph.name === 'lead') {
    const cd = q$('[data-vs="countdown"]');
    if (cd) {
      const secs = Math.ceil(ph.left / 1000 / TS());
      if (ph.into >= SPLASH_MS() && secs >= 1 && secs <= 3) {
        if (cd.hidden) cd.hidden = false;
        if (cd.textContent !== String(secs)) { cd.textContent = String(secs); tone(secs === 1 ? 'ok' : 'flip'); }
      }
    }
    if (t) { setTxt(t.querySelector('b'), ''); setRing(t, 0, ''); }
    return;
  }
  if (!t) return;
  if (ph.name === 'question') {
    setRing(t, ph.left / Q_MS(), ph.left / Q_MS() < .34 ? 'low' : '');
    setTxt(t.querySelector('b'), Math.max(0, Math.ceil(ph.left / 1000 / TS())));
  } else if (ph.name === 'reveal') {
    setRing(t, ph.left / REVEAL_MS(), 'rev');
    setTxt(t.querySelector('b'), Math.max(0, Math.ceil(ph.left / 1000 / TS())));
  } else { setRing(t, 0, ''); setTxt(t.querySelector('b'), ''); }
}
function setTxt(el, v) { v = String(v); if (el && el.textContent !== v) el.textContent = v; }
function setRing(t, frac, cls) {
  const fg = t.querySelector('.fg'), o = String(138.2 * (1 - Math.max(0, Math.min(1, frac)))); if (fg && fg.style.strokeDashoffset !== o) fg.style.strokeDashoffset = o;
  const lo = cls === 'low', rv = cls === 'rev';
  if (t.classList.contains('low') !== lo) t.classList.toggle('low', lo);
  if (t.classList.contains('rev') !== rv) t.classList.toggle('rev', rv);
}

function shownScore() {
  // My score as of the last reveal; the current question's points appear when its reveal begins.
  const ph = R.phase || { name: 'lead' }; let s = 0;
  Object.keys(R.answers).forEach(k => { const i = +k; if (ph.name === 'done' || ph.name === 'reveal' ? i <= ph.index : i < ph.index) s += R.answers[k].points; });
  return s;
}
function updateHud() {
  if (!R || R.view !== 'play') return;
  const rows = frozenRows(), rm = rankMap(rows), ph = R.phase || { name: 'lead' };
  const rc = q$('[data-vs="rank-chip"]'); if (rc) rc.textContent = rm[R.uid] ? ordinal(rm[R.uid]) : '-';
  const sc = q$('[data-vs="my-score"]'); if (sc) sc.textContent = shownScore();
  const ac = q$('[data-vs="answered-count"]');
  if (ac) {
    const live = liveRows().filter(p => !gone(p) && !hidden(p)), idx = ph.index == null ? 0 : ph.index;
    const n = live.filter(p => (p.answeredQ == null ? -1 : p.answeredQ) >= idx).length;
    ac.textContent = n + '/' + live.length;
  }
}

/* ---------- play: ladder ---------- */
function flameSVG() { return '<svg class="vs-flame" viewBox="0 0 16 20" aria-label="On a streak" role="img"><path d="M8 0c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3C6 7 6 3 8 0z"/></svg>'; }
let ladderRaf = 0;
function renderLadder() {
  if (ladderRaf) return;
  ladderRaf = requestAnimationFrame(() => { ladderRaf = 0; drawLadder(); });
}
function drawLadder() {
  const ul = q$('#vs-ladder'); if (!ul || !R) return;
  const ph = R.phase || { name: 'lead' }, rows = frozenRows(), rm = rankMap(rows), now = Date.now();
  const idx = ph.index == null ? 0 : ph.index;
  const showDelta = ph.name === 'reveal' || ph.name === 'done';
  // Phone: top 5 plus my row; tap to expand. Wide screens and small fields show everyone.
  let vis = rows;
  const collapse = narrow() && rows.length > 6 && !ui.ladderOpen;
  if (collapse) { vis = rows.slice(0, 5); const mine = rows.find(p => p.uid === R.uid); if (mine && rm[R.uid] > 5) vis = vis.concat([mine]); }
  const html = vis.map(p => {
    const me = p.uid === R.uid, r = rm[p.uid];
    const answered = (p.answeredQ == null ? -1 : p.answeredQ) >= idx;
    let st = '';
    // On phones the words become a grey dot (thinking) and a check (answered); the words stay for screen readers.
    if (ph.name === 'question') st = gone(p) ? 'away' : answered ? '<span class="w">answered</span><span class="ck" aria-hidden="true">' + CHECK + '</span>' : '<span class="w">thinking</span><i class="dot" aria-hidden="true"></i>';
    else if (gone(p)) st = 'away';
    const react = p.reaction && p.reactionAt && now - p.reactionAt < REACT_SHOW_BASE * TS() ? '<span class="vs-react">' + esc(cap1(String(p.reaction))) + '</span>' : '';
    let dl = '';
    if (me && showDelta && R.rankBefore[R.uid] && R.rankBefore[R.uid] !== r) { const d = R.rankBefore[R.uid] - r; dl = '<span class="dl ' + (d > 0 ? 'up' : 'dn') + '" data-vs="rank-delta">' + (d > 0 ? '+' : '') + d + '</span>'; }
    return '<li class="vs-lrow' + (me ? ' me' : '') + (gone(p) ? ' away' : '') + '" data-vs="ladder-row" data-uid="' + esc(p.uid) + '" data-rank="' + r + '"><span class="rk">' + r + '</span>' + av(p.icon, 28) +
      '<span class="nm">' + esc(p.nick) + (me ? ' (you)' : '') + (p.guest ? '<span class="vs-tag">Guest</span>' : '') + '</span>' + (p.streak >= 3 ? flameSVG() : '') + react + dl +
      (st ? '<span class="st' + (answered && ph.name === 'question' ? ' done' : '') + '">' + st + '</span>' : '') +
      '<span class="sc">' + p.score + '</span></li>';
  }).join('');
  const moreHTML = narrow() && rows.length > 6 ? '<button class="btn ghost small vs-more" data-vs="ladder-toggle">' + (ui.ladderOpen ? 'Show top 5' : 'Show all ' + rows.length) + '</button>' : '';
  const more = q$('#vs-ladder-more');
  if (more && more.dataset.sig !== moreHTML) { more.dataset.sig = moreHTML; more.innerHTML = moreHTML; }
  // Row HTML is the whole signature: unchanged rows are not rebuilt, so the reaction pop does not replay.
  if (ul.dataset.sig === html) return;
  const lis = Array.from(ul.querySelectorAll('[data-uid]')), before = lis.map(li => li.getBoundingClientRect().top);
  const prev = {}; lis.forEach((li, i) => { prev[li.dataset.uid] = before[i]; });
  ul.dataset.sig = html; ul.innerHTML = html;
  // Rank change animation: slide each row from where it was (all reads first, then all writes).
  if (!reduced()) {
    const now2 = Array.from(ul.querySelectorAll('[data-uid]')), tops = now2.map(li => li.getBoundingClientRect().top);
    now2.forEach((li, i) => {
      const b = prev[li.dataset.uid]; if (b == null) return;
      const d = b - tops[i];
      if (Math.abs(d) > 2 && li.animate) li.animate([{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }
}
let lastReactSig = '';
function expireReactions() {
  if (!R) return;
  const now = Date.now(), act = liveRows().filter(p => p.reaction && p.reactionAt && now - p.reactionAt < REACT_SHOW_BASE * TS()).map(p => p.uid + p.reactionAt).join(',');
  if (act !== lastReactSig) { lastReactSig = act; renderLadder(); }
  const cool = now - R.lastReact < REACT_GAP_BASE * TS();
  root.querySelectorAll('[data-vs="react"]').forEach(b => b.classList.toggle('cool', cool));
}
function react(r) {
  if (!R || R.view !== 'play' || !REACTIONS.includes(r)) return;
  const now = Date.now();
  if (now - R.lastReact < REACT_GAP_BASE * TS()) return;
  R.lastReact = now;
  fb.F.updateDoc(R.pref, { reaction: r, reactionAt: now }).catch(() => {});
  expireReactions();
}

/* ---------- aggregator, abandon, forfeit, finish ---------- */
const AGG_MS = () => AGG_BASE * TS();
function aggCheck() {
  // Cheap local check on every players snapshot, but only the aggregator acts.
  if (!R || R.view !== 'play' || R.guest || !R.match || R.match.aggUid !== R.uid || R.ending) return;
  // `left` alone is not a forfeit (a reload writes it, then resumes). Only `abandoned` counts, which aggTick sets
  // once a player has been silent past the stale window.
  const alive = liveRows().filter(p => !p.abandoned);
  const total = liveRows().filter(p => !hidden(p)).length;
  if (total >= 2 && alive.length === 1) endMatch('done', alive[0].uid);
  else if (alive.length === 0 && total > 0) endMatch('abandoned', null);
}
async function aggTick() {
  if (!R || R.view !== 'play' || R.guest || R.aggBusy || R.ending) return;
  R.aggBusy = true;
  try {
    const F = fb.F, db = fb.db, m = R.match, now = Date.now();
    if (!m || m.status !== 'playing') return;
    if (m.aggUid !== R.uid) {
      if (R.unsubPresence) { R.unsubPresence(); R.unsubPresence = null; }
      if (toMs(m.aggUntil) < now - 2000 * TS() && C.account()) {
        await F.runTransaction(db, async tx => {
          const s = await tx.get(R.mref); if (!s.exists()) return;
          const d = s.data(); if (d.status !== 'playing' || toMs(d.aggUntil) >= Date.now() - 2000 * TS()) return;
          tx.update(R.mref, { aggUid: R.uid, aggUntil: F.Timestamp.fromMillis(Date.now() + AGG_MS()) });
        }).catch(() => {});
      }
      return;
    }
    if (!R.unsubPresence) {
      R.presence = R.presence || {};
      R.unsubPresence = F.onSnapshot(F.collection(db, 'matches', R.code, 'presence'), s => { const o = {}; s.forEach(d => { o[d.id] = d.data(); }); R.presence = o; }, () => {});
    }
    // Mark players abandoned who have been quiet for STALE_BASE and missed the last two finished questions. One
    // missed question on a slow connection is not enough: abandoned is permanent and refuses every later answer.
    const ph = currentPhase();
    const lastDone = ph.name === 'reveal' || ph.name === 'done' ? (ph.name === 'done' ? nQ() - 1 : ph.index) : (ph.index != null ? ph.index - 1 : -1);
    if (lastDone >= 1) {
      for (const p of liveRows()) {
        if (p.uid === R.uid || p.abandoned) continue;
        const pr = R.presence && R.presence[p.uid];
        const sig = Math.max(pr ? (pr.at ? toMs(pr.at) : now) : 0, toMs(p.lastSeen) || 0, toMs(p.joinedAt) || 0);
        if (now - sig > STALE_BASE * TS() && (p.answeredQ == null ? -1 : p.answeredQ) < lastDone - 1) {
          p.abandoned = true; R.players[p.uid] = Object.assign({}, R.players[p.uid], { abandoned: true });
          await F.updateDoc(F.doc(db, 'matches', R.code, 'players', p.uid), { abandoned: true }).catch(() => {});
        }
      }
    }
    const alive = liveRows().filter(p => !gone(p)).length;
    await F.updateDoc(R.mref, { alive, aggUntil: F.Timestamp.fromMillis(Date.now() + AGG_MS()) }).catch(() => {});
    aggCheck();
  } finally { if (R) R.aggBusy = false; }
}
async function endMatch(status, winnerUid) {
  if (!R || R.ending) return;
  const r = R, F = fb.F, db = fb.db;
  if (!r.match || r.match.status !== 'playing') return;
  R.ending = true;
  try {
    // Only the aggregator ends at once; everyone else waits a beat and re-checks, so normally one client writes.
    if (r.match.aggUid !== r.uid) {
      await new Promise(res => setTimeout(res, 1500 * TS()));
      if (R !== r || !r.match || r.match.status !== 'playing') return;
    }
    await F.runTransaction(db, async tx => {
      const s = await tx.get(r.mref); if (!s.exists() || s.data().status !== 'playing') return;
      const patch = { status, endedAt: F.serverTimestamp() };
      if (status === 'done') patch.winnerUid = winnerUid;
      tx.update(r.mref, patch);
    });
  } catch (e) { if (R === r) R.ending = false; }
}
function endByClock() {
  if (!R || R.ending || R.view !== 'play' || R.kicked) return;
  if (Date.now() - (R.endAt || 0) < 1000 * TS()) return;
  R.endAt = Date.now();
  const order = frozenRows(); // reveal is over, so frozen equals live
  if (!order.length) return;
  endMatch('done', order[0].uid);
}

/* ---------- result ---------- */
function finalOrder() {
  const rows = liveRows().filter(p => !hidden(p));
  // winnerUid is not trusted for placing (any participant can write it). Players who dropped out rank below
  // everyone who stayed, which also makes the last player standing win a forfeit.
  const out = p => !!(p.abandoned || (p.left && (p.answeredQ == null ? -1 : p.answeredQ) < nQ() - 1));
  return rankPlayers(rows.filter(p => !out(p))).concat(rankPlayers(rows.filter(out)));
}
/* Final score check. During the match the ladder shows only what this phone has heard so far, and a slow phone's
   last answers can still be on their way when the clock ends the match. So the podium is not drawn from the ladder:
   1. wait for this phone's own answer writes to be acknowledged (or fail),
   2. on a clock finish, wait until every seated player's last answer is in or the late window of the last question
      closes (LATE_BASE after it closes; the rules refuse anything later), whichever comes first,
   3. read every seat once from the server. That read decides the podium, the placement bonus and the VS record. */
const allIn = (r, last) => Object.keys(r.players).every(k => { const p = r.players[k]; return gone(p) || hidden(p) || (p.answeredQ == null ? -1 : p.answeredQ) >= last; });
async function finalCheck(r) {
  const F = fb.F, last = nQ() - 1, now = Date.now();
  const until = t => new Promise(res => setTimeout(res, Math.max(0, t - Date.now())));
  const lastClose = r.startMs + LEAD_MS() + last * SLOT() + Q_MS();
  const clockEnd = !!r.startMs && now >= lastClose - 2000 * TS();             // false for a forfeit part way through
  const deadline = clockEnd ? Math.max(now, lastClose + LATE_MS()) : now + 1500 * TS();
  await Promise.race([Promise.all(r.pending), until(deadline)]);
  while (clockEnd && R === r && Date.now() < deadline && !allIn(r, last)) await until(Math.min(deadline, Date.now() + 150 * TS()));
  try {
    const snap = await F.getDocs(F.collection(fb.db, 'matches', r.code, 'players'));
    const map = {}; snap.forEach(d => { map[d.id] = d.data(); });
    if (Object.keys(map).length) r.players = map;
  } catch (e) { /* offline: keep what the players listener last delivered */ }
}
function enterResult() {
  stopTimers();
  if (R.rewarded || R.checking) return;
  const r = R; r.checking = true;
  finalCheck(r).then(() => { if (R !== r) return; r.checking = false; detachPlayers(); award(); render(); });
}
function award() {
  R.rewarded = true;
  const order = finalOrder(), place = order.findIndex(p => p.uid === R.uid) + 1;
  const me = R.players[R.uid] || {};
  const m = R.match, S = Arc.S;
  const finished = m.status === 'done' && !me.abandoned && !R.left && !R.kicked;
  const answered = (me.answeredQ == null ? -1 : me.answeredQ) >= 0 || Object.keys(R.answers).length > 0;
  const competed = order.filter(p => (p.answeredQ == null ? -1 : p.answeredQ) >= 0).length;
  const rw = { place, total: order.length, finished, bonus: 0, xp: 0, lvBefore: Arc.levelInfo(S.xp).lvl, lvAfter: 0, record: null, forfeit: !!(m.status === 'done' && Object.keys(R.players).some(k => R.players[k].abandoned || R.players[k].left) && R.phase && R.phase.name !== 'done'), cards: Object.keys(R.cardsGiven).length };
  if (finished && answered) {
    rw.bonus = place === 1 ? 40 : place === 2 ? 25 : place === 3 ? 15 : place <= 10 ? 8 : 5;
    rw.xp = rw.bonus + 10 * (me.correct || R.my.correct || 0);
    S.xp += rw.xp;
  }
  rw.lvAfter = Arc.levelInfo(S.xp).lvl;
  if (!R.guest && C.account() && finished) {
    const v = Object.assign({ w: 0, l: 0, streak: 0, best: 0, played: 0 }, S.vs);
    v.played++;
    if (place === 1 && competed >= 2) { v.w++; v.streak++; v.best = Math.max(v.best, v.streak); }
    else if (place !== 1) { v.l++; v.streak = 0; }
    S.vs = v; S.vsAt = Date.now(); rw.record = v;
  }
  R.rewards = rw;
  try { Arc.save(); } catch (e) { /* ignore */ }
  if (rw.lvAfter > rw.lvBefore) tone('level'); else tone('win');
  if (place === 1 && !reduced()) setTimeout(() => { try { Arc.burst(innerWidth / 2, Math.min(220, innerHeight / 3), 60, 300); } catch (e) { /* ignore */ } }, 300);
  if (m.rematch) R.seenRematch = m.rematch;
}
function resultHTML() {
  if (R.checking) return topBar('') + errBox() + '<div class="vs-panel" data-vs="final-check" role="status" style="text-align:center"><h2>Checking final scores...</h2><p class="vs-sub">Giving slow connections a moment so every answer counts.</p></div>';
  const m = R.match, order = finalOrder(), rw = R.rewards || {}, S = Arc.S;
  const meP = R.players[R.uid] || {};
  const podium = order.slice(0, 3);
  const slot = (p, i) => '<div class="vs-pod p' + (i + 1) + (p.uid === R.uid ? ' me' : '') + '" data-rank="' + (i + 1) + '" data-uid="' + esc(p.uid) + '" style="animation-delay:' + ((2 - i) * 0.25 * TS()).toFixed(2) + 's"><div class="n">' + ordinal(i + 1) + '</div>' + av(p.icon, i === 0 ? 64 : 48, { tile: true }) + '<div class="nm">' + esc(p.nick) + (p.uid === R.uid ? ' (you)' : '') + '</div><div class="sc">' + (p.score || 0) + '</div></div>';
  const pod = podium.length === 3 ? slot(podium[1], 1) + slot(podium[0], 0) + slot(podium[2], 2) : podium.length === 2 ? slot(podium[1], 1) + slot(podium[0], 0) : podium.map(slot).join('');
  const field = order.map((p, i) => '<tr class="' + (p.uid === R.uid ? 'me' : '') + '" data-uid="' + esc(p.uid) + '"><td>' + (i + 1) + '</td><td><span class="pl">' + av(p.icon, 28) + '<span>' + esc(p.nick) + (p.uid === R.uid ? ' (you)' : '') + '</span>' + (p.guest ? '<span class="vs-tag">Guest</span>' : '') + (gone(p) ? '<span class="vs-tag">Left</span>' : '') + '</span></td><td class="r">' + (p.score || 0) + '</td><td class="r">' + (p.correct || 0) + '</td></tr>').join('');
  let rows = '';
  for (let i = 0; i < nQ(); i++) {
    const a = R.answers[i], q = R.round && R.round[i]; const card = q && Arc.BY[q.cardId];
    rows += '<tr><td>' + (i + 1) + '</td><td>' + esc(card ? card.name : '') + '</td><td>' + (a ? (a.correct ? '<span class="vs-ok">Right</span>' : '<span class="vs-no">Wrong</span>') : '<span class="vs-no">No answer</span>') + '</td><td class="r">' + (a ? a.points : 0) + '</td><td class="r">' + (a ? (a.elapsedMs / 1000 / TS()).toFixed(1) + 's' : '-') + '</td></tr>';
  }
  const abandoned = m.status === 'abandoned';
  const title = abandoned ? 'Arena ended' : order[0] && order[0].uid === R.uid ? 'You win!' : 'Final standings';
  const forfeit = m.status === 'done' && (!R.phase || R.phase.name !== 'done') && order.some(p => gone(p) && p.uid !== (order[0] && order[0].uid));
  let rewards = '';
  if (rw.finished && !abandoned) {
    rewards = '<p class="vs-sub">You placed <b style="color:var(--gold)">' + ordinal(rw.place) + '</b> of ' + rw.total + '.' + (rw.bonus ? ' Placement bonus +' + rw.bonus + ' XP.' : '') + ' Cards earned: ' + rw.cards + '.</p>' +
      (rw.lvAfter > rw.lvBefore ? '<p><span class="vs-pill">LEVEL UP: Lv ' + rw.lvAfter + ' ' + esc(Arc.levelInfo(S.xp).title) + '</span></p>' : '') +
      (rw.record ? '<p class="vs-sub" data-vs="vs-result-record">VS record: ' + rw.record.w + '-' + rw.record.l + (rw.record.streak ? ' &middot; streak ' + rw.record.streak : '') + '</p>' : '');
  } else rewards = '<p class="vs-sub">' + (meP.abandoned || R.kicked ? 'You were disconnected before the end, so there is no placement bonus.' : abandoned ? 'Everyone left before the end.' : 'No placement bonus this time.') + '</p>';
  // The server total is the score that counts. If this phone tallied more, some answers never landed: say so.
  const lost = (R.my.score || 0) - (meP.score || 0);
  const lostHTML = lost > 0 ? '<p class="vs-sub" data-vs="lost-points">' + lost + ' of your points did not reach the server in time, so they do not count.</p>' : '';
  const cta = R.guest ? '<div class="vs-panel" data-vs="guest-cta"><p style="margin:0">Sign in or create an account to save your cards and keep your VS record.</p><div style="margin-top:10px"><button class="btn small" data-vs="guest-signin">Sign in</button></div></div>' : '';
  return topBar('') + errBox() + '<div id="vs-rematch"></div>' +
    '<div class="vs-panel"><h2 style="text-align:center;font-size:30px">' + esc(title) + '</h2>' + (forfeit ? '<p class="vs-sub" style="text-align:center">Won by forfeit: the other players left.</p>' : '') +
    '<div class="vs-podium" data-vs="podium">' + pod + '</div></div>' +
    '<div class="vs-panel"><h2>Your result</h2><p style="margin:0;font:400 28px/1 var(--display);color:var(--gold)">' + (meP.score || 0) + ' pts &middot; ' + (meP.correct || 0) + '/' + nQ() + ' right</p>' + lostHTML + rewards + '</div>' + cta +
    // Phones: the per-question breakdown starts closed so the podium page stays short.
    '<div class="vs-play"><details class="vs-panel" data-vs="answers"' + (narrow() ? '' : ' open') + '><summary>Your answers</summary><div style="overflow-x:auto"><table class="vs-tbl" data-vs="breakdown"><thead><tr><th>#</th><th>Card</th><th>Result</th><th class="r">Pts</th><th class="r">Time</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
    '<div class="vs-panel"><h2>The field</h2><div style="overflow-x:auto"><table class="vs-tbl" data-vs="field"><thead><tr><th>#</th><th>Player</th><th class="r">Score</th><th class="r">Right</th></tr></thead><tbody>' + field + '</tbody></table></div></div></div>' +
    '<div class="vs-center"><button class="btn" data-vs="leave">Done</button></div>';
}
function updateRematch() {
  const box = q$('#vs-rematch'); if (!box || !R) return;
  const m = R.match, host = isHost(), code = m.rematch;
  if (!code) {
    box.innerHTML = host && m.status === 'done' ? '<div class="vs-center" style="margin-bottom:16px"><button class="btn" data-vs="rematch"' + (ui.busy ? ' disabled' : '') + '>Rematch</button></div>' : '';
    return;
  }
  if (R.seenRematch !== code) { R.seenRematch = code; tone('ok'); }
  if (host) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="vs-banner" data-vs="rematch-banner" role="status"><h2 style="margin:0;font:400 24px/1.1 var(--display);color:#fff">Rematch ready</h2><div class="vs-bigcode" data-vs="rematch-code">' + codeHTML(code) + '</div>' +
    '<button class="btn" data-vs="rematch-join" data-code="' + esc(code) + '">' + (R.guest ? 'Join again' : 'Join rematch') + '</button></div>';
}
async function rematch() {
  if (!R || !isHost() || ui.busy) return;
  const m = R.match; ui.busy = true;
  try {
    const code = await createMatch({ deck: m.deck, room: m.room, qn: qnOk(m.qn), cap: m.cap, allowGuests: m.allowGuests, listed: m.listed });
    await fb.F.updateDoc(R.mref, { rematch: code });
    ui.busy = false;
    teardown(); attach(code, false);
  } catch (e) { ui.busy = false; setErr(MSG[e && e.vs] || MSG.net); updateRematch(); }
}
async function joinRematch(code) {
  if (!R) return;
  const guest = R.guest;
  teardown();
  ui.form.code = code;
  // A guest keeps the same anonymous session for the next match; it is signed out when they finally leave.
  await joinFlow(code, { keepGuest: true });
  if (!R) { // failed: back to the menu
    if (guest) await guestAck();
    watchLobby(); render();
  }
}
function goneHTML() {
  return topBar('') + errBox() + '<div class="vs-panel"><h2>Arena closed</h2><p class="vs-sub" data-vs="gone-msg">' + esc(R.goneMsg || MSG.over) + '</p><div style="margin-top:14px"><button class="btn" data-vs="leave">Back to VS Arena</button></div></div>';
}

/* ---------- boot ---------- */
window.VSArena = { open, _rank: rankPlayers, _scoreAnswer: scoreAnswer, _phaseAt: phaseAt };

function boot() {
  try {
    if (!getEnv()) return;
    wire();
    if (window.Arcade && typeof window.Arcade.render === 'function') window.Arcade.render(); // show the VS button
  } catch (e) { console.warn('VS Arena unavailable.', e); }
}
if (window.Cloud && window.Cloud.fb) boot();
else window.addEventListener('cloud-ready', boot, { once: true });
