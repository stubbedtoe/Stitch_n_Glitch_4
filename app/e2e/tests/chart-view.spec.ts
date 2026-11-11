// Obligations exercised (specs/m2-chart-core.allium, slice m2-chart-rendering,
// surface ChartViewControls + SymbolLibrary browser level):
//   - guarantee StyleConsistentMapping (AC-F009-04): style switcher cycles
//     all three styles with an identical color→symbol mapping, persisted
//     per document; default style is symbols on colored background
//   - guarantee ZoomBoundsAndGridAutoHide (AC-F009-02): zoom clamps to
//     config.min_zoom_pct..max_zoom_pct (10..4000), grid lines auto-hide
//     below config.grid_auto_hide_below_zoom_pct (25)
//   - guarantee PanClampedToCanvas (AC-F009-02): panning never carries the
//     viewport outside the canvas bounds
//   - guarantee StyleConsistentMapping's symbol-key half (AC-F009-01): the
//     symbol key matches the chart — one unique glyph per used color,
//     identical to the persisted SymbolAssignment mapping
//   - guarantee SymbolLegibilityAtAllZoomLevels's NFR-U2 half + surface
//     SymbolLibrary exposure: at least config.colorblind_safe_sets_required
//     (2) colorblind-safe symbol sets selectable
//   - guarantee ThumbnailsRenderedLocally: thumbnails render on-device
//     (data: URIs, no network involved)
//   - rule DocumentViewInitialised's migration half: a pre-existing (seeded)
//     document gets its ChartView/SymbolAssignment on first open
// Domain-level variants (rules ChartStyleSelected/ChartZoomed/ChartPanned,
// invariants, derived fields) are covered by gleeunit
// (app/test/sng/chart_test.gleam).
//
// Seeded documents: written straight into IndexedDB (see helpers.ts); a
// seeded document's cells array is sparse (only non-empty cells).
import { expect, test, type Page } from '@playwright/test';
import {
  chartCanvas,
  chartRegion,
  chartState,
  openDocument,
  panButton,
  readSymbolAssignment,
  seedStore,
  showChart,
  storeWith,
  styleRadio,
  symbolKeyItems,
  twelveColorDoc,
  zoomInput,
  libraryEntry,
  createBlankDocument,
  drawStroke,
} from './helpers';

const STYLES: Array<{ name: string; token: string }> = [
  { name: 'Symbols on colored background', token: 'symbols_on_colored_background' },
  { name: 'Colored symbols only', token: 'colored_symbols_only' },
  { name: 'Black and white symbols only', token: 'black_and_white_symbols_only' },
];

async function seedAndOpen(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Create blank document' }),
  ).toBeVisible();
  await seedStore(page, storeWith(twelveColorDoc()));
  await page.reload();
  await openDocument(page, 'Twelve Color Sampler');
  await showChart(page);
}

test('Chart view opens with the default style, the primary symbol set, and colorblind-safe set choices', async ({
  page,
}) => {
  await seedAndOpen(page);

  // Default style: symbols on colored background (rule DocumentViewInitialised).
  const canvas = chartCanvas(page);
  await expect(canvas).toHaveAttribute(
    'data-style',
    'symbols_on_colored_background',
  );
  await expect(styleRadio(page, 'Symbols on colored background')).toBeChecked();

  // The full style switcher offers exactly the three spec styles.
  for (const { name } of STYLES) {
    await expect(styleRadio(page, name)).toBeVisible();
  }

  // NFR-U2: at least 2 selectable symbol sets flagged colorblind-safe
  // (config.colorblind_safe_sets_required); the canvas names the set the
  // chart renders with, which must be one of the selectable sets.
  const setRadios = chartRegion(page)
    .getByRole('radiogroup', { name: 'Symbol set' })
    .getByRole('radio');
  const safeCount = await setRadios.evaluateAll(
    (els) => els.filter((e) => e.getAttribute('data-colorblind-safe') === 'true').length,
  );
  expect(safeCount).toBeGreaterThanOrEqual(2);
  const renderedSet = await canvas.getAttribute('data-symbol-set');
  await expect(
    chartRegion(page)
      .getByRole('radiogroup', { name: 'Symbol set' })
      .getByRole('radio', { name: renderedSet ?? '' }),
  ).toBeAttached();

  // Initial view state: zoom 100, grid visible, center on the grid center
  // of the 24x24 document (width/2, height/2).
  const state = await chartState(page);
  expect(state).toMatchObject({
    style: 'symbols_on_colored_background',
    zoom_pct: '100',
    grid_visible: 'true',
    center_x: '12',
    center_y: '12',
    chart_width: '24',
    chart_height: '24',
  });
});

test('Style switcher cycles all three styles with an identical mapping, persisted per document (AC-F009-04)', async ({
  page,
}) => {
  await seedAndOpen(page);

  const keyGlyphNames = () =>
    symbolKeyItems(page).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-glyph-name')),
    );
  const baseline = await keyGlyphNames();

  // Cycle every style: the canvas tracks the selection and the symbol key
  // (the color→symbol mapping rendered) never changes.
  for (const { name, token } of STYLES.slice(1)) {
    await styleRadio(page, name).check();
    await expect(chartCanvas(page)).toHaveAttribute('data-style', token);
    await expect.poll(keyGlyphNames).toEqual(baseline);
  }
  // Back to the default, then out again to a non-default style.
  await styleRadio(page, 'Symbols on colored background').check();
  await expect.poll(keyGlyphNames).toEqual(baseline);
  await styleRadio(page, 'Black and white symbols only').check();
  await expect(chartCanvas(page)).toHaveAttribute(
    'data-style',
    'black_and_white_symbols_only',
  );

  // The selected style is the document's persisted export style: it
  // survives a full reload (ChartView persisted with the document).
  await page.reload();
  await openDocument(page, 'Twelve Color Sampler');
  await showChart(page);
  await expect(styleRadio(page, 'Black and white symbols only')).toBeChecked();
  await expect(chartCanvas(page)).toHaveAttribute(
    'data-style',
    'black_and_white_symbols_only',
  );
});

test('Zoom clamps to 10..4000 and grid lines auto-hide below 25 percent (AC-F009-02)', async ({
  page,
}) => {
  await seedAndOpen(page);
  const zoom = zoomInput(page);
  const canvas = chartCanvas(page);

  // Below the minimum: clamps to config.min_zoom_pct (10).
  await zoom.fill('5');
  await expect(zoom).toHaveValue('10');
  await expect(canvas).toHaveAttribute('data-zoom-pct', '10');
  await expect(canvas).toHaveAttribute('data-grid-visible', 'false');

  // Above the maximum: clamps to config.max_zoom_pct (4000).
  await zoom.fill('5000');
  await expect(zoom).toHaveValue('4000');
  await expect(canvas).toHaveAttribute('data-zoom-pct', '4000');

  // Grid auto-hide threshold: hidden at 24, visible at 25
  // (config.grid_auto_hide_below_zoom_pct, boundary inclusive).
  await zoom.fill('24');
  await expect(canvas).toHaveAttribute('data-zoom-pct', '24');
  await expect(canvas).toHaveAttribute('data-grid-visible', 'false');
  await zoom.fill('25');
  await expect(canvas).toHaveAttribute('data-zoom-pct', '25');
  await expect(canvas).toHaveAttribute('data-grid-visible', 'true');
});

test('Panning is clamped to the canvas bounds (AC-F009-02)', async ({ page }) => {
  await seedAndOpen(page);
  const canvas = chartCanvas(page);

  // A single pan moves the center off the grid center (12, 12)...
  await panButton(page, 'right').click();
  await expect(canvas).toHaveAttribute('data-center-x', '13');

  // ...but panning can never leave the document bounds: on the 24x24 chart
  // the center clamps to [0, 23] on both axes.
  for (let i = 0; i < 30; i++) await panButton(page, 'right').click();
  await expect(canvas).toHaveAttribute('data-center-x', '23');
  for (let i = 0; i < 30; i++) await panButton(page, 'down').click();
  await expect(canvas).toHaveAttribute('data-center-y', '23');
  for (let i = 0; i < 60; i++) await panButton(page, 'left').click();
  await expect(canvas).toHaveAttribute('data-center-x', '0');
  for (let i = 0; i < 60; i++) await panButton(page, 'up').click();
  await expect(canvas).toHaveAttribute('data-center-y', '0');
});

test('Symbol key matches the chart — one unique glyph per used color, equal to the persisted mapping (AC-F009-01)', async ({
  page,
}) => {
  await seedAndOpen(page);

  // The key lists one item per used color, ordered by color index, with a
  // unique glyph per color.
  const items = symbolKeyItems(page);
  await expect(items).toHaveCount(12);
  const key = await items.evaluateAll((els) =>
    els.map((e) => ({
      color_index: Number(e.getAttribute('data-color-index')),
      glyph_name: e.getAttribute('data-glyph-name'),
    })),
  );
  expect(key.map((k) => k.color_index)).toEqual(
    Array.from({ length: 12 }, (_, i) => i),
  );
  expect(new Set(key.map((k) => k.glyph_name)).size).toBe(12);

  // The key matches the chart: identical to the persisted SymbolAssignment
  // mapping for this document (created on first open, per rule
  // DocumentViewInitialised's migration guidance).
  await expect
    .poll(() => readSymbolAssignment(page, 'doc-1'), {
      message: 'symbol-assignment marker persisted on first open',
    })
    .not.toBeNull();
  const mapping = await readSymbolAssignment(page, 'doc-1');
  expect(mapping).not.toBeNull();
  expect(key.map((k) => ({ color_index: k.color_index, glyph_name: k.glyph_name }))).toEqual(
    mapping,
  );

  // A style switch re-renders the same mapping — the key is unchanged
  // (AC-F009-04's observable half).
  await styleRadio(page, 'Colored symbols only').check();
  await expect.poll(() =>
    symbolKeyItems(page).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-glyph-name')),
    ),
  ).toEqual(key.map((k) => k.glyph_name));
});

test('Thumbnails are rendered locally — data URIs, no network involved', async ({
  page,
}) => {
  const requests: URL[] = [];
  page.on('request', (req) => requests.push(new URL(req.url())));

  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  await drawStroke(page, [
    [1, 1],
    [2, 1],
    [3, 1],
  ]);

  // Back in the library, the entry's thumbnail is a locally generated
  // data: URI (offscreen render on the device — ThumbnailsRenderedLocally).
  await page.getByRole('button', { name: 'Back to library' }).click();
  const thumbnail = libraryEntry(page, 'Untitled').getByRole('img').first();
  await expect(thumbnail).toBeVisible();
  const src = await thumbnail.getAttribute('src');
  expect(src).not.toBeNull();
  expect(src!.startsWith('data:')).toBe(true);

  // No request involved at any point: everything fetched is a same-origin
  // static asset.
  const origin = new URL(page.url()).origin;
  const offOrigin = requests.filter((url) => url.origin !== origin);
  expect(offOrigin).toEqual([]);
});
