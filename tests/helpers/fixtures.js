// Playwright fixtures for VS Arena tests.
//   backend : fresh in-memory Backend (rules on). Use alone for Node-only tests.
//   arena   : backend + http server (repo static + fake firebase API) + device/client factories. Everything is
//             torn down after the test, so tests are fully isolated and can run in parallel.
import { test as base, expect } from '@playwright/test';
import { Backend } from '../fake/backend.js';
import { startServer } from '../fake/server.js';
import { ScriptedClient, accountEmail, accountPass, EMPTY_PROGRESS } from '../fake/scripted.js';
import { useFakeFirebase, blockFirebase, stubFonts } from '../fake/install.js';

export const PHONE = 390, DESKTOP = 1100;

export class Device {
  constructor(arena, context, page, name) { this.arena = arena; this.context = context; this.page = page; this.name = name; this.errors = []; }
  /** Open the app and wait until cloud.js (if loadable) has finished its first auth callback. */
  async goto(path = '/', { cloud = this.firebase !== 'blocked' } = {}) {
    await this.page.goto(this.arena.origin + path);
    await this.page.waitForSelector('[data-act="deck"]');
    if (cloud) await this.cloudReady();
    return this;
  }
  /** Resolves when window.Cloud exists and has emitted its first auth state. */
  async cloudReady() {
    await this.page.waitForFunction(() => !!window.Cloud, null, { timeout: 15000 });
    await this.page.evaluate(() => new Promise(res => window.Cloud.onChange(() => res())));
  }
  /** Sign up through Cloud.signUp (same code path the account screen uses). Resolves once the header shows the account. */
  async signUp(cls, nick, pin = '1234') {
    await this.page.evaluate(([c, n, p]) => window.Cloud.signUp(c, n, p, true, null), [cls, nick, pin]);
    await expect(this.page.locator('[data-act="account"]')).toContainText(nick, { ignoreCase: true });
  }
  /** Sign in through Cloud.signIn with nickname + PIN only (the class code comes from /names). */
  async signIn(nick, pin = '1234', keep = true) {
    await this.page.evaluate(([n, p, k]) => window.Cloud.signIn(n, p, k), [nick, pin, keep]);
    await expect(this.page.locator('[data-act="account"]')).toContainText(nick, { ignoreCase: true });
  }
  /** Sign up through the real account screen UI. */
  async signUpViaUI(cls, nick, pin = '1234') {
    const p = this.page;
    await p.click('[data-act="account"]');
    await p.click('[data-act="authtab"][data-id="up"]');
    await p.fill('#f-cls', cls); await p.fill('#f-nick', nick); await p.fill('#f-pin', pin);
    await p.click('#authform button[type="submit"]');
    await expect(p.locator('[data-act="account"]')).toContainText(nick, { ignoreCase: true });
  }
  /** Current Firebase user as the page sees it, or null. */
  currentUser() { return this.page.evaluate(() => { const u = window.__fakeFirebase.sdk.auth.getAuth().currentUser; return u ? { uid: u.uid, isAnonymous: u.isAnonymous, email: u.email } : null; }); }
  async close() { await this.context.close().catch(() => {}); }
}

export class Arena {
  constructor(browser, backend, srv) { this.browser = browser; this.backend = backend; this.srv = srv; this.origin = srv.origin; this.devices = []; this.clients = []; }
  /**
   * New isolated browser context = one separate device (own storage, own auth).
   * opts: width (390 phone | 1100 desktop), timeScale (window.VS_TIME_SCALE, default 0.1), firebase ('fake' | 'blocked'),
   *       height, fakeOptions (sdk options, e.g. {txMaxAttempts: 5})
   */
  async device({ width = PHONE, height, timeScale = 0.1, firebase = 'fake', name = 'device' + (this.devices.length + 1), fakeOptions, reducedMotion = false, fonts = false, dailyReminder = false } = {}) {
    const phone = width < 600;
    const context = await this.browser.newContext({
      viewport: { width, height: height || (phone ? 844 : 800) }, hasTouch: phone, deviceScaleFactor: 1, reducedMotion: reducedMotion ? 'reduce' : 'no-preference'
    });
    if (!fonts) await stubFonts(context);   // fonts: true lets Google Fonts load (screenshots)
    if (firebase === 'fake') await useFakeFirebase(context, { options: fakeOptions });
    else if (firebase === 'blocked') await blockFirebase(context);
    // The once-a-day sign-in pop-up would cover the page in every test that signs in; only daily-pack tests want it.
    if (!dailyReminder) await context.addInitScript(() => { window.__E2E_NO_DAILY_REMINDER = true; });
    if (timeScale != null) this.backend.timeScale = timeScale;
    if (timeScale != null) await context.addInitScript(s => { window.VS_TIME_SCALE = s; }, timeScale);
    const page = await context.newPage();
    const d = new Device(this, context, page, name); d.firebase = firebase;
    page.on('pageerror', e => d.errors.push('pageerror: ' + e.message));
    // Another arcade game's files (its cards.json, its icon art) are not part of this repo: tests never fetch them, and a
    // failed load from another origin is not this page's error. Local 404s still count. A test that needs another game's
    // cards.json routes it after this (Playwright tries the newest route first).
    await context.route(/^https:\/\/apulido305\.github\.io\//, route => route.fulfill({ status: 404, body: '' }));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const at = (m.location() || {}).url || '';
      if (/Failed to load resource/.test(m.text()) && at && !at.startsWith(this.origin)) return;
      d.errors.push('console.error: ' + m.text() + (at ? ' (' + at + ')' : ''));
    });
    this.devices.push(d); return d;
  }
  /** Scripted (browserless) player on the shared backend. */
  client(name, options) { const c = new ScriptedClient(this.backend, { name, ...(options ? { options } : {}) }); this.clients.push(c); return c; }
  /** Create a signed-up account directly on the backend (so a browser can signIn as them). */
  async seedUser(cls, nick, pin = '1234') { const c = this.client('seed-' + nick); await c.signUp(cls, nick, pin); await c.signOut(); }
  async closeAll() { for (const d of this.devices) await d.close(); }
}

export const test = base.extend({
  backend: async ({}, use) => { await use(new Backend()); },
  arena: async ({ browser, backend }, use) => {
    const srv = await startServer(backend);
    const arena = new Arena(browser, backend, srv);
    await use(arena);
    await arena.closeAll(); await srv.close();
  }
});
export { expect, accountEmail, accountPass, EMPTY_PROGRESS, ScriptedClient, Backend };
