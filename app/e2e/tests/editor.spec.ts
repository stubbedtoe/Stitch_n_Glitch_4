// Obligations exercised (specs/m1-local-foundation.allium):
//   - surface Editor guarantees at browser level: CrashRecovery (NFR-A3),
//     UndoPersists (AC-F045-04 local half)
//   - surface-provides.Editor exercised end to end: DrawStitches (rule
//     StitchesDrawn, one gesture = one log entry), Undo/Redo availability
//     guards, ExportPdfPlaceholder
// Domain-level variants (store.gleam, persist.gleam) are covered by gleeunit.
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import {
  cell,
  createBlankDocument,
  dragOverCells,
  drawStroke,
  libraryEntry,
  persistentProfile,
  stitchedCell,
  waitForDurableState,
} from './helpers';

test('DrawStitches — one pencil gesture stitches every dragged cell as a single committed entry', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });

  // A single stroke across three cells (rule StitchesDrawn granularity).
  await drawStroke(page, [
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  await expect(stitchedCell(page, 1, 1)).toBeVisible();
  await expect(stitchedCell(page, 2, 1)).toBeVisible();
  await expect(stitchedCell(page, 3, 1)).toBeVisible();

  // One committed gesture = one log entry: a single Undo reverts the whole stroke.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cell(page, 1, 1)).toBeVisible();
  await expect(cell(page, 2, 1)).toBeVisible();
  await expect(cell(page, 3, 1)).toBeVisible();
});

test('Undo/Redo availability guards — buttons mirror the surface-provides.Editor preconditions', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });

  // Empty log: nothing to undo and nothing to redo.
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // After a gesture: undo available, redo not.
  await drawStroke(page, [[4, 4]]);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // After undo: redo available, undo not (linear history, AC-F045-04).
  await undo.click();
  await expect(cell(page, 4, 4)).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  // Redo restores the undone stitch.
  await redo.click();
  await expect(stitchedCell(page, 4, 4)).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});

test('Hovering cells is not a gesture — a click after a hover reverts the real stroke, not a phantom', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  await drawStroke(page, [[1, 1]]);

  // Real-user behaviour: with no button pressed, move the pointer across the
  // grid on the way to the Undo button. Hover must not grow the stroke —
  // otherwise the click's pointerup commits the hovered cells as a phantom
  // gesture, and Undo then reverts that phantom instead of the real stroke.
  const hover = await cell(page, 6, 6).boundingBox();
  await page.mouse.move(hover!.x + hover!.width / 2, hover!.y + hover!.height / 2, {
    steps: 20,
  });

  await page.getByRole('button', { name: 'Undo' }).click();
  // The real stroke is undone (rule StitchesDrawn granularity)...
  await expect(cell(page, 1, 1)).toBeVisible();
  // ...and the hover never produced a log entry: nothing is stitched.
  await expect(
    page.getByRole('gridcell', { name: /^Stitched cell/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
});

test('Pencil toggle — the tool gates the gesture pipeline and its state is visible', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  const pencil = page.getByRole('button', { name: 'Pencil' });
  const undo = page.getByRole('button', { name: 'Undo' });

  // Active on entry; aria-pressed mirrors the state so it is perceivable.
  await expect(pencil).toHaveAttribute('aria-pressed', 'true');

  // Deactivate: the state flips and gestures no longer commit anything.
  await pencil.click();
  await expect(pencil).toHaveAttribute('aria-pressed', 'false');
  await dragOverCells(page, [[2, 2]]);
  await expect(cell(page, 2, 2)).toBeVisible();
  await expect(undo).toBeDisabled();

  // Reactivate: gestures commit again.
  await pencil.click();
  await expect(pencil).toHaveAttribute('aria-pressed', 'true');
  await dragOverCells(page, [[2, 2]]);
  await expect(stitchedCell(page, 2, 2)).toBeVisible();
  await expect(undo).toBeEnabled();
});

test('CrashRecovery — a committed gesture survives a force-close; reopening restores the last committed state', async () => {
  // Session 1 runs on a real on-disk profile: draw a gesture, observe it
  // acknowledged, then close the browser (no graceful in-app shutdown —
  // simulates NFR-A3 force-close; close() flushes the profile to disk).
  const profile = persistentProfile();
  try {
    const ctx1 = await profile.launch();
    const page = await ctx1.newPage();
    await page.goto('/');
    await createBlankDocument(page, { width: 8, height: 8 });
    await drawStroke(page, [[2, 2]]);
    await expect(stitchedCell(page, 2, 2)).toBeVisible(); // committed & acked
    // Pin the NFR-A3 precondition: the gesture is durable on disk (the app
    // persists asynchronously; only a committed gesture is promised to
    // survive a force-close).
    await waitForDurableState(page, (s) =>
      s.documents.some((d) =>
        d.cells.some((c) => c.x === 2 && c.y === 2 && c.color !== null),
      ),
    );
    await ctx1.close();

    // Session 2: a genuine browser restart against the same profile.
    const ctx2 = await profile.launch();
    const page2 = await ctx2.newPage();
    await page2.goto('/');
    await libraryEntry(page2, 'Untitled')
      .getByRole('button', { name: 'Open Untitled' })
      .click();
    await expect(stitchedCell(page2, 2, 2)).toBeVisible();
    await ctx2.close();
  } finally {
    profile.dispose();
  }
});

test('UndoPersists — an undone gesture does not resurrect after a force-close and reopen', async () => {
  const profile = persistentProfile();
  try {
    const ctx1 = await profile.launch();
    const page = await ctx1.newPage();
    await page.goto('/');
    await createBlankDocument(page, { width: 8, height: 8 });
    await drawStroke(page, [[5, 5]]);
    await expect(stitchedCell(page, 5, 5)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(cell(page, 5, 5)).toBeVisible(); // undone
    // Pin the durability precondition: the undo — not just the draw — has
    // landed on disk, and the record shows cell 5,5 empty, before the
    // force-close. A gesture whose write is still in flight was never
    // committed, so nothing is promised about it (NFR-A3).
    await waitForDurableState(
      page,
      (s) =>
        s.commands.some((c) => c.verb === 'undo') &&
        s.documents.some((d) =>
          d.cells.some((c) => c.x === 5 && c.y === 5 && c.color === null),
        ),
    );
    await ctx1.close();

    const ctx2 = await profile.launch();
    const page2 = await ctx2.newPage();
    await page2.goto('/');
    await libraryEntry(page2, 'Untitled')
      .getByRole('button', { name: 'Open Untitled' })
      .click();
    // No resurrection of the undone edit (AC-F045-04, local half).
    await expect(cell(page2, 5, 5)).toBeVisible();
    await expect(stitchedCell(page2, 5, 5)).toHaveCount(0);
    await ctx2.close();
  } finally {
    profile.dispose();
  }
});

test('ExportPdfPlaceholder — export produces a local file and transmits nothing', async ({
  page,
}) => {
  await page.goto('/');
  await createBlankDocument(page, { width: 8, height: 8 });
  await drawStroke(page, [[1, 2]]);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export pdf/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const path = await download.path();
  expect(fs.statSync(path!).size).toBeGreaterThan(0);
  // Egress (or its absence) is asserted by the LocalOnlyBoundary suite.
});
