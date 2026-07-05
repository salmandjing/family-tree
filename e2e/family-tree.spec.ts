import { test, expect, type Page } from '@playwright/test';

// Real-browser E2E of the family tree UI (backup disabled — local only).
// Each test gets a fresh IndexedDB so runs are independent.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('family-tree');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
});

async function addFirstPerson(page: Page) {
  await page.getByRole('button', { name: /add the first person/i }).click();
  return page.getByRole('dialog');
}

// Reliable navigation via the always-on search box (avoids clicking transitioning
// family-chart cards).
async function focusPerson(page: Page, name: string) {
  const search = page.getByPlaceholder(/search a name/i);
  await search.fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
  await search.fill('');
  return page.getByRole('dialog');
}

// Click an "add relative" button, WAIT for the fresh (unnamed) card to load, then
// name it. Waiting avoids typing into the previous card during the async switch.
async function addRelative(page: Page, button: RegExp, name: string) {
  await page.getByRole('dialog').getByRole('button', { name: button }).click();
  const card = page.getByRole('dialog');
  await expect(card.getByText(/unnamed person/i)).toBeVisible();
  await card.getByLabel(/given name/i).fill(name);
  await expect(card.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  return card;
}

test('first run: empty state then add a person', async ({ page }) => {
  await expect(page.getByText(/start your family tree/i)).toBeVisible();
  const card = await addFirstPerson(page);
  await expect(card).toBeVisible();
  await expect(card.getByText(/unnamed person/i)).toBeVisible();
});

test('typing a name is lossless and updates the card + tree', async ({ page }) => {
  const card = await addFirstPerson(page);
  const given = card.getByLabel(/given name/i);
  await given.fill(''); // ensure empty
  await given.pressSequentially('Amadou', { delay: 15 }); // simulate real typing
  await expect(card.getByLabel(/given name/i)).toHaveValue('Amadou');
  await expect(card.getByRole('heading', { name: /Amadou/ })).toBeVisible();
  // Tree renders the name (family-chart in a real browser).
  await expect(page.locator('.tree-canvas')).toBeVisible();
});

test('add spouse then child; tree renders all three', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/given name/i).fill('Dad');
  await expect(card.getByRole('heading', { name: /Dad/ })).toBeVisible();
  await addRelative(page, /\+ spouse/i, 'Mom');
  await addRelative(page, /\+ child/i, 'Kid');
  await page.getByRole('button', { name: /close/i }).click();
  await page.waitForTimeout(700); // family-chart enter transition
  // The tree rendered three person cards (family-chart fragments text across
  // main+mini nodes, so assert on card count, and verify names via search).
  await expect(page.locator('.tree-canvas .card-inner')).toHaveCount(3);
  for (const name of ['Dad', 'Mom', 'Kid']) {
    await page.getByPlaceholder(/search a name/i).fill(name);
    await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible();
    await page.getByPlaceholder(/search a name/i).fill('');
  }
});

test('polygamy: adding a child with two spouses asks which partner', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/given name/i).fill('Chief');
  await expect(card.getByRole('heading', { name: /Chief/ })).toBeVisible();
  await addRelative(page, /\+ spouse/i, 'WifeOne');
  await focusPerson(page, 'Chief');
  await addRelative(page, /\+ spouse/i, 'WifeTwo');
  await focusPerson(page, 'Chief');
  // Add a child to the chief → must prompt for which partner (polygamy)
  await page.getByRole('dialog').getByRole('button', { name: /\+ child/i }).click();
  const picker = page.locator('.child-picker');
  await expect(picker.getByText(/which partner/i)).toBeVisible();
  await expect(picker.getByRole('button', { name: /^WifeOne$/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /^WifeTwo$/ })).toBeVisible();
});

test('XSS: a malicious name does NOT execute in the tree', async ({ page }) => {
  const alerts: string[] = [];
  page.on('dialog', (d) => {
    alerts.push(d.message());
    d.dismiss();
  });
  const card = await addFirstPerson(page);
  const payload = '<img src=x onerror="window.__xss_fired=true;alert(1)">';
  await card.getByLabel(/given name/i).fill(payload);
  await page.waitForTimeout(500); // let the tree re-render
  const fired = await page.evaluate(() => (window as unknown as { __xss_fired?: boolean }).__xss_fired);
  expect(fired).toBeFalsy();
  expect(alerts).toHaveLength(0);
  // The literal text should be present (escaped), not an <img> element.
  const injectedImgs = await page.locator('.tree-canvas img[src="x"]').count();
  expect(injectedImgs).toBe(0);
});

test('undo and redo an edit', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/given name/i).pressSequentially('First', { delay: 10 });
  await expect(card.getByRole('heading', { name: /First/ })).toBeVisible();
  await page.getByRole('button', { name: /↶ undo/i }).click();
  // After undo the name reverts (heading no longer "First").
  await expect(page.getByRole('dialog').getByRole('heading', { name: /First/ })).toHaveCount(0);
  await page.getByRole('button', { name: /↷ redo/i }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /First/ })).toBeVisible();
});

test('delete to bin then restore', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/given name/i).pressSequentially('Temp', { delay: 10 });
  await card.getByRole('button', { name: /move to recently deleted/i }).click();
  // Tree should now be empty (empty state returns).
  await expect(page.getByText(/start your family tree/i)).toBeVisible();
  // Open the bin and restore.
  await page.getByRole('button', { name: /recently deleted/i }).click();
  const bin = page.getByRole('dialog', { name: /recently deleted/i });
  await expect(bin.getByText(/Temp/)).toBeVisible();
  await bin.getByRole('button', { name: /^restore$/i }).click();
  await bin.getByRole('button', { name: /close/i }).click();
  await expect(page.locator('.tree-canvas').getByText('Temp', { exact: false }).first()).toBeVisible();
});

test('"Whole tree" button closes the card and returns to the overview', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/given name/i).fill('Root');
  await addRelative(page, /\+ child/i, 'Branch');
  // A person card is open; the whole-tree button should be present and close it.
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /whole tree/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // card closed
  await expect(page.locator('.tree-canvas .card-inner')).toHaveCount(2); // tree still there
});

test('data persists across reload (IndexedDB)', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/given name/i).pressSequentially('Persist', { delay: 10 });
  await expect(card.getByRole('heading', { name: /Persist/ })).toBeVisible();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.tree-canvas').getByText('Persist', { exact: false }).first()).toBeVisible();
});
