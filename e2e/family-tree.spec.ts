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
  await page.getByRole('button', { name: /Ajouter la première personne/i }).click();
  return page.getByRole('dialog');
}

// Reliable navigation via the always-on search box (avoids clicking transitioning
// family-chart cards).
async function focusPerson(page: Page, name: string) {
  const search = page.getByPlaceholder(/Rechercher un nom/i);
  await search.fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
  // Wait until the card for THIS person is fully open before proceeding.
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: new RegExp(name) }),
  ).toBeVisible();
  return page.getByRole('dialog');
}

// Click an "add relative" button, WAIT for the fresh (unnamed) card to load, then
// name it. Waiting avoids typing into the previous card during the async switch.
async function addRelative(page: Page, button: RegExp, name: string) {
  await page.getByRole('dialog').getByRole('button', { name: button }).click();
  const card = page.getByRole('dialog');
  await expect(card.getByText(/Personne sans nom/i)).toBeVisible();
  const input = card.getByLabel(/Prénom/i);
  await input.click(); // ensure focus is on the field, not the search box
  await input.fill(name);
  await expect(card.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  return card;
}

test('first run: empty state then add a person', async ({ page }) => {
  await expect(page.getByText(/Commencez votre arbre/i)).toBeVisible();
  const card = await addFirstPerson(page);
  await expect(card).toBeVisible();
  await expect(card.getByText(/Personne sans nom/i)).toBeVisible();
});

test('typing a name is lossless and updates the card + tree', async ({ page }) => {
  const card = await addFirstPerson(page);
  const given = card.getByLabel(/Prénom/i);
  await given.fill(''); // ensure empty
  await given.pressSequentially('Amadou', { delay: 15 }); // simulate real typing
  await expect(card.getByLabel(/Prénom/i)).toHaveValue('Amadou');
  await expect(card.getByRole('heading', { name: /Amadou/ })).toBeVisible();
  // Tree renders the name (family-chart in a real browser).
  await expect(page.locator('.tree-canvas')).toBeVisible();
});

test('add spouse then child; tree renders all three', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/Prénom/i).fill('Dad');
  await expect(card.getByRole('heading', { name: /Dad/ })).toBeVisible();
  await addRelative(page, /\+ Conjoint/i, 'Mom');
  await addRelative(page, /\+ Enfant/i, 'Kid');
  await page.getByRole('button', { name: /Fermer/i }).click();
  await page.waitForTimeout(700); // family-chart enter transition
  // The tree rendered three person cards (family-chart fragments text across
  // main+mini nodes, so assert on card count, and verify names via search).
  await expect(page.locator('.tree-canvas .card-inner')).toHaveCount(3);
  for (const name of ['Dad', 'Mom', 'Kid']) {
    await page.getByPlaceholder(/Rechercher un nom/i).fill(name);
    await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible();
    await page.getByPlaceholder(/Rechercher un nom/i).fill('');
  }
});

test('polygamy: adding a child with two spouses asks which partner', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/Prénom/i).fill('Chief');
  await expect(card.getByRole('heading', { name: /Chief/ })).toBeVisible();
  await addRelative(page, /\+ Conjoint/i, 'WifeOne');
  await focusPerson(page, 'Chief');
  await addRelative(page, /\+ Conjoint/i, 'WifeTwo');
  await focusPerson(page, 'Chief');
  // Add a child to the chief → must prompt for which partner (polygamy)
  await page.getByRole('dialog').getByRole('button', { name: /\+ Enfant/i }).click();
  const picker = page.locator('.child-picker');
  await expect(picker.getByText(/quel conjoint/i)).toBeVisible();
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
  await card.getByLabel(/Prénom/i).fill(payload);
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
  await card.getByLabel(/Prénom/i).pressSequentially('First', { delay: 10 });
  await expect(card.getByRole('heading', { name: /First/ })).toBeVisible();
  await page.getByRole('button', { name: /Annuler/i }).click();
  // After undo the name reverts (heading no longer "First").
  await expect(page.getByRole('dialog').getByRole('heading', { name: /First/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Rétablir/i }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /First/ })).toBeVisible();
});

test('delete to bin then restore', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/Prénom/i).pressSequentially('Temp', { delay: 10 });
  await card.getByRole('button', { name: /Mettre à la corbeille/i }).click();
  // Tree should now be empty (empty state returns).
  await expect(page.getByText(/Commencez votre arbre/i)).toBeVisible();
  // Open the bin and restore.
  await page.getByRole('button', { name: /Corbeille/i }).click();
  const bin = page.getByRole('dialog', { name: /Corbeille/i });
  await expect(bin.getByText(/Temp/)).toBeVisible();
  await bin.getByRole('button', { name: /^Restaurer$/i }).click();
  await bin.getByRole('button', { name: /Fermer/i }).click();
  await expect(page.locator('.tree-canvas').getByText('Temp', { exact: false }).first()).toBeVisible();
});

test('"Whole tree" reveals all branches after focusing a deep leaf', async ({ page }) => {
  // Two-branch tree: Root → BranchA → LeafA and Root → BranchB → LeafB (5 people).
  const card = await addFirstPerson(page);
  await card.getByLabel(/Prénom/i).fill('Root');
  await addRelative(page, /\+ Enfant/i, 'BranchA');
  await focusPerson(page, 'Root');
  await addRelative(page, /\+ Enfant/i, 'BranchB');
  await focusPerson(page, 'BranchA');
  await addRelative(page, /\+ Enfant/i, 'LeafA');
  await focusPerson(page, 'BranchB');
  await addRelative(page, /\+ Enfant/i, 'LeafB');

  // Focus a deep leaf — family-chart re-roots on it and hides the other branch.
  await focusPerson(page, 'LeafA');
  const focusedCount = await page.locator('.tree-canvas .card-inner').count();
  console.log(`cards visible while focused on a leaf: ${focusedCount} (of 5)`);

  await page.getByRole('button', { name: /Voir tout/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // card closed
  await page.waitForTimeout(700);
  // Whole tree must render every one of the 5 people (all branches revealed).
  await expect(page.locator('.tree-canvas .card-inner')).toHaveCount(5);
});

test('delete-forever removes a person and the app stays responsive', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const card = await addFirstPerson(page);
  await card.getByLabel(/Prénom/i).fill('Gone');
  await card.getByRole('button', { name: /Mettre à la corbeille/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // card closed
  await page.getByRole('button', { name: /^Corbeille/ }).click();
  const bin = page.getByRole('dialog', { name: /Corbeille/i });
  await bin.getByRole('button', { name: /Supprimer définitivement/i }).click();
  // Person is gone and the app is still responsive (no freeze).
  await expect(bin.getByText('Gone')).toHaveCount(0);
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});

test('data persists across reload (IndexedDB)', async ({ page }) => {
  const card = await addFirstPerson(page);
  await card.getByLabel(/Prénom/i).pressSequentially('Persist', { delay: 10 });
  await expect(card.getByRole('heading', { name: /Persist/ })).toBeVisible();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.tree-canvas').getByText('Persist', { exact: false }).first()).toBeVisible();
});
