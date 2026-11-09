// Obligations exercised (specs/m1-local-foundation.allium):
//   - surface LibraryBrowser: @guarantee PromptFreeEntry (AC-F001-02),
//     @guarantee LibraryPersists (AC-F014-01, browser level)
//   - surface-provides.LibraryBrowser exercised end to end:
//     CreateBlankDocument (rule BlankDocumentCreated), ImportImageStub
//     (rule ImageImportedStub), RenameDocument, DuplicateDocument
//     (rule DocumentDuplicated), DeleteDocument behind confirmation (AC-F014-02)
//   - surface-actor.LibraryBrowser / surface-actor.Editor at the UI level
// Domain-level variants of these rules are covered by gleeunit (app/test/sng/).
import { expect, test } from '@playwright/test';
import {
  TINY_PNG_BASE64,
  cell,
  createBlankDocument,
  drawStroke,
  libraryEntry,
  openDocument,
  persistentProfile,
  renameDocument,
  stitchedCell,
  waitForDurableState,
} from './helpers';

test('PromptFreeEntry — the workspace is immediately usable, anonymous, with no sign-in wall or modal', async ({
  page,
}) => {
  await page.goto('/');

  // No sign-in wall, no blocking modal (AC-F001-02).
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/sign in|log in|create an account/i)).toHaveCount(0);

  // Immediately usable: the full create → draw flow works with no identity.
  await createBlankDocument(page, { width: 8, height: 8 });
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await drawStroke(page, [[0, 0]]);
  await expect(stitchedCell(page, 0, 0)).toBeVisible();
});

test('LibraryPersists — name, thumbnail, and last-edited survive a browser restart', async () => {
  // Both sessions run on one real on-disk profile; closing the browser and
  // relaunching against the same userDataDir is a genuine browser restart
  // (non-persistent Playwright contexts are incognito partitions and could
  // never prove on-disk durability).
  const profile = persistentProfile();
  try {
    // Session 1: create, draw, rename.
    const ctx1 = await profile.launch();
    const page = await ctx1.newPage();
    await page.goto('/');
    await createBlankDocument(page, { width: 8, height: 8 });
    await drawStroke(page, [[3, 3]]);
    await expect(stitchedCell(page, 3, 3)).toBeVisible();
    await page.getByRole('button', { name: 'Back to library' }).click();
    await renameDocument(page, 'Untitled', 'Sunrise');
    const entry = libraryEntry(page, 'Sunrise');
    await expect(entry.getByRole('img')).toBeVisible(); // thumbnail
    await expect(entry.getByText(/last edited/i)).toBeVisible();
    // Pin the durability precondition: the renamed document with its drawn
    // stitch is on disk before the restart (the app persists asynchronously).
    await waitForDurableState(
      page,
      (s) =>
        s.documents.some(
          (d) =>
            d.name === 'Sunrise' &&
            d.cells.some((c) => c.x === 3 && c.y === 3 && c.color !== null),
        ),
    );
    await ctx1.close();

    // Session 2: reopen after a real browser restart.
    const ctx2 = await profile.launch();
    const page2 = await ctx2.newPage();
    await page2.goto('/');
    const restored = libraryEntry(page2, 'Sunrise');
    await expect(restored).toBeVisible();
    await expect(restored.getByRole('img')).toBeVisible(); // thumbnail
    await expect(restored.getByText(/last edited/i)).toBeVisible();

    // And the drawn stitch is still there.
    await openDocument(page2, 'Sunrise');
    await expect(stitchedCell(page2, 3, 3)).toBeVisible();
    await ctx2.close();
  } finally {
    profile.dispose();
  }
});

test('CreateBlankDocument — 8x8 blank creates "Untitled" with an all-empty grid', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });

  // rule BlankDocumentCreated at the surface: name and empty grid.
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await expect(page.getByRole('gridcell')).toHaveCount(64);
  await expect(cell(page, 7, 7)).toBeVisible();
});

test('ImportImageStub — feeding PNG bytes to the import control creates a document named after the file', async ({
  page,
}) => {
  await page.goto('/');
  const importInput = page.getByLabel(/import image/i);
  await importInput.setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });

  // rule ImageImportedStub: document named after the file, opens into a grid.
  const entry = libraryEntry(page, 'tiny.png');
  await expect(entry).toBeVisible();
  await openDocument(page, 'tiny.png');
  await expect(page.getByRole('gridcell').first()).toBeVisible();
});

test('RenameDocument — library rename updates the entry name', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  await page.getByRole('button', { name: 'Back to library' }).click();

  await renameDocument(page, 'Untitled', 'Rose');
  await expect(
    page.getByRole('heading', { name: 'Untitled' }),
  ).toHaveCount(0);
});

test('DuplicateDocument — duplicate creates an independent "<name> (copy)" entry', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  await page.getByRole('button', { name: 'Back to library' }).click();
  await renameDocument(page, 'Untitled', 'Rose');

  await libraryEntry(page, 'Rose')
    .getByRole('button', { name: 'Duplicate Rose' })
    .click();

  // rule DocumentDuplicated: name gains " (copy)".
  await expect(libraryEntry(page, 'Rose (copy)')).toBeVisible();
  await expect(libraryEntry(page, 'Rose')).toBeVisible();
});

test('DeleteDocument — deletion only behind a confirmation dialog; confirmed deletion is permanent', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  await page.getByRole('button', { name: 'Back to library' }).click();
  await renameDocument(page, 'Untitled', 'Gone Soon');
  const entry = libraryEntry(page, 'Gone Soon');

  // Confirmation dialog precedes the action (AC-F014-02).
  await entry.getByRole('button', { name: 'Delete Gone Soon' }).click();
  const dialog = page.getByRole('dialog', { name: /delete/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/permanently/i)).toBeVisible();

  // Cancel: the document survives.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(libraryEntry(page, 'Gone Soon')).toBeVisible();

  // Confirm: the document is permanently gone.
  await libraryEntry(page, 'Gone Soon')
    .getByRole('button', { name: 'Delete Gone Soon' })
    .click();
  await page
    .getByRole('dialog', { name: /delete/i })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(libraryEntry(page, 'Gone Soon')).toHaveCount(0);
});
