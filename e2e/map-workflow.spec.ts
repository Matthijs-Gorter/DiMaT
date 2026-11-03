import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('map generator configures up to eight total participants and starts the exact generated map', async ({ page }) => {
  await page.goto('/maps/new');
  const settings = page.locator('.map-editor-settings');
  const quality = page.locator('.map-editor-quality-details');
  await expect(settings).toBeVisible();
  await expect(settings.locator('summary')).toHaveCount(0);
  await expect(quality).not.toHaveAttribute('open', '');
  const qualityHeader = quality.locator('summary');
  await qualityHeader.click();
  await expect(quality).toHaveAttribute('open', '');
  await qualityHeader.click();
  await expect(quality).not.toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Start spel' })).toBeHidden();
  await page.getByLabel('Menselijke spelers').selectOption('5');
  await expect(page.getByLabel('AI-bots').locator('option[value="4"]')).toHaveAttribute('disabled', '');
  await page.getByLabel('AI-bots').selectOption('3');
  await expect(page.getByLabel('Totaal spelers')).toHaveText('8 / 8 spelers');
  await page.getByLabel('Menselijke spelers').selectOption('1');
  await page.getByLabel('AI-bots').selectOption('1');
  await expect(page.getByLabel('Totaal spelers')).toHaveText('2 / 8 spelers');
  await page.getByRole('button', { name: 'Genereer kaart' }).click();
  await qualityHeader.click();
  await expect(page.locator('.map-validation')).toContainText('19 landtegels · 0 harde fouten');
  await expect(page.getByRole('button', { name: 'Start spel' })).toBeEnabled();

  await page.getByRole('tab', { name: 'Instellingen' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JSON' }).click()
  ]);
  const exportedMap = JSON.parse(await readFile((await download.path())!, 'utf8'));
  await page.getByRole('button', { name: 'Start spel' }).click();
  await expect(page).toHaveURL(/\/play\/[a-f0-9]+/);
  await expect(page.getByRole('img', { name: 'Game board' })).toBeVisible();
  const roomId = new URL(page.url()).pathname.split('/').at(-1)!;
  const debugResponse = await page.request.get(new URL(`/api/debug/rooms/${roomId}`, page.url()).href);
  const debug = await debugResponse.json();
  expect(debug.lifecycle).toBe('started');
  expect(debug.settings.playerCount).toBe(2);
  expect(debug.settings.map).toEqual(exportedMap);
  expect(debug.players).toEqual([
    expect.objectContaining({ playerId: 'p0', bot: false }),
    expect.objectContaining({ playerId: 'p1', bot: true })
  ]);
  expect(debug.activePlayerId).toBe('p0');
});

test('server accepts valid human and bot combinations up to eight and rejects invalid totals', async ({ request }) => {
  for (const [humanCount, botCount] of [[1,1],[1,7],[2,0],[4,4],[8,0]]) {
    const response = await request.post('/api/rooms', { data: { displayName: 'Capacity', humanCount, botCount } });
    expect(response.status()).toBe(200);
    const { roomId } = await response.json();
    const roomResponse = await request.get(`/api/rooms/${roomId}`);
    const room = await roomResponse.json();
    expect(room.seats).toHaveLength(humanCount + botCount);
    expect(room.seats.filter((seat: { bot: boolean }) => seat.bot)).toHaveLength(botCount);
  }
  for (const [humanCount, botCount] of [[1,0],[8,1]]) {
    const response = await request.post('/api/rooms', { data: { displayName: 'Invalid', humanCount, botCount } });
    expect(response.status()).toBe(400);
  }
});

test('generates, edits, shares, previews and uses a custom river map', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/maps/new');
  await page.getByRole('button', { name: 'Lege kaart' }).click();
  await page.locator('.map-add-target').first().click();
  await expect(page.locator('.map-tile-hit')).toHaveCount(1);
  await page.getByRole('button', { name: 'Verwijder tegel' }).click();
  await expect(page.locator('.map-tile-hit')).toHaveCount(0);
  await page.getByLabel('Gereedschap').selectOption('add');
  await page.locator('.map-add-target').first().click();
  await page.getByLabel('Gereedschap').selectOption('harbor');
  await page.locator('.harbor-target').first().click();
  await expect(page.locator('.harbor-existing')).toHaveCount(1);
  await page.getByLabel('Stijl').selectOption('river');
  await page.getByLabel('Landtegels').fill('24');
  await page.getByLabel('Rivieren').selectOption('2');
  await page.getByRole('button', { name: 'Genereer kaart' }).click();
  await page.locator('.map-editor-quality-details summary').click();
  await expect(page.locator('.map-validation')).toContainText('24 landtegels · 0 harde fouten');
  await expect(page.locator('.map-tile-hit')).toHaveCount(24);
  await expect(page.locator('.map-editor-board .terrain-art')).toHaveCount(24);
  await expect(page.locator('.map-editor-board .number-token').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Instellingen' }).click();
  await page.getByLabel('Nummertokens tonen').uncheck();
  await expect(page.locator('.map-editor-board .number-token')).toHaveCount(0);
  await page.getByLabel('Terreinlabels tonen').check();
  await expect(page.locator('.map-editor-board .terrain-name-label')).toHaveCount(24);
  await page.getByLabel('Nummertokens tonen').check();

  await page.getByRole('tab', { name: 'Bewerken' }).click();
  await page.getByLabel('Gereedschap').selectOption('terrain');
  await page.getByLabel('Terreintype').selectOption('wool');
  await page.locator('.map-tile-hit').first().click();
  await expect(page.locator('.map-validation')).toContainText('0 harde fouten');
  await page.getByLabel('Gereedschap').selectOption('harbor');
  await page.locator('.harbor-existing').first().click();
  await page.getByLabel('Haventype').selectOption('ore');
  await page.getByRole('button', { name: 'Haventype toepassen' }).click();
  await page.getByLabel('Gereedschap').selectOption('river');
  const previousRiverCount = await page.locator('.river-existing').count();
  await expect(page.locator('.river-candidate').first()).toBeVisible();
  await page.locator('.river-candidate').first().click();
  await expect(page.locator('.river-existing')).toHaveCount(previousRiverCount + 1);
  await page.getByRole('tab', { name: 'Instellingen' }).click();
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JSON' }).click()
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  await page.getByLabel('JSON-bestand').setInputFiles(jsonPath!);
  await expect(page.locator('.map-editor-feedback')).toContainText('geïmporteerd');
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
  await expect(page.locator('.map-preview-board .terrain-art')).toHaveCount(24);
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

test('saves and reloads a generated standard map', async ({ page }) => {
  await page.goto('/maps/new');
  await page.getByLabel('Stijl').selectOption('standard');
  await page.getByLabel('Menselijke spelers').selectOption('2');
  await page.getByLabel('AI-bots').selectOption('2');
  await page.getByRole('button', { name: 'Genereer kaart' }).click();
  await page.locator('.map-editor-quality-details summary').click();
  await expect(page.locator('.map-validation')).toContainText('19 landtegels · 0 harde fouten');
  await page.getByRole('button', { name: 'Opslaan en deelcode maken' }).click();
  const shareCode = page.locator('.map-share-code').filter({ hasText: 'Deelcode:' });
  await expect(shareCode).toBeVisible();
  const code = (await shareCode.innerText()).replace('Deelcode:', '').trim();
  await page.getByRole('tab', { name: 'Instellingen' }).click();
  await page.getByLabel('Kaartcode').fill(code);
  await page.getByRole('button', { name: 'Kaart laden' }).click();
  await expect(page.locator('.map-editor-feedback')).toContainText('Kaart geladen.');
  await expect(page.locator('.map-tile-hit')).toHaveCount(19);
});
