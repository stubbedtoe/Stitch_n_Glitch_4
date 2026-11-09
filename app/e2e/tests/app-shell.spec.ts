// Obligations exercised (specs/m1-local-foundation.allium):
//   - surface AppShell guarantees: OfflineCapable (AC-F015-01, NFR-A1),
//     Installable (AC-F015-02), OfflineIndicatorTimely (AC-F015-03, NFR-A2)
//   - surface-actor.AppShell, surface-exposure.AppShell
//   - rules OfflineIndicatorShown / OnlineIndicatorHidden at the UI level
// Domain-level AppSession transitions are covered by gleeunit
// (offline_indicator_shown_and_hidden_test); these tests pin the UI wiring.
import { expect, test } from '@playwright/test';
import { createBlankDocument, drawStroke, offlineIndicator, stitchedCell } from './helpers';

test('OfflineCapable — after one online load the shell and blank-document creation work offline, across reloads', async ({
  browser,
}) => {
  // Load once online so the service worker can register and precache the shell.
  const online = await browser.newContext();
  const page = await online.newPage();
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(
        // Install (which populates the precache) completes before the worker
        // activates, so `activated` guarantees the shell is cached and the
        // page can be served offline. Waiting only for a registration races
        // the install step and intermittently fails the reload below.
        async () =>
          (await navigator.serviceWorker?.getRegistration())?.active?.state ===
          'activated',
      ),
    )
    .toBe(true);

  // Go fully offline and reload: the app shell must still load from cache.
  await online.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Create blank document' }),
  ).toBeVisible();

  // Every creation feature works with no network access (AC-F015-01).
  await createBlankDocument(page, { width: 8, height: 8 });
  await drawStroke(page, [[1, 1]]);
  await expect(stitchedCell(page, 1, 1)).toBeVisible();
  await online.close();
});

test('Installable — manifest has name, icons, standalone display; service worker registered', async ({
  page,
}) => {
  await page.goto('/');

  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute('href');
  expect(manifestHref, 'a <link rel="manifest"> must exist').toBeTruthy();
  const manifestUrl = new URL(manifestHref!, page.url()).toString();
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();

  expect(typeof manifest.name).toBe('string');
  expect(manifest.name.length).toBeGreaterThan(0);
  expect(manifest.display).toBe('standalone');
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    expect(icon.src).toBeTruthy();
    expect(icon.sizes).toBeTruthy();
  }

  const registration = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    return reg ? (reg.active?.state ?? 'pending') : null;
  });
  expect(registration, 'a service worker must be registered').not.toBeNull();
});

test('OfflineIndicatorShown — connectivity drop surfaces a non-blocking indicator and editing is uninterrupted', async ({
  page,
}) => {
  await page.goto('/');
  const indicator = offlineIndicator(page);
  await expect(indicator).toBeHidden();

  await page.context().setOffline(true);
  await expect(indicator).toBeVisible();

  // Non-blocking: no modal appears, the workspace stays interactive (AC-F015-03).
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Create blank document' }),
  ).toBeVisible();
  await createBlankDocument(page, { width: 8, height: 8 });
  await drawStroke(page, [[2, 2]]);
  await expect(stitchedCell(page, 2, 2)).toBeVisible();
});

test('OnlineIndicatorHidden — restoring connectivity hides the indicator', async ({
  page,
}) => {
  await page.goto('/');
  const indicator = offlineIndicator(page);

  await page.context().setOffline(true);
  await expect(indicator).toBeVisible();

  await page.context().setOffline(false);
  await expect(indicator).toBeHidden();
});

test('OfflineIndicatorTimely — indicator appears within config.offline_indicator_deadline (5s)', async ({
  page,
}) => {
  await page.goto('/');
  const indicator = offlineIndicator(page);

  const start = Date.now();
  await page.context().setOffline(true);
  await expect(indicator).toBeVisible({ timeout: 5_000 });
  const elapsed = Date.now() - start;
  expect(
    elapsed,
    `offline indicator took ${elapsed}ms, deadline is 5000ms`,
  ).toBeLessThan(5_000);
});

test('surface-actor.AppShell — the shell serves an anonymous user with no identity wall', async ({
  page,
}) => {
  await page.goto('/');
  await expect(offlineIndicator(page)).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/sign in|log in|create an account/i)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Create blank document' }),
  ).toBeVisible();
});

test('surface-exposure.AppShell — network availability and offline notice state are exposed in the UI', async ({
  page,
}) => {
  await page.goto('/');
  // While online: the network state is exposed as "no offline notice shown".
  await expect(offlineIndicator(page)).toBeHidden();
  // After a transition the exposure updates (state machine is the session's).
  await page.context().setOffline(true);
  await expect(offlineIndicator(page)).toBeVisible();
  await page.context().setOffline(false);
  await expect(offlineIndicator(page)).toBeHidden();
});
