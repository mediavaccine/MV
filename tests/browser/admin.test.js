const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.MV_TEST_BASE || 'http://127.0.0.1:8897';
const ADMIN = BASE + '/admin/';

let passed = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.message || '').split('\n')[0]); process.exitCode = 1; }
}
const db = async () => (await fetch(BASE + '/__db')).json();

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MV_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];

  async function newPage() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(5000);
    // Everything the app calls on supabase.co goes to the local mock instead.
    await page.route('**/*', (r) => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await page.route('**/{rest,auth,storage}/v1/**', async (route) => {
      const req = route.request();
      const target = BASE + new URL(req.url()).pathname + new URL(req.url()).search;
      const res = await fetch(target, {
        method: req.method(),
        headers: { 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(req.method()) ? undefined : (req.postData() || ''),
      });
      await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/Failed to load resource/.test(m.text())) return;
      errors.push(m.text());
    });
    return page;
  }

  // page.once('dialog') registered twice fires BOTH handlers on the first
  // dialog. One handler with a queue gives one response per dialog.
  function expectDialogs(page, responses) {
    const queue = responses.slice();
    const handler = async (dialog) => {
      const next = queue.shift();
      if (next === undefined) return dialog.dismiss();
      if (next === true) return dialog.accept();
      return dialog.accept(String(next));
    };
    page.on('dialog', handler);
    return () => page.off('dialog', handler);
  }

  async function open(page, hash, anchor) {
    await page.goto(ADMIN + hash, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector(anchor);
    } catch (error) {
      // Say what was on screen instead, so a failure here is diagnosable from
      // a CI log rather than only reproducible locally.
      const seen = await page.evaluate(() => ({
        hash: location.hash,
        toast: (document.getElementById('toast') || {}).textContent || '',
        panel: ((document.querySelector('.panel') || {}).innerText || '').slice(0, 300),
        root: ((document.querySelector('.root') || {}).innerText || '').slice(0, 300),
      })).catch(() => ({}));
      throw new Error(`${anchor} never appeared. state=${JSON.stringify(seen)}`);
    }
  }

  async function signIn(page, password = 'correct-horse') {
    await page.goto(ADMIN, { waitUntil: 'networkidle' });
    await page.fill('input[type=email]', 'admin@mediavaccine.test');
    await page.fill('input[type=password]', password);
    await page.click('.btn--primary');
  }

  await fetch(BASE + '/__reset');
  const page = await newPage();

  console.log('\nAuthentication');
  await check('an unauthenticated visitor gets the login screen', async () => {
    await page.goto(ADMIN, { waitUntil: 'networkidle' });
    assert.equal(await page.isVisible('.login'), true);
    assert.equal(await page.isVisible('#chrome'), false);
  });
  await check('a wrong password is refused with a readable message', async () => {
    await signIn(page, 'wrong');
    await page.waitForSelector('.toast--error');
    assert.match(await page.textContent('#toast'), /invalid login credentials/i);
    assert.equal(await page.isVisible('.login'), true);
  });
  await check('a valid sign-in reaches the event list', async () => {
    await signIn(page);
    await page.waitForSelector('.table');
    assert.match(await page.textContent('.root'), /Demo Gala 2026/);
    assert.equal(await page.isVisible('#chrome'), true);
  });
  await check('a signed-in non-admin is rejected, not shown an empty dashboard', async () => {
    await fetch(BASE + '/__unauthorised/1');
    const other = await newPage();
    await signIn(other);
    await other.waitForSelector('.toast--error');
    assert.match(await other.textContent('#toast'), /not an administrator/i);
    assert.equal(await other.isVisible('.login'), true);
    await other.close();
    await fetch(BASE + '/__unauthorised/0');
  });

  console.log('\nEvents');
  await check('a new event can be created and the slug auto-fills', async () => {
    await page.click('.btn--primary');                       // New event
    await page.fill('input[type=text]', 'Summer Party 2027');
    const slug = await page.inputValue('.form input[type=text] >> nth=1');
    assert.equal(slug, 'summer-party-2027');
  });
  await check('a duplicate slug is reported in plain words', async () => {
    await page.fill('.form input[type=text] >> nth=1', 'demo-gala-2026');
    await page.click('.btn--primary');
    await page.waitForSelector('.toast--error');
    assert.match(await page.textContent('#toast'), /already used/i);
  });
  await check('creating an event navigates into it', async () => {
    await page.fill('.form input[type=text] >> nth=1', 'summer-party-2027');
    await page.click('.btn--primary');
    await page.waitForSelector('.tabs');
    assert.match(await page.textContent('.page-head'), /Summer Party 2027/);
    assert.ok((await db()).events.some((e) => e.slug === 'summer-party-2027'));
  });

  console.log('\nGuests');
  await check('the guest list loads', async () => {
    await open(page, '#/events/demo-gala-2026/guests', '.table tbody tr');
    assert.equal(await page.locator('.table tbody tr').count(), 3);
  });
  await check('search filters the list', async () => {
    await page.fill('.search-input', 'bukki');
    assert.equal(await page.locator('.table tbody tr').count(), 1);
    await page.fill('.search-input', '');
  });
  await check('a guest can be added by hand', async () => {
    await page.fill('.add-row input >> nth=0', 'New Person');
    await page.fill('.add-row input >> nth=1', 'Table 9');
    await page.click('.add-row .btn--primary');
    await page.waitForSelector('.toast--ok');
    assert.ok((await db()).guests.some((g) => g.full_name === 'New Person' && g.source === 'manual'));
  });
  await check('a table can be edited inline', async () => {
    const cell = page.locator('.table tbody tr', { hasText: 'Adaeze' }).locator('.editable >> nth=1');
    await cell.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Table 7');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.equal((await db()).guests.find((g) => g.full_name === 'Adaeze Okonkwo').table_number, 'Table 7');
  });
  await check('Escape abandons an inline edit without saving', async () => {
    const cell = page.locator('.table tbody tr', { hasText: 'Bukki' }).locator('.editable >> nth=1');
    await cell.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Nonsense');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal((await db()).guests.find((g) => g.full_name === 'Bukki Solanke').table_number, 'Head Table');
  });
  await check('bulk reassignment moves every selected guest', async () => {
    await page.check('.table tbody tr >> nth=0 >> input[type=checkbox]');
    await page.check('.table tbody tr >> nth=1 >> input[type=checkbox]');
    await page.fill('.bulk input', 'Table 12');
    await page.click('.bulk .btn--primary');
    await page.waitForSelector('.toast--ok');
    const moved = (await db()).guests.filter((g) => g.table_number === 'Table 12');
    assert.equal(moved.length, 2);
  });

  console.log('\nCSV wizard');
  const CSV = 'Full Name,Table No,Party,Meal\r\n"Solanke, Bukki",5,smith,Fish\r\nAda Smith,5,smith,Beef\r\nZoe Ardeche,,solo,Vegetarian\r\n';
  await check('a CSV is parsed and columns are auto-detected', async () => {
    await open(page, '#/events/demo-gala-2026/upload', 'input[type=file]');
    await page.setInputFiles('input[type=file]', { name: 'guests.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
    await page.waitForSelector('text=Step 2');
    const roles = await page.locator('.table--tight select').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(roles, ['full_name', 'table_number', 'group_id', 'extra']);
  });
  await check('a quoted comma inside a name survives parsing', async () => {
    assert.match(await page.textContent('.table--tight tbody'), /Solanke, Bukki/);
  });
  await check('choosing a role frees it from the other column', async () => {
    await page.selectOption('.table--tight select >> nth=3', 'full_name');
    const roles = await page.locator('.table--tight select').evaluateAll((els) => els.map((e) => e.value));
    assert.equal(roles.filter((r) => r === 'full_name').length, 1);
    await page.selectOption('.table--tight select >> nth=0', 'full_name');
    await page.selectOption('.table--tight select >> nth=3', 'extra');
  });
  await check('removing every name column blocks continuing', async () => {
    await page.selectOption('.table--tight select >> nth=0', 'extra');
    await page.waitForSelector('.warn:visible');
    assert.equal(await page.locator('.btn--primary').first().isDisabled(), true);
    await page.selectOption('.table--tight select >> nth=0', 'full_name');
  });
  await check('the strategy step warns about guests with no table', async () => {
    await page.click('.form-actions .btn--primary');
    await page.waitForSelector('text=Step 3');
    assert.match(await page.textContent('.card'), /1 of 3 guests have no table/);
  });
  await check('balanced assignment keeps a party together', async () => {
    await page.selectOption('.card select', 'auto-balanced');
    await page.fill('input[type=number]', '2');
    await page.waitForSelector('.chips .chip');
    const chips = await page.locator('.chip').allTextContents();
    assert.ok(chips.some((c) => /Table 1: 2/.test(c)) || chips.some((c) => /Table 2: 2/.test(c)),
      `party not kept together: ${chips}`);
  });
  await check('replace mode states exactly what will be destroyed', async () => {
    await page.selectOption('.card select', 'provided-in-csv');
    await page.click('.form-actions .btn--primary');
    await page.waitForSelector('text=Step 4');
    assert.match(await page.textContent('.card'), /will be deleted and replaced/);
  });
  await check('merge mode explains the exact-name limitation', async () => {
    await page.selectOption('.card select', 'merge');
    await page.waitForTimeout(200);
    assert.match(await page.textContent('.card'), /Matching is by exact name/);
  });
  await check('importing replaces the guest list and logs the upload', async () => {
    await page.selectOption('.card select', 'replace');
    const done = expectDialogs(page, [true]);
    await page.click('.form-actions .btn--primary');
    await page.waitForSelector('.toast--ok');
    done();
    await page.waitForFunction(() => location.hash.endsWith('/guests'));
    const after = await db();
    assert.equal(after.guests.filter((g) => g.event_id === 'evt-1').length, 3);
    assert.equal(after.csv_uploads.length, 1);
    assert.equal(after.csv_uploads[0].mode, 'replace');
    assert.deepEqual(after.csv_uploads[0].column_mapping,
      { 'Full Name': 'full_name', 'Table No': 'table_number', Party: 'group_id', Meal: 'extra' });
  });
  await check('imported guests keep their extra fields', async () => {
    const ada = (await db()).guests.find((g) => g.full_name === 'Ada Smith');
    assert.deepEqual(ada.extra, { Meal: 'Beef' });
  });

  console.log('\nBranding');
  await check('the preview reflects an edited header immediately', async () => {
    await open(page, '#/events/demo-gala-2026/branding', '.preview-title');
    await page.fill('.card input[type=text] >> nth=3', 'Gala Night');
    assert.match(await page.textContent('.preview-title'), /Gala Night/);
  });
  await check('extra fields show which are visible to the kiosk', async () => {
    const rows = await page.locator('.schema-row').allTextContents();
    assert.ok(rows.some((r) => /meal/.test(r) && /shown on the kiosk/.test(r)));
    assert.ok(rows.some((r) => /phone/.test(r) && /never shown/.test(r)));
  });
  await check('saving branding persists it', async () => {
    await page.click('.form-actions .btn--primary');
    await page.waitForSelector('.toast--ok');
    assert.equal((await db()).events.find((e) => e.slug === 'demo-gala-2026').branding.header_text, 'Gala Night');
  });

  console.log('\nScreens');
  await check('the kiosk URL is shown and taggable screens are listed', async () => {
    await open(page, '#/events/demo-gala-2026/screens', '.url-row');
    assert.match(await page.textContent('.card'), /\/e\/demo-gala-2026/);
    assert.match(await page.textContent('.table'), /Main Entrance/);
  });
  await check('a bad tag is rejected before it reaches the database', async () => {
    await page.fill('.add-row input >> nth=0', 'Back Door');
    await page.fill('.add-row input >> nth=1', 'Back Door!');
    await page.click('.add-row .btn--primary');
    await page.waitForSelector('.toast--error');
    assert.match(await page.textContent('#toast'), /lowercase letters, numbers and hyphens/);
  });
  await check('a valid screen is added', async () => {
    await page.fill('.add-row input >> nth=1', 'back');
    await page.click('.add-row .btn--primary');
    await page.waitForSelector('.toast--ok');
    assert.ok((await db()).kiosk_instances.some((k) => k.url_param === 'back'));
  });

  console.log('\nAnalytics');
  await check('the dashboard renders totals and the no-match report', async () => {
    await open(page, '#/events/demo-gala-2026/analytics', '.stats');
    const stats = await page.locator('.stat-value').allTextContents();
    assert.deepEqual(stats.slice(0, 3), ['42', '30', '8']);
    assert.match(await page.textContent('.table'), /jon smyth/);
  });
  await check('a high no-match rate is flagged', async () => {
    assert.equal(await page.locator('.stat--warn').count(), 1);
  });
  await check('the hourly chart draws a bar per bucket', async () => {
    assert.equal(await page.locator('.chart-col').count(), 2);
  });

  console.log('\nDestructive actions');
  await check('archiving asks first and then stops the kiosk URL', async () => {
    await open(page, '#/events/summer-party-2027/guests', '.tabs');
    const done = expectDialogs(page, [true]);
    await page.click('.page-head .btn >> nth=0');
    await page.waitForSelector('.toast--ok');
    assert.equal((await db()).events.find((e) => e.slug === 'summer-party-2027').status, 'archived');
    done();
  });
  await check('permanent delete requires typing the slug', async () => {
    const done = expectDialogs(page, [true, 'wrong-slug']);   // confirm, then prompt
    await page.click('.btn--danger');
    await page.waitForTimeout(600);
    assert.ok((await db()).events.some((e) => e.slug === 'summer-party-2027'), 'deleted despite a wrong slug');
    done();
  });
  await check('permanent delete proceeds when the slug matches', async () => {
    const done = expectDialogs(page, [true, 'summer-party-2027']);
    await page.click('.btn--danger');
    await page.waitForSelector('.toast--ok');
    done();
    assert.ok(!(await db()).events.some((e) => e.slug === 'summer-party-2027'));
  });

  console.log('\nSession');
  await check('signing out returns to the login screen', async () => {
    await page.click('#chrome .btn');
    await page.waitForSelector('.login');
    assert.equal(await page.isVisible('#chrome'), false);
  });

  if (errors.length) { console.log('\n--- captured errors ---'); errors.forEach((e) => console.log('  * ' + e)); }
  await check('no uncaught JavaScript errors during the whole run', async () => {
    assert.equal(errors.length, 0, errors.length + ' error(s) captured');
  });

  await browser.close();
  console.log(`\n${passed} checks passed.`);
})();
