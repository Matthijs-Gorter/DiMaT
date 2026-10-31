import { expect, test, type Page } from '@playwright/test';

async function startSoloGame(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('Je naam').fill('Tiles');
  await page.getByLabel('Aantal menselijke spelers').selectOption('1');
  await page.getByRole('button', { name: 'Nieuwe kamer' }).click();
  await page.getByRole('button', { name: 'Start spel' }).click();
  await expect(page.locator('.terrain-art')).toHaveCount(19);
}

const shotDir = process.env.TILE_SHOTS;

test.skip('terrain art keeps its source aspect ratio at every zoom level', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await startSoloGame(page);
  const steps: Array<'Inzoomen' | 'Uitzoomen'> = ['Inzoomen', 'Inzoomen', 'Inzoomen', 'Uitzoomen', 'Uitzoomen', 'Uitzoomen', 'Uitzoomen'];
  for (const [index, step] of [null, ...steps].entries()) {
    if (step) await page.getByRole('button', { name: step }).click();
    const zoom = (await page.locator('.board-controls span').textContent()) ?? '';
    const measured = await page.locator('.terrain-art').evaluateAll(async images => Promise.all(images.map(async image => {
      const bitmap = await createImageBitmap(await (await fetch(image.getAttribute('href')!)).blob());
      const box = image.getBoundingClientRect();
      return { kind: image.getAttribute('data-kind')!, ratio: box.width / box.height, natural: bitmap.width / bitmap.height, width: box.width };
    })));
    for (const tile of measured) expect(tile.ratio, `aspect at ${zoom} (${tile.kind})`).toBeCloseTo(tile.natural, 2);
    const byKind = new Map<string, number[]>();
    for (const tile of measured) byKind.set(tile.kind, [...(byKind.get(tile.kind) ?? []), tile.width]);
    for (const [kind, widths] of byKind) for (const width of widths) expect(width, `uniform ${kind} width at ${zoom}`).toBeCloseTo(widths[0]!, 3);
    if (shotDir) await page.locator('.gx-board').screenshot({ path: `${shotDir}/zoom-${String(index).padStart(2, '0')}-${zoom.replace('%', 'pct')}.png` });
  }
  await page.context().close();
});

test('terrain tiles are painted back to front, top rows first', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await startSoloGame(page);
  const order = await page.evaluate(() => {
    const centre = (id: string) => { const box = document.querySelector<SVGPolygonElement>(`.hex[data-tile="${id}"]`)!.getBBox(); return [box.x + box.width / 2, box.y + box.height / 2] as const; };
    return [...document.querySelectorAll<SVGGElement>('.terrain-layer .terrain-tile')].map(group => centre(group.dataset.tile!));
  });
  expect(order).toHaveLength(19);
  for (let index = 1; index < order.length; index++) {
    const [previousX, previousY] = order[index - 1]!, [x, y] = order[index]!;
    expect(y > previousY + 1e-6 || (Math.abs(y - previousY) < 1e-6 && x >= previousX)).toBe(true);
  }
  await page.context().close();
});

test('terrain art is placed consistently on the hex grid without clipping the board', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await startSoloGame(page);
  const layout = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('.board')!, view = svg.viewBox.baseVal;
    return [...document.querySelectorAll<SVGImageElement>('.terrain-art')].map(image => {
      const polygon = document.querySelector<SVGPolygonElement>(`.hex[data-tile="${image.dataset.tile}"]`)!.getBBox();
      const x = image.x.baseVal.value, y = image.y.baseVal.value, width = image.width.baseVal.value, height = image.height.baseVal.value;
      return { kind: image.dataset.kind!, dx: x + width / 2 - (polygon.x + polygon.width / 2), dy: y + height / 2 - (polygon.y + polygon.height / 2), insideView: x >= view.x && y >= view.y && x + width <= view.x + view.width && y + height <= view.y + view.height };
    });
  });
  const byKind = new Map<string, typeof layout>();
  for (const item of layout) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  for (const [kind, items] of byKind) for (const item of items) { expect(item.dx, `${kind} dx`).toBeCloseTo(items[0]!.dx, 4); expect(item.dy, `${kind} dy`).toBeCloseTo(items[0]!.dy, 4); }
  for (const item of layout) expect(item.insideView, `${item.kind} stays inside the board view`).toBe(true);
  await page.context().close();
});
