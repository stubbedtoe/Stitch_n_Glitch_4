import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Browser-level contract suite for specs/m1-local-foundation.allium.
// The app is served by e2e/serve.sh, which builds the Gleam app and serves
// app/priv/static/ on a fixed port (see e2e/CONTRACT.md).
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4719',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bash e2e/serve.sh',
    cwd: appRoot,
    url: 'http://localhost:4719/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
