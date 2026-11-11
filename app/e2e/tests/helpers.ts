// Shared helpers for the sng e2e contract suite.
// Every helper encodes part of the DOM contract in e2e/CONTRACT.md.
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 1x1 transparent PNG. stub_convert accepts arbitrary bytes. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function grid(page: Page) {
  return page.getByRole('grid', { name: 'Stitch grid' });
}

/** An empty cell: accessible name `Cell <x>, <y>`. */
export function cell(page: Page, x: number, y: number) {
  return grid(page).getByRole('gridcell', { name: `Cell ${x}, ${y}` });
}

/** A stitched cell: accessible name `Stitched cell <x>, <y>`. */
export function stitchedCell(page: Page, x: number, y: number) {
  return grid(page).getByRole('gridcell', { name: `Stitched cell ${x}, ${y}` });
}

/**
 * One committed pencil gesture (rule StitchesDrawn): mouse down on the first
 * cell, drag through the rest, mouse up. Matches either empty or stitched
 * cell names so it works before and after drawing.
 */
export async function drawStroke(page: Page, cells: Array<[number, number]>) {
  // The Pencil is a toggle: activate it only when it is not already active.
  const pencil = page.getByRole('button', { name: 'Pencil' });
  if ((await pencil.getAttribute('aria-pressed')) !== 'true') {
    await pencil.click();
  }
  await dragOverCells(page, cells);
}

/** The raw mouse gesture only, without touching the Pencil toggle. */
export async function dragOverCells(page: Page, cells: Array<[number, number]>) {
  const centers: Array<{ x: number; y: number }> = [];
  for (const [x, y] of cells) {
    const target = grid(page).getByRole('gridcell', {
      name: new RegExp(`cell ${x}, ${y}$`, 'i'),
    });
    const box = await target.boundingBox();
    if (!box) throw new Error(`cell ${x},${y} has no bounding box`);
    centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const [first, ...rest] = centers;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const c of rest) await page.mouse.move(c.x, c.y, { steps: 5 });
  await page.mouse.up();
}

/**
 * Create a blank document through the library create flow (surface-provides
 * CreateBlankDocument). Defaults to a small fixed 8x8 grid so tests never
 * depend on the placeholder default canvas size.
 */
export async function createBlankDocument(
  page: Page,
  opts: { width?: number; height?: number } = {},
) {
  const width = opts.width ?? 8;
  const height = opts.height ?? 8;
  await page.getByRole('button', { name: 'Create blank document' }).click();
  const widthBox = page.getByRole('spinbutton', { name: 'Width' });
  const heightBox = page.getByRole('spinbutton', { name: 'Height' });
  await widthBox.fill(String(width));
  await heightBox.fill(String(height));
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(grid(page)).toBeVisible();
}

/** The library listitem for a document, identified by its exact name heading. */
export function libraryEntry(page: Page, name: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** Open a document from the library into the editor. */
export async function openDocument(page: Page, name: string) {
  await libraryEntry(page, name)
    .getByRole('button', { name: `Open ${name}` })
    .click();
  await expect(grid(page)).toBeVisible();
}

/** Rename a document via its library entry (surface-provides RenameDocument). */
export async function renameDocument(
  page: Page,
  oldName: string,
  newName: string,
) {
  await libraryEntry(page, oldName)
    .getByRole('button', { name: `Rename ${oldName}` })
    .click();
  const box = page.getByRole('textbox', { name: 'Document name' });
  await expect(box).toHaveValue(oldName);
  await box.fill(newName);
  await box.press('Enter');
  await expect(libraryEntry(page, newName)).toBeVisible();
}

export function offlineIndicator(page: Page) {
  return page.getByRole('status', { name: /offline/i });
}

/**
 * A real on-disk browser profile for restart-durability tests
 * (LibraryPersists, CrashRecovery, UndoPersists).
 *
 * Playwright's non-persistent `browser.newContext()` partitions are
 * incognito-style: nothing (IndexedDB, localStorage, CacheStorage, OPFS)
 * survives `context.close()`, so two sequential non-persistent contexts can
 * never prove on-disk durability. `chromium.launchPersistentContext` with a
 * shared `userDataDir` launches a genuine Chromium on a real profile;
 * `close()` terminates the browser and flushes storage to disk, and a
 * relaunch against the same `userDataDir` is a true browser restart.
 *
 * Usage: one profile per test; `launch()` per browser session (typically
 * twice); always `dispose()` (e.g. in `finally`) to remove the temp dir.
 * `baseURL` mirrors playwright.config.ts so `page.goto('/')` keeps working.
 */
export function persistentProfile() {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sng-e2e-profile-'),
  );
  const contexts = new Set<BrowserContext>();
  return {
    userDataDir,
    async launch() {
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        baseURL: 'http://localhost:4719',
      });
      contexts.add(context);
      context.on('close', () => contexts.delete(context));
      return context;
    },
    // Close every still-open session first: a failed test may have left one
    // alive, and a live Chromium would recreate profile dirs after the
    // removal below.
    async dispose() {
      for (const context of contexts) {
        await context.close().catch(() => {});
      }
      contexts.clear();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** The parsed shape of the record the app persists (see sng/persist.gleam). */
export type PersistedStore = {
  documents: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    cells: Array<{ x: number; y: number; color: number | null }>;
  }>;
  commands: Array<{ verb: string }>;
  sources?: Array<{
    id: string;
    document_id: string;
    content_hash: string;
  }>;
};

/**
 * Read the store record the app persists to IndexedDB (DB "sng", object
 * store "store", key "store" — the exact seam sng_persist_ffi.mjs writes).
 */
export async function readPersistedStore(
  page: Page,
): Promise<PersistedStore | null> {
  return page.evaluate(async () => {
    const request = indexedDB.open('sng', 1);
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onupgradeneeded = () => request.transaction!.abort();
    });
    if (!db) return null;
    return new Promise((resolve) => {
      const get = db
        .transaction('store', 'readonly')
        .objectStore('store')
        .get('store');
      get.onsuccess = () => {
        const raw = get.result as string | undefined;
        if (typeof raw !== 'string') return resolve(null);
        try {
          resolve(JSON.parse(raw) as PersistedStore);
        } catch {
          resolve(null);
        }
      };
      get.onerror = () => resolve(null);
    });
  });
}

/**
 * Pin the NFR-A3 "committed" precondition: wait until the on-disk store
 * record satisfies `predicate`. The app persists asynchronously, so a UI
 * acknowledgement alone does not prove durability — a restart test must not
 * simulate a force-close while the last gesture's write is still in flight
 * (that gesture was never committed, so nothing is promised about it).
 */
export async function waitForDurableState(
  page: Page,
  predicate: (store: PersistedStore) => boolean,
) {
  await expect
    .poll(async () => {
      const stored = await readPersistedStore(page);
      return stored != null && predicate(stored);
    })
    .toBe(true);
}

// ---------------------------------------------------------------------------
// M2 chart-view contract helpers (specs/m2-chart-core.allium, surface
// ChartViewControls — see e2e/CONTRACT.md "Chart view").
// ---------------------------------------------------------------------------

/** The chart view region (opened from the editor via `Show chart`). */
export function chartRegion(page: Page) {
  return page.getByRole('region', { name: 'Chart view' });
}

/** The WebGL2 chart canvas. All view state is observable via data-* attrs. */
export function chartCanvas(page: Page) {
  return chartRegion(page).getByRole('img', { name: 'Symbol chart' });
}

/** Open the chart view from the editor (the stitch grid unmounts meanwhile). */
export async function showChart(page: Page) {
  await page.getByRole('button', { name: 'Show chart' }).click();
  await expect(chartRegion(page)).toBeVisible();
}

export function zoomInput(page: Page) {
  return chartRegion(page).getByRole('spinbutton', { name: 'Zoom %' });
}

export function styleRadio(page: Page, name: string) {
  return chartRegion(page).getByRole('radio', { name });
}

export function panButton(page: Page, direction: 'up' | 'down' | 'left' | 'right') {
  return chartRegion(page).getByRole('button', { name: `Pan ${direction}` });
}

/** One listitem per color used in the committed chart (see CONTRACT.md). */
export function symbolKeyItems(page: Page) {
  return chartRegion(page)
    .getByRole('list', { name: 'Symbol key' })
    .getByRole('listitem');
}

export type ChartState = {
  style: string | null;
  symbol_set: string | null;
  zoom_pct: string | null;
  grid_visible: string | null;
  center_x: string | null;
  center_y: string | null;
  chart_width: string | null;
  chart_height: string | null;
};

/** Every observable piece of chart view state, straight off the canvas. */
export async function chartState(page: Page): Promise<ChartState> {
  const canvas = chartCanvas(page);
  return {
    style: await canvas.getAttribute('data-style'),
    symbol_set: await canvas.getAttribute('data-symbol-set'),
    zoom_pct: await canvas.getAttribute('data-zoom-pct'),
    grid_visible: await canvas.getAttribute('data-grid-visible'),
    center_x: await canvas.getAttribute('data-center-x'),
    center_y: await canvas.getAttribute('data-center-y'),
    chart_width: await canvas.getAttribute('data-chart-width'),
    chart_height: await canvas.getAttribute('data-chart-height'),
  };
}

// -- Seeded documents (store record written straight into IndexedDB) ---------

export type SeededPaletteEntry = { name: string; rgb: string };
export type SeededDocument = {
  id: string;
  name: string;
  width: number;
  height: number;
  palette: SeededPaletteEntry[];
  /** Sparse: only non-empty cells; cells absent from the array are empty. */
  cells: Array<{ x: number; y: number; color: number }>;
};

export type SeededStore = {
  documents: SeededDocument[];
  commands: unknown[];
  snapshots: unknown[];
  sources: unknown[];
  counter: number;
};

/**
 * Write a full store record into IndexedDB (DB "sng", store "store", key
 * "store" — the exact seam sng_persist_ffi.mjs reads). Call after the app
 * has loaded once (so the object store exists), then reload the page.
 */
export async function seedStore(page: Page, store: SeededStore) {
  await page.evaluate(async (payload) => {
    const request = indexedDB.open('sng', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('indexeddb blocked'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite');
      tx.objectStore('store').put(JSON.stringify(payload), 'store');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, store as unknown as Record<string, unknown>);
}

function seededStore(...documents: SeededDocument[]): SeededStore {
  return { documents, commands: [], snapshots: [], sources: [], counter: 10 };
}

/** Wrap one or more seeded documents as a full store record. */
export function storeWith(...documents: SeededDocument[]): SeededStore {
  return seededStore(...documents);
}

const SEED_COLORS = [
  '#CC0000',
  '#00CC00',
  '#0000CC',
  '#000000',
  '#CCCC00',
  '#CC00CC',
  '#00CCCC',
  '#999999',
  '#CC6600',
  '#6600CC',
  '#006600',
  '#990033',
];

/** 24x24 document whose committed chart uses all twelve palette colors. */
export function twelveColorDoc(): SeededDocument {
  const width = 24;
  const height = 24;
  const cells: Array<{ x: number; y: number; color: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A guaranteed block of every color, plus a scattered fill.
      const block = y < 2 && x < 24 ? x >> 1 : -1;
      const scattered = (x + y) % 2 === 0 ? (x + 3 * y) % 12 : -1;
      const color = block >= 0 ? block : scattered;
      if (color >= 0) cells.push({ x, y, color });
    }
  }
  const used = new Set(cells.map((c) => c.color));
  if (used.size !== 12) {
    throw new Error(`twelveColorDoc seed uses ${used.size} colors, expected 12`);
  }
  return {
    id: 'doc-1',
    name: 'Twelve Color Sampler',
    width,
    height,
    palette: SEED_COLORS.slice(0, 12).map((rgb, i) => ({
      name: `Seed C${i}`,
      rgb,
    })),
    cells,
  };
}

/**
 * 1000x1000 sparse document for the NFR-P2 benchmark (config
 * p2_benchmark_chart_width/height). Only a 100x100 corner carries cells so
 * the seed stays small; the chart itself is the full 1000x1000 grid.
 */
export function benchmarkDoc(): SeededDocument {
  const width = 1000;
  const height = 1000;
  const cells: Array<{ x: number; y: number; color: number }> = [];
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      if ((x + y) % 2 === 0) cells.push({ x, y, color: (x + 3 * y) % 4 });
    }
  }
  return {
    id: 'doc-1',
    name: 'NFR-P2 Benchmark',
    width,
    height,
    palette: SEED_COLORS.slice(0, 4).map((rgb, i) => ({
      name: `Bench C${i}`,
      rgb,
    })),
    cells,
  };
}

/**
 * The document's persisted SymbolAssignment (marker SourceImage id
 * "symbol-assignment", content_hash = the assignment JSON — the storage
 * convention of sng/symbols.gleam), decoded to (color_index, glyph_name)
 * pairs in mapping order.
 */
export async function readSymbolAssignment(
  page: Page,
  documentId: string,
): Promise<Array<{ color_index: number; glyph_name: string }> | null> {
  const stored = await readPersistedStore(page);
  const marker = stored?.sources?.find(
    (s) => s.id === 'symbol-assignment' && s.document_id === documentId,
  );
  if (!marker) return null;
  const decoded = JSON.parse(marker.content_hash) as {
    mapping: Array<{ color_index: number; glyph: { name: string } }>;
  };
  return decoded.mapping.map((m) => ({
    color_index: m.color_index,
    glyph_name: m.glyph.name,
  }));
}
