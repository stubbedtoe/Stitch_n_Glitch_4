// Obligations exercised (specs/m1-local-foundation.allium):
//   - contract LocalOnlyBoundary, invariant NoUnpublishedEgress
//     (AC-F001-03, NFR-PR1): with sync disabled — the only M1 mode — no
//     network request may transmit a pattern document, command log,
//     snapshot, or source image to any server.
// The app is fully local, so the contract is: every request is a same-origin
// GET/HEAD for a static app asset. There is no allowlisted analytics or API
// endpoint in M1.
import { expect, test } from '@playwright/test';
import {
  createBlankDocument,
  drawStroke,
  libraryEntry,
  renameDocument,
} from './helpers';

test('LocalOnlyBoundary — creating, editing, renaming, duplicating, and exporting send nothing to any server', async ({
  page,
}) => {
  interface Seen {
    method: string;
    url: string;
  }
  const requests: Seen[] = [];
  page.on('request', (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });

  await page.goto('/');

  // Create + edit (draw, undo, redo).
  await createBlankDocument(page, { width: 8, height: 8 });
  await drawStroke(page, [
    [1, 1],
    [2, 2],
  ]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();

  // Rename + duplicate from the library.
  await page.getByRole('button', { name: 'Back to library' }).click();
  await renameDocument(page, 'Untitled', 'Egress Probe');
  await libraryEntry(page, 'Egress Probe')
    .getByRole('button', { name: 'Duplicate Egress Probe' })
    .click();

  // Export placeholder: produces a local file…
  await libraryEntry(page, 'Egress Probe')
    .getByRole('button', { name: 'Open Egress Probe' })
    .click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export pdf/i }).click();
  await downloadPromise;

  expect(requests.length).toBeGreaterThan(0); // the app must actually load

  const origin = new URL(page.url()).origin;
  const staticAsset =
    /^\/$|\/(index\.html|[^/]+\.(mjs|js|css|json|webmanifest|png|svg|ico|woff2?))$/;

  const violations: Seen[] = [];
  for (const request of requests) {
    const url = new URL(request.url);
    // Same origin only: no third-party or sync-server traffic.
    if (url.origin !== origin) violations.push(request);
    // Read-only methods only: nothing is ever uploaded.
    else if (!/^(GET|HEAD)$/.test(request.method)) violations.push(request);
    // Static assets only: no API endpoint exists in M1.
    else if (!staticAsset.test(url.pathname)) violations.push(request);
  }

  expect(
    violations,
    `non-static-asset requests:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
});
