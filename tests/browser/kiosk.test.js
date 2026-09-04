const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.MV_TEST_BASE || 'http://127.0.0.1:8898';
const KIOSK_URL = BASE + '/e/demo-gala-2026?k=main';  // not `URL`: that shadows the global

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failed++; process.exitCode = 1; }
}

const tracked = async () => (await fetch(BASE + '/__tracked')).json();

// The kiosk now opens on an attract screen; search is one tap in.
async function enterSearch(page) {
  if (await page.isVisible('#screen-welcome')) {
    await page.click('#welcome-cta');
    await page.waitForSelector('#screen-search:visible');
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MV_CHROMIUM || '/opt/pw-browsers/chromium' });

  // config.js points at the real Supabase project. Intercept those calls and
  // serve them from the local mock, so the browser exercises the app's real
  // request code without needing (or being allowed) outbound network.
  async function wire(target) {
    target.setDefaultTimeout(Number(process.env.MV_TEST_TIMEOUT || 15000));
    // Nothing else may leave the browser during a test.
    await target.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(BASE) ? route.continue() : route.abort();
    });
    await target.route('**/rest/v1/rpc/**', async (route) => {
      const request = route.request();
      // Forward the URL exactly as the app built it, query string included.
      // Rebuilding it from the pathname alone hid a stray parameter that
      // PostgREST rejects.
      const sent = new URL(request.url());
      const response = await fetch(`${BASE}${sent.pathname}${sent.search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: request.postData() || '{}',
      });
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
  }

  // A typical entrance-hall screen, portrait-ish touch panel.
  const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, serviceWorkers: 'block' });
  await wire(page);

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('\nLoad and branding');
  await page.goto(KIOSK_URL, { waitUntil: 'networkidle' });

  await check('the kiosk opens on the welcome screen', async () => {
    assert.equal(await page.isVisible('#app'), true);
    assert.equal(await page.isVisible('#boot'), false);
    assert.equal(await page.isVisible('#screen-welcome'), true);
    assert.equal(await page.isVisible('#screen-search'), false);
  });
  await check('branding drives the welcome and search headings', async () => {
    assert.equal(await page.textContent('#welcome-title'), 'Demo Gala 2026');
    await enterSearch(page);
    assert.equal(await page.textContent('#search-title'), 'Demo Gala 2026');
    assert.equal(await page.textContent('#search-kicker'), 'Find your table');
  });
  await check('the theme is applied to the stage', async () => {
    const theme = await page.getAttribute('html', 'data-theme');
    assert.ok(theme, 'no theme was applied');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim());
    assert.equal(bg, '#0b0d12', 'an explicit background colour should still win');
  });
  await check('the stage carries the configured aspect ratio', async () => {
    const ratio = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ratio').trim());
    assert.equal(ratio, '9 / 16');
  });
  await check('placeholder text comes from branding', async () => {
    assert.equal(await page.textContent('#search-placeholder'), 'Start typing your name');
  });
  await check('on-screen keyboard rendered', async () => {
    assert.equal(await page.locator('.key').count(), 26 + 3);
  });
  // A totem is roughly two metres tall and gets cast onto tall displays, so
  // keys pinned to the bottom of the frame sit near knee height and make
  // guests stoop. They belong in the middle band, and they must not drift as
  // matches appear — a key that moves under a finger gets mis-tapped.
  await check('the keys sit in the reachable middle and never move', async () => {
    await enterSearch(page);
    const where = () => page.evaluate(() => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const keys = document.querySelector('.keyboard').getBoundingClientRect();
      return {
        top: ((keys.top - stage.top) / stage.height) * 100,
        bottom: ((keys.bottom - stage.top) / stage.height) * 100,
      };
    });

    const idle = await where();
    assert.ok(idle.bottom < 85, `keys reach ${idle.bottom.toFixed(1)}% down the stage`);
    assert.ok(idle.top > 35, `keys start ${idle.top.toFixed(1)}% down the stage`);

    for (const k of ['A', 'D']) await page.click(`.key:text-is("${k}")`);
    await page.waitForSelector('.result');
    const matching = await where();
    assert.equal(matching.top.toFixed(1), idle.top.toFixed(1));

    await page.click('.key:text-is("Clear")');
    const cleared = await where();
    assert.equal(cleared.top.toFixed(1), idle.top.toFixed(1));
  });

  console.log('\nSearch');
  await check('tapping keys filters the list', async () => {
    await enterSearch(page);
    for (const k of ['A', 'D']) await page.click(`.key:text-is("${k}")`);
    await page.waitForSelector('.result');
    // "ad" matches the start of a first name and the start of a surname; both
    // are legitimate hits and both are shown.
    const names = await page.locator('.result-name').allTextContents();
    assert.deepEqual(names, ['Adaeze Okonkwo', 'Damilola Adeyemi']);
  });
  await check('the typed portion is highlighted', async () => {
    assert.equal(await page.textContent('.result-name mark'), 'Ad');
  });
  await check('Clear resets the search', async () => {
    await page.click('.key:text-is("Clear")');
    assert.equal(await page.locator('.result').count(), 0);
    assert.equal(await page.isVisible('#search-placeholder'), true);
  });
  await check('surname search works (word-start match)', async () => {
    await page.keyboard.type('solanke');
    await page.waitForSelector('.result');
    assert.deepEqual(await page.locator('.result-name').allTextContents(), ['Bukki Solanke']);
  });
  await check('search is case and space tolerant', async () => {
    await page.click('.key:text-is("Clear")');
    await page.keyboard.type('GRACE M');
    await page.waitForSelector('.result');
    assert.deepEqual(await page.locator('.result-name').allTextContents(), ['Grace Mensah']);
  });
  await check('a space does not re-fire the last tapped key', async () => {
    // Regression: buttons keep focus after a tap, and space activates a focused
    // button — so typing a space after tapping Clear used to wipe the query.
    await page.click('.key:text-is("Clear")');
    await page.click('.key:text-is("A")');
    await page.keyboard.type(' B');
    assert.equal(await page.textContent('#search-value'), 'A B');
  });
  // A kiosk shows no scrollbar, so a row sliced off by the edge of the band is
  // the only clue that more names exist — and it reads as a rendering fault.
  await check('a list longer than the band fades to show there is more', async () => {
    await page.click('.key:text-is("Clear")');
    await page.click('.key:text-is("O")');
    await page.waitForSelector('.result');
    assert.ok(await page.locator('.result').count() >= 3, 'need enough matches to overflow');
    assert.equal(await page.getAttribute('.results', 'data-more') !== null, true,
      'the fade must be on while names are hidden below the fold');

    await page.evaluate(() => { const r = document.querySelector('.results'); r.scrollTop = r.scrollHeight; });
    await page.waitForFunction(() => !document.querySelector('.results').hasAttribute('data-more'));
    assert.equal(await page.getAttribute('.results', 'data-more'), null,
      'the last name must not be left faded once the list is scrolled to the end');
  });
  // The list is capped at 40; beyond that the guest is told to keep typing.
  await check('the overflow hint counts in plain English', async () => {
    const load = async (n) => {
      await fetch(BASE + '/__guests/' + n);
      await page.reload({ waitUntil: 'networkidle' });
      await enterSearch(page);
      await page.click('.key:text-is("O")');
      await page.waitForSelector('.result');
      return page.textContent('.results > .no-match');
    };
    assert.match(await load(41), /Keep typing — 1 more name matches\./);
    assert.match(await load(45), /Keep typing — 5 more names match\./);
    await fetch(BASE + '/__guests/0');
    await page.reload({ waitUntil: 'networkidle' });
    await enterSearch(page);
  });
  await check('no match shows the branded message', async () => {
    await page.click('.key:text-is("Clear")');
    await page.keyboard.type('zzzz');
    await page.waitForSelector('#no-match:visible');
    assert.match(await page.textContent('#no-match'), /could not find that name/i);
  });
  await check('backspace removes a character', async () => {
    await page.keyboard.press('Backspace');
    assert.equal(await page.textContent('#search-value'), 'zzz');
  });

  console.log('\nReveal');
  await check('tapping a guest shows their table', async () => {
    await page.click('.key:text-is("Clear")');
    await page.keyboard.type('emeka');
    await page.click('.result');
    await page.waitForSelector('#screen-reveal:visible');
    assert.equal(await page.textContent('#reveal-name'), 'Emeka Obi');
    assert.equal(await page.textContent('#reveal-table'), 'VIP-A');
  });
  await check('a visible extra field is shown on the reveal', async () => {
    assert.match(await page.textContent('#reveal-extra'), /Fish/);
  });
  // The organiser names the column in the Control Center; showing the raw CSV
  // header instead ("meal Fish") is what a guest used to be given.
  await check('the extra field is shown under its configured label', async () => {
    const text = await page.textContent('#reveal-extra');
    assert.match(text, /Meal choice/);
    assert.doesNotMatch(text, /\bmeal\b/);
  });
  await check('the hidden field never reaches the browser at all', async () => {
    const html = await page.content();
    assert.equal(/phone/i.test(html), false, 'phone appeared in the DOM');
    const cached = await page.evaluate(() => localStorage.getItem('kiosk:event:demo-gala-2026'));
    assert.equal(/phone|800 000/i.test(cached), false, 'phone appeared in the cache');
  });
  await check('the branded tagline is shown', async () => {
    assert.match(await page.textContent('#reveal-tagline'), /celebrate with you/i);
  });
  await check('Done returns to the welcome screen with the query cleared', async () => {
    // A totem sits on its attract screen between guests, so the next person
    // never walks up to the previous one's result.
    await page.click('#done');
    await page.waitForSelector('#screen-welcome:visible');
    assert.equal(await page.textContent('#search-value'), '');
    await enterSearch(page);
  });
  await check('a guest with no table gets a fallback, not a blank', async () => {
    await enterSearch(page);
    await page.keyboard.type('hakeem');
    await page.click('.result');
    await page.waitForSelector('#screen-reveal:visible');
    assert.equal(await page.textContent('#reveal-table'), 'See a host');
    await page.click('#done');
  });

  console.log('\nAnalytics');
  await check('reveal is tracked with the guest id and kiosk tag', async () => {
    const rows = await tracked();
    const reveal = rows.find(r => r.p_type === 'reveal');
    assert.ok(reveal, 'no reveal tracked');
    assert.ok(reveal.p_guest_id, 'reveal carried no guest id');
    assert.equal(reveal.p_kiosk_param, 'main');
  });
  await check('a fruitless search is tracked as no_match', async () => {
    await enterSearch(page);
    await page.keyboard.type('qqqq');
    await page.waitForTimeout(1500);
    const rows = await tracked();
    assert.ok(rows.some(r => r.p_type === 'no_match' && r.p_query_text === 'qqqq'));
  });
  await check('keystrokes are debounced into one row, not one per letter', async () => {
    await fetch(BASE + '/__reset');
    await enterSearch(page);
    await page.click('.key:text-is("Clear")');
    await page.keyboard.type('adaeze oko');      // 10 keystrokes
    await page.waitForTimeout(1600);
    const rows = await tracked();
    assert.equal(rows.length, 1, `10 keystrokes produced ${rows.length} rows`);
    assert.equal(rows[0].p_query_text, 'adaeze oko');
  });

  console.log('\nIdle reset');
  await check('the screen returns to the attract loop on its own', async () => {
    await page.evaluate(() => { window.KIOSK_CONFIG.idleResetMs = 700; });
    await enterSearch(page);
    await page.click('.key:text-is("Clear")');
    await page.keyboard.type('ade');
    await page.click('.result');
    await page.waitForSelector('#screen-reveal:visible');
    await page.waitForSelector('#screen-welcome:visible', { timeout: 6000 });
    assert.equal(await page.textContent('#search-value'), '');
  });

  console.log('\nOffline fallback');
  await check('a cached list keeps the kiosk working when the API is down', async () => {
    await fetch(BASE + '/__offline/1');
    const offlinePage = await browser.newPage({ viewport: { width: 1080, height: 1440 },
      serviceWorkers: 'block', storageState: await page.context().storageState() });
    await wire(offlinePage);
    await offlinePage.goto(KIOSK_URL, { waitUntil: 'networkidle' });
    assert.equal(await offlinePage.isVisible('#app'), true, 'app did not render from cache');
    await enterSearch(offlinePage);
    await offlinePage.keyboard.type('bukki');
    await offlinePage.waitForSelector('.result');
    assert.deepEqual(await offlinePage.locator('.result-name').allTextContents(), ['Bukki Solanke']);
    assert.equal(await offlinePage.getAttribute('#sync', 'data-state'), 'offline');
    await offlinePage.close();
  });
  await check('a first-ever load with no cache fails gracefully, not blankly', async () => {
    const fresh = await browser.newContext({ serviceWorkers: 'block' });
    await wire(fresh);
    const freshPage = await fresh.newPage();
    await freshPage.goto(KIOSK_URL, { waitUntil: 'networkidle' });
    assert.equal(await freshPage.isVisible('#boot'), true);
    assert.match(await freshPage.textContent('#boot-text'), /ask a host/i);
    await fresh.close();
  });
  await fetch(BASE + '/__offline/0');

  console.log('\nRouting');
  await check('an unknown event slug says the event has ended', async () => {
    const p = await browser.newPage();
    await wire(p);
    await p.goto(BASE + '/e/no-such-event', { waitUntil: 'networkidle' });
    assert.match(await p.textContent('#boot-text'), /has ended/i);
    await p.close();
  });
  await check('the bare root explains what a kiosk URL looks like', async () => {
    const p = await browser.newPage();
    await wire(p);
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    assert.match(await p.textContent('#boot-text'), /\/e\/your-event-name/);
    await p.close();
  });

  console.log('\nRequest shape');
  await check('the payload request carries no query string', async () => {
    // Regression: a slug was appended to the URL so the service worker could
    // key its cache. PostgREST rejects unrecognised query parameters on an RPC
    // call, so this broke every guest-list fetch in production.
    const urls = [];
    const watcher = await browser.newPage({ viewport: { width: 1080, height: 1440 }, serviceWorkers: 'block' });
    watcher.on('request', (r) => { if (r.url().includes('/rpc/')) urls.push(r.url()); });
    await wire(watcher);
    await watcher.goto(KIOSK_URL, { waitUntil: 'networkidle' });
    await enterSearch(watcher);
    await watcher.keyboard.type('ada');
    await watcher.waitForTimeout(1600);
    await watcher.close();

    assert.ok(urls.length > 0, 'no RPC requests were made');
    const dirty = urls.filter((u) => u.includes('?'));
    assert.deepEqual(dirty, [], 'RPC URLs must have no query string');
  });

  console.log('\nOffline shell (PWA)');
  await check('the manifest and service worker are served', async () => {
    const manifest = await fetch(BASE + '/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    const parsed = JSON.parse(await manifest.text());
    assert.equal(parsed.start_url, '/');
    assert.equal((await fetch(BASE + '/sw.js')).status, 200);
  });
  await check('the service worker registers and caches the app shell', async () => {
    const swPage = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
    await wire(swPage);
    await swPage.goto(KIOSK_URL, { waitUntil: 'networkidle' });
    await swPage.waitForFunction(() => navigator.serviceWorker.controller !== null
      || navigator.serviceWorker.ready.then(() => true), null, { timeout: 8000 });
    const cached = await swPage.evaluate(async () => {
      const keys = await caches.keys();
      if (!keys.length) return [];
      const cache = await caches.open(keys[0]);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });
    assert.ok(cached.includes('/index.html') || cached.includes('/'),
      `app shell not cached: ${JSON.stringify(cached)}`);
    await swPage.close();
  });

  await check('no uncaught JavaScript errors during the whole run', async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  // Reporting a pass count alone once let a red run read as green.
  if (failed) console.log(`\n${passed} passed, ${failed} FAILED.`);
  else console.log(`\n${passed} checks passed.`);
})();
