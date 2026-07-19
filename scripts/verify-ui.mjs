/**
 * Headless UI verification: drives the built webview (test/ui/harness.html)
 * through every core interaction — create, connect, edit, delete, undo, drag,
 * districts, lenses, focus, trace, time-lapse, plans, docs, theming — and
 * asserts on both the DOM and the message traffic the webview posts.
 *
 * Usage:  npm run build && node scripts/verify-ui.mjs [--shots <dir>]
 * Needs:  playwright-core (dev-only) and a Chromium (ATLAS_CHROMIUM env var,
 *         or an install under PLAYWRIGHT_BROWSERS_PATH / /opt/pw-browsers).
 *
 * Exits non-zero if any check fails, so it can gate a release.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run: npm install --no-save playwright-core');
  process.exit(2);
}

function findChromium() {
  if (process.env.ATLAS_CHROMIUM) return process.env.ATLAS_CHROMIUM;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const dir of roots) {
    try {
      const hit = execSync(`ls -d ${dir}/chromium-*/chrome-linux/chrome 2>/dev/null`)
        .toString()
        .trim()
        .split('\n')[0];
      if (hit) return hit;
    } catch {
      /* keep looking */
    }
  }
  return undefined; // let playwright-core try its default resolution
}

if (!existsSync(path.join(root, 'dist', 'webview.js'))) {
  console.error('dist/webview.js not found — run `npm run compile` first.');
  process.exit(2);
}

const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 880 } });
page.setDefaultTimeout(8000); // fail fast — a hung actionability check is a finding, not a wait
page.on('dialog', (dialog) => dialog.accept()); // confirm() dialogs (delete/abandon)
const url = 'file://' + path.join(root, 'test', 'ui', 'harness.html');
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).split('\n')[0]));

/* ------------------------------- helpers -------------------------------- */

const results = [];
let section = '';
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Recover between attempts so one failure can't cascade into the next check:
// leave any overlay/mode a failed check may have left open, release stuck
// pointer state, and park the mouse on neutral water.
async function recover() {
  try {
    await page.mouse.up().catch(() => {});
    const exit = page.locator('.atlas-timelapse button:has-text("Exit")');
    if ((await exit.count()) > 0) await exit.click({ timeout: 1000 });
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
    await page.mouse.move(60, 840);
    await page.waitForTimeout(300);
  } catch {
    /* best effort */
  }
}

async function check(name, fn) {
  // One retry after recovery: environment jitter passes on the second run,
  // a real defect fails both attempts.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fn();
      results.push({ section, name, ok: true });
      return;
    } catch (error) {
      if (shotsDir) {
        await page
          .screenshot({ path: path.join(shotsDir, `fail-${results.length + 1}-try${attempt}.png`) })
          .catch(() => {});
      }
      await recover();
      if (attempt >= 2) {
        results.push({
          section,
          name,
          ok: false,
          err: String(error?.message ?? error).split('\n')[0],
        });
        return;
      }
    }
  }
}

async function fresh() {
  await page.goto('about:blank');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(url);
  await page.waitForSelector('.atlas-node', { timeout: 8000 });
  await page.waitForTimeout(700); // let the initial fitView animation finish
  // Normalize the viewport: the mount-time fit can land differently from run
  // to run, and geometry-dependent checks need every node on screen.
  await page.click('.react-flow__controls-fitview').catch(() => {});
  await page.waitForTimeout(400);
}

const model = () => page.evaluate(() => window.__store.model);
const posted = (type) =>
  page.evaluate((t) => window.__store.posted.filter((m) => m.type === t).length, type);
const nodeEl = (name) =>
  page.locator(`.react-flow__node:has(.atlas-node__name:text-is("${name}"))`);

async function dragBetween(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Engage the drag with a small move and a beat before travelling: firing the
  // whole path in one event burst can outrun drag initialization, leaving the
  // node exactly where it was.
  await page.mouse.move(from.x + 4, from.y + 4);
  await page.waitForTimeout(80);
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    if (i % 4 === 0) {
      await page.waitForTimeout(20);
    }
  }
  await page.waitForTimeout(60);
  await page.mouse.up();
}

const center = (bb) => ({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
const settle = (ms = 450) => page.waitForTimeout(ms); // > persist debounce (250ms)

/* --------------------------- A. create & wire ---------------------------- */

section = 'create & wire';
await fresh();

await check('fixture renders: 6 components, 6 connections, 2 districts', async () => {
  expect((await page.locator('.atlas-node').count()) === 6, 'expected 6 component cards');
  expect((await page.locator('.react-flow__edge').count()) === 6, 'expected 6 edges');
  expect((await page.locator('.atlas-group').count()) === 2, 'expected 2 district regions');
});

await check('palette click adds a component and selects it', async () => {
  const base = await page.locator('.atlas-node').count();
  await page.click('.atlas-palette__item:has(.atlas-palette__label:text-is("Queue"))');
  await settle();
  expect((await page.locator('.atlas-node').count()) === base + 1, 'node card did not appear');
  const m = await model();
  expect(m.nodes.length === base + 1, 'model did not persist the new node');
  expect(
    (await page.locator('.atlas-inspector input.atlas-input').first().inputValue()) === 'Queue',
    'inspector did not open on the new node',
  );
});

await check('drag from source handle to target handle creates a connection', async () => {
  const connected = async () =>
    (await model()).edges.some((e) => e.source === 'inv' && e.target === 'pay');
  for (let attempt = 0; attempt < 3 && !(await connected()); attempt += 1) {
    const src = await nodeEl('Inventory Service')
      .locator('.react-flow__handle.source')
      .boundingBox();
    const tgt = await nodeEl('Payments').locator('.react-flow__handle.target').boundingBox();
    expect(src && tgt, 'handles not found');
    await dragBetween(center(src), center(tgt));
    await settle();
  }
  const m = await model();
  expect(
    m.edges.some((e) => e.source === 'inv' && e.target === 'pay'),
    'edge inv→pay missing from model',
  );
  expect(
    (await page.locator('.react-flow__edge').count()) === m.edges.length,
    'edge not rendered',
  );
});

await check('clicking a connection opens it; protocol edit persists', async () => {
  await page.locator('[data-testid="rf__edge-e1"]').click({ force: true });
  await page.waitForTimeout(250);
  const select = page.locator('.atlas-inspector select.atlas-input').first();
  expect((await select.count()) === 1, 'edge inspector did not open');
  await select.selectOption('graphql');
  await settle();
  const m = await model();
  expect(
    m.edges.find((e) => e.id === 'e1')?.protocol === 'graphql',
    'protocol change not persisted',
  );
});

await check('delete connection from inspector; undo restores; redo removes', async () => {
  await page.locator('[data-testid="rf__edge-e1"]').click({ force: true });
  await page.waitForTimeout(250);
  const base = (await model()).edges.length;
  await page.click('.atlas-button--danger:has-text("Delete")');
  await settle();
  expect((await model()).edges.length === base - 1, 'edge not deleted');
  await page.mouse.click(700, 800); // focus the canvas background
  await page.keyboard.press('Control+z');
  await settle();
  expect((await model()).edges.length === base, 'undo did not restore the edge');
  await page.keyboard.press('Control+Shift+z');
  await settle();
  expect((await model()).edges.length === base - 1, 'redo did not re-remove the edge');
});

/* ------------------------- B. direct manipulation ------------------------ */

section = 'direct manipulation';
await fresh();

await check('dragging a component moves it; one undo restores the position', async () => {
  const before = (await model()).nodes.find((n) => n.id === 'pay').position;
  // Headless event bursts occasionally fail to engage the drag at all; a real
  // pointer cannot. Re-issue the gesture until it takes, then assert on what
  // an engaged drag did.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bb = await nodeEl('Payments').boundingBox();
    await dragBetween(center(bb), { x: bb.x + bb.width / 2 + 90, y: bb.y + bb.height / 2 + 70 });
    await settle();
    const moved = (await model()).nodes.find((n) => n.id === 'pay').position;
    if (moved.x !== before.x || moved.y !== before.y) break;
  }
  const after = (await model()).nodes.find((n) => n.id === 'pay').position;
  expect(after.x !== before.x || after.y !== before.y, 'position did not change');
  await page.keyboard.press('Control+z');
  await settle();
  const undone = (await model()).nodes.find((n) => n.id === 'pay').position;
  expect(
    Math.abs(undone.x - before.x) < 1 && Math.abs(undone.y - before.y) < 1,
    'one undo did not restore the drag',
  );
});

await check('dragging a component into a district joins it; out leaves it', async () => {
  const region = page.locator('.react-flow__node:has(.atlas-group__name:text-is("Orders"))');
  const grp = async () => (await model()).nodes.find((n) => n.id === 'pay').groupId ?? null;
  for (let attempt = 0; attempt < 3 && (await grp()) !== 'ord'; attempt += 1) {
    const rb = await region.boundingBox();
    const pb = await nodeEl('Payments').boundingBox();
    await dragBetween(center(pb), { x: rb.x + rb.width / 2, y: rb.y + rb.height - 24 });
    await settle();
  }
  expect((await grp()) === 'ord', 'did not join district');
  for (let attempt = 0; attempt < 3 && (await grp()) !== null; attempt += 1) {
    const pb2 = await nodeEl('Payments').boundingBox();
    await dragBetween(center(pb2), { x: 500, y: 780 });
    await settle();
  }
  expect((await grp()) === null, 'did not leave district');
});

await check('Backspace deletes the selected component and its connections', async () => {
  await nodeEl('Orders DB').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await settle();
  const m = await model();
  expect(!m.nodes.some((n) => n.id === 'db'), 'node not deleted');
  expect(!m.edges.some((e) => e.source === 'db' || e.target === 'db'), 'dangling edges left');
  await page.keyboard.press('Control+z');
  await settle();
  expect((await model()).nodes.some((n) => n.id === 'db'), 'undo did not restore the node');
});

/* --------------------------- C. modes & lenses --------------------------- */

section = 'modes & lenses';
await fresh();

await check('hovering a component highlights its connections', async () => {
  const bb = await nodeEl('API Gateway').boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(300);
  expect((await page.locator('.react-flow__edge.atlas-edge-hl').count()) > 0, 'no highlighted edges');
  expect((await page.locator('.react-flow__node.atlas-faded').count()) > 0, 'no dimmed nodes');
  await page.mouse.move(500, 800);
  await page.waitForTimeout(400);
});

await check('legend type filter dims non-matching components', async () => {
  const row = page.locator('.atlas-legend__row--filter').first();
  await row.click();
  await page.waitForTimeout(250);
  expect((await page.locator('.react-flow__node.atlas-faded').count()) > 0, 'nothing dimmed');
  await row.click();
  await page.waitForTimeout(200);
});

await check('coverage and traffic lenses paint overlay tones', async () => {
  await page.click('.atlas-lens:text-is("Coverage")');
  await page.waitForTimeout(250);
  expect((await page.locator('.atlas-node--ov-ok').count()) > 0, 'coverage: no mapped tones');
  expect((await page.locator('.atlas-node--ov-warn').count()) > 0, 'coverage: no unmapped tones');
  await page.click('.atlas-lens:text-is("Traffic")');
  await page.waitForTimeout(250);
  expect((await page.locator('.atlas-node--ov-hot').count()) > 0, 'traffic: no hot hub');
  await page.click('.atlas-lens:text-is("Structure")');
});

await check('district focus mode: ◎ enters, Esc exits', async () => {
  await page.click('button[title="Focus this context (dim everything else)"]');
  await page.waitForTimeout(400);
  expect((await page.locator('.atlas-mode-pill:has-text("Focus")').count()) === 1, 'no focus pill');
  expect((await page.locator('.react-flow__node.atlas-faded').count()) > 0, 'nothing receded');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect((await page.locator('.atlas-mode-pill:has-text("Focus")').count()) === 0, 'focus did not exit');
});

await check('path tracing: shift-click lights the route', async () => {
  await nodeEl('Web App').click();
  await page.waitForTimeout(200);
  await page.mouse.move(700, 800); // clear hover so the target is not dimmed
  await page.waitForTimeout(300);
  await nodeEl('Orders DB').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(300);
  const pill = page.locator('.atlas-mode-pill:has-text("Path")');
  expect((await pill.count()) === 1, 'no path pill');
  expect((await pill.textContent()).includes('3 hops'), 'expected a 3-hop route');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect((await page.locator('.atlas-mode-pill:has-text("Path")').count()) === 0, 'trace did not clear');
});

await check('time-lapse scrubs history and exits clean', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.atlas-palette-modal__input', 'Time-lapse');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.atlas-timelapse', { timeout: 4000 });
  await page.focus('.atlas-timelapse__slider');
  await page.keyboard.press('ArrowLeft'); // the slider reads left→right as past→now
  await page.waitForTimeout(400);
  expect((await page.locator('.atlas-node').count()) === 3, 'scrub did not load the old map');
  await page.click('.atlas-timelapse button:has-text("Exit")');
  await page.waitForTimeout(400);
  expect((await page.locator('.atlas-node').count()) === 6, 'exit did not restore the map');
});

await check('district collapse hides members and reroutes connections', async () => {
  await page.click(
    '.react-flow__node:has(.atlas-group__name:text-is("Orders")) button[title="Collapse context"]',
  );
  await page.waitForTimeout(350);
  expect((await page.locator('.atlas-collapsed').count()) === 1, 'no collapsed chip');
  expect((await page.locator('.atlas-node').count()) === 3, 'members still visible');
  expect((await page.locator('.react-flow__edge').count()) > 0, 'edges disappeared');
  await page.click('button[title="Expand context"]');
  await page.waitForTimeout(350);
  expect((await page.locator('.atlas-node').count()) === 6, 'expand did not restore members');
});

/* -------------------------------- D. plans ------------------------------- */

section = 'plans';
await fresh();

await check('plan sandbox: edits never touch atlas.yaml and close restores', async () => {
  await page.click('button:has-text("◈ Plan")');
  await page.waitForSelector('.atlas-mode-pill--plan', { timeout: 4000 });
  await page.fill('.atlas-plan input.atlas-input', 'Test plan');
  await nodeEl('Orders DB').click();
  await page.waitForTimeout(250);
  await page.locator('.atlas-inspector input.atlas-input').first().fill('Orders DB v2');
  await page.waitForTimeout(300);
  await page.click('.atlas-tab:text-is("Plan")');
  await page.waitForTimeout(500);
  expect((await page.locator('.atlas-plan__chip').count()) === 4, 'blast radius should be 4');
  expect((await page.locator('.atlas-node--ov-info').count()) === 1, 'changed node not lit');
  expect((await posted('model:changed')) === 0, 'sandbox leaked a model:changed');
  await page.click('.atlas-mode-pill--plan');
  await page.waitForTimeout(400);
  expect((await nodeEl('Orders DB').count()) === 1, 'close did not restore the real map');
  expect((await posted('plan:save')) > 0, 'plan was never saved');
});

await check('undo inside a plan stays inside the plan', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.atlas-palette-modal__input', 'New plan');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.atlas-mode-pill--plan', { timeout: 4000 });
  await nodeEl('Payments').click();
  await page.waitForTimeout(200);
  await page.locator('.atlas-inspector input.atlas-input').first().fill('Payments v2');
  await page.waitForTimeout(250);
  await page.mouse.click(700, 800);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect((await nodeEl('Payments').count()) === 1, 'undo did not revert the sandbox edit');
  await page.keyboard.press('Escape'); // close plan
  await page.waitForTimeout(300);
  expect((await posted('model:changed')) === 0, 'plan-mode undo leaked to atlas.yaml');
});

await check('decided plan tracks build progress live against reality', async () => {
  // Re-runnable: restore reality from the host store first — a failed earlier
  // attempt may have left the pushed "caught up" model behind.
  await page.evaluate(() =>
    window.__pushHost({ type: 'model:loaded', model: window.__store.model }),
  );
  await page.waitForTimeout(300);
  // Decide a plan that renames the DB, then watch reality catch up.
  await page.click('button:has-text("◈ Plan")');
  await page.waitForSelector('.atlas-mode-pill--plan', { timeout: 4000 });
  await page.fill('.atlas-plan input.atlas-input', 'Privatize the DB');
  await nodeEl('Orders DB').click();
  await page.waitForTimeout(250);
  await page.locator('.atlas-inspector input.atlas-input').first().fill('Orders DB (private)');
  await page.waitForTimeout(300);
  await page.click('.atlas-tab:text-is("Plan")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Generate ADR")');
  await page.waitForSelector('.atlas-plan__adr', { timeout: 4000 });
  await page.waitForTimeout(300);
  // Deciding froze the baseline → the checklist appears, nothing built yet.
  expect((await page.locator('.atlas-plan__task').count()) === 1, 'no progress checklist');
  expect(
    (await page.locator('.atlas-plan__task--done').count()) === 0,
    'nothing should be built yet',
  );
  expect(
    (await page.locator('.atlas-plan__progress-count').textContent()).includes('0/1'),
    'expected 0/1 built',
  );
  // Reality catches up: the host reloads a model where the rename landed.
  await page.evaluate(() => {
    const m = JSON.parse(JSON.stringify(window.__store.model));
    m.nodes.find((n) => n.id === 'db').name = 'Orders DB (private)';
    window.__pushHost({ type: 'model:loaded', model: m });
  });
  await page.waitForTimeout(400);
  expect(
    (await page.locator('.atlas-plan__task--done').count()) === 1,
    'progress did not update from the live model',
  );
  expect(
    (await page.locator('.atlas-plan__progress-count').textContent()).includes('1/1'),
    'expected 1/1 built',
  );
  expect(
    (await page.locator('.atlas-node--ov-ok').count()) === 1,
    'built change did not turn green on the map',
  );
  await page.click('.atlas-mode-pill--plan'); // close the plan
  await page.waitForTimeout(300);
});

/* ------------------------ E. clarity & lifecycle -------------------------- */

section = 'clarity & lifecycle';
await fresh();

await check('posture chip tells the truth about where edits go', async () => {
  expect(
    (await page.locator('.atlas-posture').first().textContent()).includes('Live edit'),
    'default posture should read Live edit',
  );
  await page.click('button:has-text("◈ Plan")');
  await page.waitForSelector('.atlas-mode-pill--plan');
  expect(
    (await page.locator('.atlas-posture').first().textContent()).includes('Sandbox'),
    'plan mode posture should read Sandbox',
  );
  await page.click('.atlas-mode-pill--plan');
  await page.waitForTimeout(300);
  expect(
    (await page.locator('.atlas-posture').first().textContent()).includes('Live edit'),
    'posture should return to Live edit after closing the plan',
  );
});

await check('one banner at a time; drift is a chip, not a banner', async () => {
  await page.evaluate(() => {
    window.__pushHost({ type: 'model:error', message: 'Broken atlas.yaml (test)' });
    window.__pushHost({
      type: 'ai:error',
      code: 'failed',
      message: 'AI failed (test)',
    });
    window.__pushHost({ type: 'drift:status', driftedNodeIds: ['db'] });
  });
  await page.waitForTimeout(300);
  expect((await page.locator('.atlas-banner').count()) === 1, 'expected exactly one banner');
  const chip = page.locator('.atlas-posture--drift');
  expect((await chip.count()) === 1, 'drift chip missing');
  expect((await chip.textContent()).includes('1 drifted'), 'drift chip count wrong');
  await chip.click();
  await page.waitForTimeout(500);
  expect(
    (await page.locator('.atlas-inspector input.atlas-input').first().inputValue()) === 'Orders DB',
    'drift chip click did not focus the drifted component',
  );
  // Clear the injected states for the next checks.
  await page.evaluate(() => {
    window.__pushHost({ type: 'model:loaded', model: window.__store.model });
    window.__pushHost({ type: 'drift:status', driftedNodeIds: [] });
  });
  await page.waitForTimeout(300);
});

await check('Health tab merges rule violations and structural findings', async () => {
  await page.click('.atlas-tab:has-text("Health")');
  await page.waitForTimeout(300);
  expect((await page.locator('.atlas-health__grade').count()) === 1, 'no health grade');
  expect((await page.locator('.atlas-issue').count()) > 0, 'no findings listed');
  const badge = await page.locator('.atlas-tab:has-text("Health") .atlas-tab__badge').textContent();
  expect(Number(badge) > 0, 'health badge missing');
  const first = page.locator('.atlas-issue').first();
  await first.click();
  await page.waitForTimeout(400);
  expect(
    (await page.locator('.atlas-tab--active').first().textContent()) !== 'Health' ||
      (await page.locator('.atlas-inspector').count()) > 0,
    'clicking a finding did nothing',
  );
});

await check('⌘K groups actions, plans, components — verbs first', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.atlas-palette-modal__input');
  const sections = await page.locator('.atlas-command__section').allTextContents();
  expect(sections[0] === 'Actions', 'Actions section not first');
  expect(sections.includes('Components'), 'Components section missing');
  const firstLabel = await page.locator('.atlas-command__label').first().textContent();
  expect(firstLabel === 'Detect with AI', 'first command should be Detect with AI');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

await check('a built plan is marked applied only after the code verifies', async () => {
  await page.click('button:has-text("◈ Plan")');
  await page.waitForSelector('.atlas-mode-pill--plan');
  await page.fill('.atlas-plan input.atlas-input', 'Verified build');
  await nodeEl('Payments').click();
  await page.waitForTimeout(250);
  await page.locator('.atlas-inspector input.atlas-input').first().fill('Payments Gateway');
  await page.waitForTimeout(300);
  await page.click('.atlas-tab:text-is("Plan")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Build it")');
  await page.waitForSelector('.atlas-modal, [role="dialog"]');
  await page.click('button:has-text("Generate code")');
  await page.waitForTimeout(80); // before the harness's simulated apply:done
  const during = await page.evaluate(() => {
    const saves = window.__store.posted.filter((m) => m.type === 'plan:save');
    return saves[saves.length - 1]?.plan.status;
  });
  expect(during !== 'applied', 'plan claimed applied before the build verified');
  await page.waitForTimeout(600); // apply:done (verified) arrives
  const after = await page.evaluate(() => {
    const saves = window.__store.posted.filter((m) => m.type === 'plan:save');
    return saves[saves.length - 1]?.plan.status;
  });
  expect(after === 'applied', 'verified build did not mark the plan applied');
  // Close the diff overlay the apply produced.
  await page.click('button:has-text("Close")').catch(() => {});
  await page.waitForTimeout(200);
});

await check('a named draft sheds its untitled file name when it leaves', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.atlas-palette-modal__input', 'New plan');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.atlas-mode-pill--plan');
  await page.fill('.atlas-plan input.atlas-input', 'Ship the reslug');
  await page.waitForTimeout(200);
  await page.click('.atlas-mode-pill--plan'); // close → re-slug happens here
  await page.waitForTimeout(400);
  const renamed = await page.evaluate(() =>
    window.__store.posted.some(
      (m) => m.type === 'plan:rename' && m.to === 'ship-the-reslug.yaml',
    ),
  );
  expect(renamed, 'plan:rename was not posted for the named draft');
  const files = await page.evaluate(() => [...window.__store.plans.keys()]);
  expect(files.includes('ship-the-reslug.yaml'), 'renamed plan file missing from store');
});

await check('abandoning a plan removes it from ⌘K but keeps the file', async () => {
  await page.click('button:has-text("◈ Plan")');
  await page.waitForSelector('.atlas-mode-pill--plan');
  await page.fill('.atlas-plan input.atlas-input', 'Doomed idea');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Abandon plan")'); // confirm auto-accepted
  await page.waitForTimeout(400);
  expect((await page.locator('.atlas-mode-pill--plan').count()) === 0, 'plan mode did not exit');
  await page.keyboard.press('Control+k');
  await page.fill('.atlas-palette-modal__input', 'Doomed');
  await page.waitForTimeout(250);
  expect(
    (await page.locator('.atlas-command:has-text("Doomed")').count()) === 0,
    'abandoned plan still listed in ⌘K',
  );
  await page.keyboard.press('Escape');
  const kept = await page.evaluate(() =>
    [...window.__store.plans.values()].some((p) => p.status === 'abandoned'),
  );
  expect(kept, 'abandoned plan file should stay on disk');
});

/* ---------------------------- F. chrome & docs ---------------------------- */

section = 'chrome & docs';
await fresh();

await check('theme toggle switches to paper chart and survives reload', async () => {
  await page.click('.atlas-theme-toggle');
  await page.waitForTimeout(200);
  expect(
    (await page.locator('.atlas-app[data-theme="light"]').count()) === 1,
    'light theme not applied',
  );
  await page.reload();
  await page.waitForSelector('.atlas-node', { timeout: 8000 });
  await page.waitForTimeout(400);
  expect(
    (await page.locator('.atlas-app[data-theme="light"]').count()) === 1,
    'theme did not persist across reload',
  );
  await page.click('.atlas-theme-toggle');
});

await check('⌘K search jumps to and selects a component', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.atlas-palette-modal__input', 'Inventory');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  expect(
    (await page.locator('.atlas-inspector input.atlas-input').first().inputValue()) ===
      'Inventory Service',
    'inspector did not land on the component',
  );
});

await check('sidebar collapse persists across reload', async () => {
  await page.click('.atlas-tabs__collapse');
  await page.waitForTimeout(200);
  expect((await page.locator('.atlas-rail').count()) >= 1, 'rail not shown');
  await page.reload();
  await page.waitForSelector('.atlas-node', { timeout: 8000 });
  await page.waitForTimeout(400);
  expect((await page.locator('.atlas-rail').count()) >= 1, 'collapse state lost on reload');
  await page.locator('.atlas-rail').last().click();
});

await check('docs tab lists the catalogue and opens the reader', async () => {
  await page.click('.atlas-tab:text-is("Docs")');
  await page.waitForSelector('.atlas-doc__title', { timeout: 4000 });
  await page.click('.atlas-doc__main:has-text("Orders Service")');
  await page.waitForTimeout(400);
  const body = await page.textContent('body');
  expect(body.includes('Owns the order lifecycle'), 'reader did not render the document');
  await page.keyboard.press('Escape');
});

await check('dragging between nodes creates a connection (from either handle)', async () => {
  await page.evaluate(() =>
    window.__pushHost({
      type: 'model:loaded',
      model: {
        version: 1,
        nodes: [
          { id: 'a', name: 'Alpha', type: 'service', description: '', position: { x: 120, y: 140 } },
          { id: 'b', name: 'Beta', type: 'service', description: '', position: { x: 520, y: 140 } },
        ],
        edges: [],
        groups: [],
      },
    }),
  );
  await page.waitForTimeout(400);
  // Start the drag on Beta's LEFT (target) handle — the strict default mode
  // silently rejected this, which is exactly the regression this guards.
  const from = await page
    .locator('.react-flow__node[data-id="b"] .react-flow__handle-left')
    .boundingBox();
  const toNode = await page.locator('.react-flow__node[data-id="a"]').boundingBox();
  expect(!!from && !!toNode, 'handles not found');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Drop near Alpha's right edge — connectionRadius should snap it home.
  await page.mouse.move(toNode.x + toNode.width - 2, toNode.y + toNode.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await page.locator('.react-flow__edge').count()) === 1, 'edge was not created');
});

await check('empty map shows the getting-started actions', async () => {
  await page.evaluate(() =>
    window.__pushHost({ type: 'model:loaded', model: { version: 1, nodes: [], edges: [], groups: [] } }),
  );
  await page.waitForTimeout(300);
  expect((await page.locator('.atlas-empty').count()) === 1, 'empty state missing');
  expect(
    (await page.locator('.atlas-empty button:has-text("Detect with AI")').count()) === 1,
    'primary action missing',
  );
});

/* -------------------------------- report --------------------------------- */

await browser.close();

let failed = 0;
let lastSection = '';
for (const r of results) {
  if (r.section !== lastSection) {
    lastSection = r.section;
    console.log(`\n${r.section}`);
  }
  if (r.ok) {
    console.log(`  ✓ ${r.name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${r.name}\n      ${r.err}`);
  }
}
if (pageErrors.length > 0) {
  console.log(`\npage errors:\n  ${[...new Set(pageErrors)].join('\n  ')}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 && pageErrors.length === 0 ? 0 : 1);
