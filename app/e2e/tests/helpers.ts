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
  await page.getByRole('button', { name: 'Pencil' }).click();
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
    name: string;
    cells: Array<{ x: number; y: number; color: number | null }>;
  }>;
  commands: Array<{ verb: string }>;
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
