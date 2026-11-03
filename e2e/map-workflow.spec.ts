import { expect, test } from '@playwright/test';

test('generates, edits, shares, previews and uses a custom river map', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/maps/new');
  await page.getByLabel('Stijl').selectOption('river');
  await page.getByLabel('Landtegels').fill('24');
  await page.getByLabel('Rivieren').selectOption('2');
  await page.getByRole('button', { name: 'Genereer map' }).click();
  await expect(page.locator('.map-validation')).toContainText('24 landtegels · 0 fouten');
  await expect(page.locator('.map-editor-board polygon')).toHaveCount(24);

  await page.getByLabel('Penseel').selectOption('wool');
  await page.locator('.map-editor-board polygon').first().click();
  await expect(page.locator('.map-validation')).toContainText('0 fouten');
  const save = page.getByRole('button', { name: 'Opslaan en deelcode maken' });
  await expect(save).toBeEnabled();
  await save.click();
  const codeText = page.locator('.map-share-code').filter({ hasText: 'Deelcode:' });
  await expect(codeText).toBeVisible();
  const shareCode = (await codeText.innerText()).replace('Deelcode:', '').trim();
  expect(shareCode).toMatch(/^[A-Z0-9]{6}$/);

  await page.goto('/');
  await page.getByPlaceholder('Je naam').fill('Mapmaker');
  await page.getByLabel('Mapcode').fill(shareCode);
  await page.getByRole('button', { name: 'Map bekijken' }).click();
  await expect(page.locator('.map-preview-board polygon')).toHaveCount(24);
  await expect(page.locator('.map-picker-status')).toContainText('24 landtegels');
  await page.getByLabel('Aantal menselijke spelers').selectOption('1');
  await page.getByRole('button', { name: 'Nieuwe kamer' }).click();
  await expect(page).toHaveURL(/\/play\/[a-f0-9]+/);
  await page.getByRole('button', { name: 'Start spel' }).click();
  await expect(page.locator('.terrain-art')).toHaveCount(24);
  await expect(page.getByRole('img', { name: 'Game board' })).toBeVisible();
  await expect(page.locator('.river-edge')).not.toHaveCount(0);
  await page.context().close();
});
